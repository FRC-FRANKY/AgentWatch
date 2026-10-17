/**
 * modules/auth/auth.service.ts — Core Authentication Logic
 *
 * SECURITY DESIGN:
 * - Argon2id password hashing (memoryCost=65536, timeCost=3, parallelism=4)
 * - Account lockout after MAX_LOGIN_ATTEMPTS failures
 * - Constant-time comparison for password verification
 * - No user enumeration: identical error messages for invalid email AND invalid password
 * - MFA required before full access token is issued
 * - All authentication events logged to audit trail
 */

import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../config/database';
import { env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import {
  issueAccessToken,
  issuePartialToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeAllUserTokens,
} from './token.service';
import { verifyMfaForUser } from './mfa.service';
import type { LoginResult, MfaVerifyResult } from '../../shared/types/auth.types';

const ARGON2_CONFIG = {
  type: argon2.argon2id,
  memoryCost: 65536,   // 64 MB
  timeCost: 3,
  parallelism: 4,
};

// ── Password Hashing ──────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_CONFIG);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// ── Account Lockout ───────────────────────────────────────────────────────────

async function incrementFailedLogins(userId: string): Promise<void> {
  await query(
    `UPDATE users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= $1
           THEN NOW() + ($2 || ' minutes')::INTERVAL
           ELSE locked_until
         END
     WHERE id = $3`,
    [env.MAX_LOGIN_ATTEMPTS, env.ACCOUNT_LOCKOUT_DURATION_MINUTES, userId],
  );
}

async function resetFailedLogins(userId: string, ip: string): Promise<void> {
  await query(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL,
         last_login_at = NOW(), last_login_ip = $1, last_seen_at = NOW()
     WHERE id = $2`,
    [ip, userId],
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────

const DEMO_USERS = {
  'admin@agentwatch.local': { id: 'demo-admin', email: 'admin@agentwatch.local', role: 'ADMIN', roleId: 'demo-admin-role', managerId: null, displayName: 'System Administrator', password: 'Admin123!' },
  'manager@agentwatch.local': { id: 'demo-manager', email: 'manager@agentwatch.local', role: 'MANAGER', roleId: 'demo-manager-role', managerId: 'demo-manager', displayName: 'Operations Manager', password: 'Manager123!' },
  'support@agentwatch.local': { id: 'demo-support', email: 'support@agentwatch.local', role: 'IT_SUPPORT', roleId: 'demo-support-role', managerId: null, displayName: 'IT Support Engineer', password: 'Support123!' },
  'agent@agentwatch.local': { id: 'demo-agent', email: 'agent@agentwatch.local', role: 'AGENT', roleId: 'demo-agent-role', managerId: 'demo-manager', displayName: 'Remote Agent', password: 'Agent123!' },
} as const;

async function resolveUserManagerId(userId: string, role: string): Promise<string | null> {
  if (role === 'MANAGER') {
    return userId;
  }

  if (role !== 'AGENT') {
    return null;
  }

  const result = await query<{ manager_id: string }>(
    `SELECT manager_id
     FROM manager_agent_access
     WHERE agent_id = $1 AND is_active = TRUE
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY granted_at DESC
     LIMIT 1`,
    [userId],
  );

  return result.rows[0]?.manager_id ?? null;
}

export async function login(
  email: string,
  password: string,
  sourceIp: string,
  userAgent: string,
  requestId: string,
): Promise<LoginResult> {
  const auditService = AuditService.getInstance();

  if (process.env.USE_DEMO_MODE === 'true') {
    const demoUser = DEMO_USERS[email.toLowerCase() as keyof typeof DEMO_USERS];
    if (!demoUser || demoUser.password !== password) {
      await auditService.log({
        action: 'FAILED_LOGIN',
        actorEmail: email,
        details: { reason: 'DEMO_MODE_INVALID_CREDENTIALS' },
        sourceIp,
        userAgent,
        requestId,
      });
      throw new Error('Invalid email or password');
    }

    const familyId = uuidv4();
    // Demo mode: set mfa_verified=true so demo users can access all protected routes
    // without MFA setup. This is acceptable in demo/development mode only.
    const accessToken = issueAccessToken({
      sub: demoUser.id,
      email: demoUser.email,
      role: demoUser.role,
      roleId: demoUser.roleId,
      managerId: demoUser.managerId ?? null,
      mfa_verified: true,
    });
    const refreshToken = await issueRefreshToken(demoUser.id, familyId, sourceIp, userAgent, true);

    await auditService.log({
      action: 'LOGIN',
      actorId: demoUser.id,
      actorEmail: demoUser.email,
      actorRole: demoUser.role,
      details: { mode: 'demo', mfa_verified: true },
      sourceIp,
      userAgent,
      requestId,
    });

    return {
      requiresMfa: false,
      userId: demoUser.id,
      displayName: demoUser.displayName,
      role: demoUser.role,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900,
      },
    };
  }

  // Lookup user — return same error for invalid email or invalid password (no enumeration)
  const result = await query<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
    role_id: string;
    role_name: string;
    is_active: boolean;
    is_mfa_enabled: boolean;
    failed_login_attempts: number;
    locked_until: Date | null;
  }>(
    `SELECT u.id, u.email, u.display_name, u.password_hash, u.role_id,
            r.name AS role_name, u.is_active, u.is_mfa_enabled,
            u.failed_login_attempts, u.locked_until
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE LOWER(u.email) = LOWER($1)`,
    [email],
  );

  const user = result.rows[0];

  // Always run a dummy hash comparison even if user not found
  // This prevents timing attacks from revealing whether email exists
  const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$dummy$dummydummydummydummydummydummy';
  const passwordToVerify = user ? user.password_hash : dummyHash;

  const passwordValid = await verifyPassword(passwordToVerify, password);

  if (!user || !passwordValid) {
    if (user) {
      await incrementFailedLogins(user.id);

      // Check if this attempt triggered lockout
      if (user.failed_login_attempts + 1 >= env.MAX_LOGIN_ATTEMPTS) {
        await auditService.log({
          action: 'ACCOUNT_LOCKED',
          actorId: user.id,
          actorEmail: user.email,
          actorRole: user.role_name,
          details: { reason: 'MAX_ATTEMPTS_EXCEEDED' },
          sourceIp,
          userAgent,
          requestId,
        });
      }
    }

    await auditService.log({
      action: 'FAILED_LOGIN',
      actorEmail: email,
      details: { reason: user ? 'INVALID_PASSWORD' : 'USER_NOT_FOUND' },
      sourceIp,
      userAgent,
      requestId,
    });

    // Generic error — no enumeration
    throw new Error('Invalid email or password');
  }

  if (!user.is_active) {
    await auditService.log({
      action: 'FAILED_LOGIN',
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role_name,
      details: { reason: 'ACCOUNT_INACTIVE' },
      sourceIp,
      userAgent,
      requestId,
    });
    throw new Error('Invalid email or password'); // No enumeration
  }

  // Check account lockout
  if (user.locked_until && user.locked_until > new Date()) {
    await auditService.log({
      action: 'FAILED_LOGIN',
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role_name,
      details: { reason: 'ACCOUNT_LOCKED' },
      sourceIp,
      userAgent,
      requestId,
    });
    const minutesLeft = Math.ceil((user.locked_until.getTime() - Date.now()) / 60000);
    throw new Error(`Account is temporarily locked. Try again in ${minutesLeft} minute(s).`);
  }

  // Password valid — reset failed attempts
  await resetFailedLogins(user.id, sourceIp);

  // ── F-02 FIX: Block privileged roles that have not set up MFA ─────────────
  // AGENT role is exempt — they cannot initiate monitoring sessions anyway.
  const ROLES_REQUIRING_MFA = new Set(['ADMIN', 'MANAGER', 'TEAM_LEADER', 'IT_SUPPORT']);
  if (!user.is_mfa_enabled && ROLES_REQUIRING_MFA.has(user.role_name)) {
    await auditService.log({
      action: 'FAILED_LOGIN',
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role_name,
      details: { reason: 'MFA_SETUP_REQUIRED' },
      sourceIp,
      userAgent,
      requestId,
    });
    throw new Error(
      'MFA_SETUP_REQUIRED: Your role requires Multi-Factor Authentication. ' +
      'Please contact your administrator to complete MFA setup.',
    );
  }

  // MFA enabled — issue partial token valid only for MFA verify step
  if (user.is_mfa_enabled) {
    const partialToken = issuePartialToken(user.id, user.email, user.role_name, user.role_id);
    return {
      requiresMfa: true,
      mfaRequired: true,
      userId: user.id,
      partialToken,
    };
  }

  // AGENT role without MFA — issue token with mfa_verified: false
  // AGENT cannot perform monitoring actions; requireMFA blocks sensitive routes.
  const familyId = uuidv4();
  const managerId = await resolveUserManagerId(user.id, user.role_name);
  const accessToken = issueAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role_name,
    roleId: user.role_id,
    managerId,
    mfa_verified: false,
  });
  // Store mfa_verified=false in refresh token for accurate refresh (F-10 fix)
  const refreshToken = await issueRefreshToken(user.id, familyId, sourceIp, userAgent, false);

  await auditService.log({
    action: 'LOGIN',
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role_name,
    details: { mfa_verified: false },
    sourceIp,
    userAgent,
    requestId,
  });

  return {
    requiresMfa: false,
    userId: user.id,
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: 900,
    },
  };
}

// ── MFA Verification ──────────────────────────────────────────────────────────

export async function verifyMfa(
  partialToken: string,
  code: string,
  sourceIp: string,
  userAgent: string,
  requestId: string,
): Promise<MfaVerifyResult> {
  const { verifyPartialToken } = await import('./token.service');
  const auditService = AuditService.getInstance();

  let partialPayload;
  try {
    partialPayload = verifyPartialToken(partialToken);
  } catch {
    throw new Error('Invalid or expired partial token');
  }

  const userId = partialPayload.sub;

  // Fetch role info
  const result = await query<{ id: string; email: string; role_id: string; role_name: string }>(
    `SELECT u.id, u.email, u.role_id, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.is_active = TRUE`,
    [userId],
  );

  const user = result.rows[0];
  if (!user) throw new Error('User not found');

  const isValid = await verifyMfaForUser(userId, code);

  if (!isValid) {
    await auditService.log({
      action: 'MFA_FAILURE',
      actorId: userId,
      actorEmail: user.email,
      actorRole: user.role_name,
      details: {},
      sourceIp,
      userAgent,
      requestId,
    });
    throw new Error('Invalid MFA code');
  }

  // MFA passed — issue full tokens (F-10: store mfa_verified=true in refresh token)
  const familyId = uuidv4();
  const managerId = await resolveUserManagerId(user.id, user.role_name);
  const accessToken = issueAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role_name,
    roleId: user.role_id,
    managerId,
    mfa_verified: true,
  });
  const refreshToken = await issueRefreshToken(user.id, familyId, sourceIp, userAgent, true);

  await auditService.log({
    action: 'MFA_SUCCESS',
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role_name,
    details: {},
    sourceIp,
    userAgent,
    requestId,
  });

  await auditService.log({
    action: 'LOGIN',
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role_name,
    details: { mfa_verified: true },
    sourceIp,
    userAgent,
    requestId,
  });

  return {
    tokens: { accessToken, refreshToken, expiresIn: 900 },
    userId: user.id,
  };
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logout(
  userId: string,
  userEmail: string,
  userRole: string,
  sourceIp: string,
  userAgent: string,
  requestId: string,
): Promise<void> {
  const auditService = AuditService.getInstance();

  await revokeAllUserTokens(userId, 'LOGOUT');

  await auditService.log({
    action: 'LOGOUT',
    actorId: userId,
    actorEmail: userEmail,
    actorRole: userRole,
    details: {},
    sourceIp,
    userAgent,
    requestId,
  });
}

// ── Token Refresh ─────────────────────────────────────────────────────────────

export async function refreshTokens(
  incomingRefreshToken: string,
  sourceIp: string,
  userAgent: string,
  requestId: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const auditService = AuditService.getInstance();

  // F-10 FIX: rotateRefreshToken now returns mfa_verified from the stored record,
  // NOT derived from is_mfa_enabled (which would silently upgrade mfa_verified: false tokens).
  const { userId, newRefreshToken, mfaVerified } = await rotateRefreshToken(
    incomingRefreshToken,
    sourceIp,
    userAgent,
  );

  if (process.env.USE_DEMO_MODE === 'true') {
    // In demo mode: find the demo user by ID and re-issue access token
    const demoUser = Object.values(DEMO_USERS).find((u) => u.id === userId);
    if (!demoUser) throw new Error('Demo user not found');

    const newAccessToken = issueAccessToken({
      sub: demoUser.id,
      email: demoUser.email,
      role: demoUser.role,
      roleId: demoUser.roleId,
      managerId: demoUser.managerId ?? null,
      mfa_verified: mfaVerified,
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn: 900 };
  }

  // Fetch current user data
  const result = await query<{ id: string; email: string; role_id: string; role_name: string }>(
    `SELECT u.id, u.email, u.role_id, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.is_active = TRUE`,
    [userId],
  );

  const user = result.rows[0];
  if (!user) throw new Error('User not found or inactive');

  const managerId = await resolveUserManagerId(user.id, user.role_name);
  const newAccessToken = issueAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role_name,
    roleId: user.role_id,
    managerId,
    mfa_verified: mfaVerified, // Use stored value, not is_mfa_enabled flag
  });

  await auditService.log({
    action: 'TOKEN_REFRESHED',
    actorId: userId,
    actorEmail: user.email,
    actorRole: user.role_name,
    details: {},
    sourceIp,
    userAgent,
    requestId,
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn: 900 };
}
