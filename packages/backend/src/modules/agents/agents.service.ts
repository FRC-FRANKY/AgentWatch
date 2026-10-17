/**
 * modules/agents/agents.service.ts — Manager-Agent Lifecycle
 *
 * SECURITY:
 * - managerId always comes from authenticated JWT claims (req.user.id), NEVER from request body.
 * - Ownership checks are enforced before any mutation or data return.
 * - Enrollment tokens are stored as SHA-256 hashes; plaintext is shown once and discarded.
 * - Enrollment tokens are single-use, time-limited, and tied to a specific manager.
 * - Duplicate access grants are idempotent (UNIQUE constraint on manager_id/agent_id).
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../../config/database';
import { AuditService } from '../audit/audit.service';
import { logger } from '../../config/logger';

const audit = AuditService.getInstance();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnsureManagerAgentAccessInput {
  managerId: string;
  agentId: string;
  grantedById: string;
  reason?: string;
}

export interface ManagerAgentAccessResult {
  id: string;
  managerId: string;
  agentId: string;
  isActive: boolean;
  grantedAt: Date;
  reason?: string;
}

export interface CreateEnrollmentTokenInput {
  managerId: string;
  agentUserId?: string;   // Pre-assign to an existing AGENT user (optional)
  label?: string;
  expiresInHours?: number;  // Defaults to 48 hours
}

export interface EnrollmentTokenResult {
  tokenId: string;
  rawToken: string;   // Shown to manager ONCE — not stored
  label?: string;
  managerId: string;
  agentUserId?: string;
  expiresAt: Date;
}

export interface AgentEnrollInput {
  rawToken: string;
  hostname: string;
  deviceName: string;
  macAddress?: string;
  osType?: string;
  osVersion?: string;
  clientVersion?: string;
}

export interface AgentEnrollResult {
  deviceId: string;
  deviceToken: string;
  agentUserId: string;
  managerId: string;
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ── Manager-Agent Access Grant ────────────────────────────────────────────────

/**
 * Persists a manager → agent access grant to the database.
 * Idempotent: if a grant already exists, it is reactivated rather than duplicated.
 * The managerId always comes from the authenticated JWT — never trusted from the caller's input.
 */
export async function ensureManagerAgentAccess(
  input: EnsureManagerAgentAccessInput,
): Promise<ManagerAgentAccessResult> {

  // Prevent self-access FIRST — pure validation, no DB call needed
  if (input.managerId === input.agentId) {
    throw new Error('SELF_ACCESS_DENIED: A manager cannot be granted access to themselves');
  }

  // Validate the agent user exists and has the AGENT role
  const agentResult = await query<{ id: string; role_name: string; is_active: boolean }>(
    `SELECT u.id, r.name AS role_name, u.is_active
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [input.agentId],
  );

  const agent = agentResult.rows[0];
  if (!agent || !agent.is_active) {
    throw new Error('AGENT_NOT_FOUND: Agent user does not exist or is inactive');
  }
  if (agent.role_name !== 'AGENT') {
    throw new Error('INVALID_ROLE: Only users with the AGENT role can be assigned to a manager');
  }

  return withTransaction(async (client) => {
    // Upsert: insert or reactivate existing grant
    const result = await client.query<{
      id: string; manager_id: string; agent_id: string;
      is_active: boolean; granted_at: Date; reason?: string;
    }>(
      `INSERT INTO manager_agent_access
         (manager_id, agent_id, granted_by, is_active, reason)
       VALUES ($1, $2, $3, TRUE, $4)
       ON CONFLICT (manager_id, agent_id) DO UPDATE
         SET is_active = TRUE,
             revoked_at = NULL,
             revoked_by = NULL,
             granted_by = EXCLUDED.granted_by,
             reason = COALESCE(EXCLUDED.reason, manager_agent_access.reason),
             granted_at = NOW(),
             expires_at = NULL
       RETURNING id, manager_id, agent_id, is_active, granted_at, reason`,
      [input.managerId, input.agentId, input.grantedById, input.reason ?? null],
    );

    const grant = result.rows[0];

    await audit.log({
      action: 'ACCESS_GRANTED',
      actorId: input.grantedById,
      actorRole: 'MANAGER',
      targetId: input.agentId,
      targetType: 'USER',
      details: {
        managerId: input.managerId,
        agentId: input.agentId,
        reason: input.reason,
        grantId: grant.id,
      },
    });

    logger.info(
      { managerId: input.managerId, agentId: input.agentId, grantId: grant.id },
      'Manager-agent access grant ensured',
    );

    return {
      id: grant.id,
      managerId: grant.manager_id,
      agentId: grant.agent_id,
      isActive: grant.is_active,
      grantedAt: grant.granted_at,
      reason: grant.reason,
    };
  });
}

/**
 * Checks whether the given manager has an active, non-expired access grant
 * to the specified agent.
 * Returns true if authorized, false otherwise.
 */
export async function verifyManagerAgentAccess(
  managerId: string,
  agentId: string,
): Promise<boolean> {
  const result = await query<{ id: string }>(
    `SELECT id FROM manager_agent_access
     WHERE manager_id = $1 AND agent_id = $2
       AND is_active = TRUE
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [managerId, agentId],
  );
  return result.rows.length > 0;
}

/**
 * Lists agents accessible to the given manager.
 */
export async function listAgentsForManager(managerId: string): Promise<Array<{
  id: string;
  displayName: string;
  email: string;
  grantId: string;
  grantedAt: Date;
}>> {
  const result = await query<{
    id: string; display_name: string; email: string;
    grant_id: string; granted_at: Date;
  }>(
    `SELECT u.id, u.display_name, u.email, maa.id AS grant_id, maa.granted_at
     FROM manager_agent_access maa
     JOIN users u ON u.id = maa.agent_id
     JOIN roles r ON r.id = u.role_id AND r.name = 'AGENT'
     WHERE maa.manager_id = $1 AND maa.is_active = TRUE
       AND (maa.expires_at IS NULL OR maa.expires_at > NOW())
       AND u.is_active = TRUE
     ORDER BY u.display_name ASC`,
    [managerId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    grantId: row.grant_id,
    grantedAt: row.granted_at,
  }));
}

// ── Enrollment Token Management ───────────────────────────────────────────────

/**
 * Creates a cryptographically secure, single-use enrollment token.
 * The raw token is returned ONCE and NEVER stored — only its SHA-256 hash is persisted.
 *
 * The manager uses this token to give the agent client a way to self-register.
 */
export async function createEnrollmentToken(
  input: CreateEnrollmentTokenInput,
  actorId: string,
  actorEmail: string,
  actorRole: string,
  sourceIp: string,
  userAgent: string,
  requestId: string,
): Promise<EnrollmentTokenResult> {
  const rawToken = crypto.randomBytes(32).toString('hex'); // 256 bits of entropy
  const tokenHash = hashToken(rawToken);
  const tokenId = uuidv4();
  const expiresInHours = input.expiresInHours ?? 48;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  // Validate agentUserId if provided
  if (input.agentUserId) {
    const agentCheck = await query<{ id: string; role_name: string }>(
      `SELECT u.id, r.name AS role_name FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.is_active = TRUE`,
      [input.agentUserId],
    );
    const agent = agentCheck.rows[0];
    if (!agent || agent.role_name !== 'AGENT') {
      throw new Error('INVALID_AGENT: Pre-assigned user must have the AGENT role and be active');
    }
    // Also verify manager has (or will get) access to this agent
    const hasAccess = await verifyManagerAgentAccess(input.managerId, input.agentUserId);
    if (!hasAccess) {
      throw new Error('ACCESS_DENIED: Manager does not have an active access grant for this agent');
    }
  }

  await query(
    `INSERT INTO enrollment_tokens
       (id, token_hash, manager_id, agent_user_id, label, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      tokenId,
      tokenHash,
      input.managerId,
      input.agentUserId ?? null,
      input.label ?? null,
      expiresAt,
    ],
  );

  await audit.log({
    action: 'ENROLLMENT_TOKEN_CREATED',
    actorId,
    actorEmail,
    actorRole,
    details: {
      tokenId,
      managerId: input.managerId,
      agentUserId: input.agentUserId,
      label: input.label,
      expiresAt,
    },
    sourceIp,
    userAgent,
    requestId,
  });

  logger.info(
    { tokenId, managerId: input.managerId, agentUserId: input.agentUserId },
    'Enrollment token created',
  );

  return {
    tokenId,
    rawToken, // Shown to manager ONCE
    label: input.label,
    managerId: input.managerId,
    agentUserId: input.agentUserId,
    expiresAt,
  };
}

/**
 * Validates and consumes an enrollment token.
 * Called by the agent client during enrollment.
 *
 * Returns the associated managerId and agentUserId if valid.
 * Throws on: not found, expired, already consumed.
 */
export async function consumeEnrollmentToken(rawToken: string): Promise<{
  tokenId: string;
  managerId: string;
  agentUserId: string | null;
}> {
  const tokenHash = hashToken(rawToken);

  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string; manager_id: string; agent_user_id: string | null;
      is_consumed: boolean; expires_at: Date;
    }>(
      `SELECT id, manager_id, agent_user_id, is_consumed, expires_at
       FROM enrollment_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash],
    );

    const token = result.rows[0];

    if (!token) {
      throw new Error('INVALID_TOKEN: Enrollment token not found');
    }

    if (token.is_consumed) {
      throw new Error('TOKEN_USED: Enrollment token has already been used');
    }

    if (new Date() > token.expires_at) {
      throw new Error('TOKEN_EXPIRED: Enrollment token has expired');
    }

    // Mark as consumed
    await client.query(
      `UPDATE enrollment_tokens
       SET is_consumed = TRUE, consumed_at = NOW()
       WHERE id = $1`,
      [token.id],
    );

    logger.info(
      { tokenId: token.id, managerId: token.manager_id },
      'Enrollment token consumed',
    );

    return {
      tokenId: token.id,
      managerId: token.manager_id,
      agentUserId: token.agent_user_id,
    };
  });
}

/**
 * Lists enrollment tokens for a manager (non-sensitive view — no raw tokens ever).
 */
export async function listEnrollmentTokensForManager(managerId: string): Promise<Array<{
  id: string;
  label?: string;
  agentUserId?: string;
  isConsumed: boolean;
  expiresAt: Date;
  createdAt: Date;
}>> {
  const result = await query<{
    id: string; label?: string; agent_user_id?: string;
    is_consumed: boolean; expires_at: Date; created_at: Date;
  }>(
    `SELECT id, label, agent_user_id, is_consumed, expires_at, created_at
     FROM enrollment_tokens
     WHERE manager_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [managerId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    label: row.label,
    agentUserId: row.agent_user_id,
    isConsumed: row.is_consumed,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

// ── Agent Enrollment (called by Agent Client) ─────────────────────────────────

/**
 * Full agent enrollment flow:
 * 1. Validate enrollment token
 * 2. Consume token (mark used)
 * 3. Register device for the agent user
 * 4. Return device JWT for heartbeat use
 *
 * This is called by the agent client process, NOT by the manager frontend.
 */
export async function enrollAgent(
  enrollInput: AgentEnrollInput,
  sourceIp: string,
): Promise<AgentEnrollResult> {
  // Step 1 & 2: Validate + consume enrollment token
  const { managerId, agentUserId } = await consumeEnrollmentToken(enrollInput.rawToken);

  if (!agentUserId) {
    throw new Error(
      'ENROLLMENT_INCOMPLETE: This enrollment token does not have a pre-assigned agent user. ' +
      'The manager must associate an agent user with the enrollment token.',
    );
  }

  // Step 3: Register device using existing device service
  const { registerDevice } = await import('../devices/devices.service');
  const deviceResult = await registerDevice(
    {
      agentUserId,
      deviceName: enrollInput.deviceName,
      hostname: enrollInput.hostname,
      macAddress: enrollInput.macAddress ?? null,
      osType: enrollInput.osType ?? null,
      osVersion: enrollInput.osVersion ?? null,
      clientVersion: enrollInput.clientVersion ?? null,
    },
    managerId,                // Registered "by" the manager (via enrollment)
    'enrollment@system',      // System actor email for enrollment
    'MANAGER',
    sourceIp,
    'agent-client-enrollment',
    uuidv4(),
  );

  // Update enrollment token with the device ID
  await query(
    `UPDATE enrollment_tokens
     SET consumed_by_device_id = $1
     WHERE token_hash = $2`,
    [deviceResult.deviceId, hashToken(enrollInput.rawToken)],
  );

  await audit.log({
    action: 'AGENT_ENROLLED',
    targetId: agentUserId,
    targetType: 'USER',
    details: {
      managerId,
      agentUserId,
      deviceId: deviceResult.deviceId,
      hostname: enrollInput.hostname,
      deviceName: enrollInput.deviceName,
      sourceIp,
    },
  });

  logger.info(
    { agentUserId, managerId, deviceId: deviceResult.deviceId },
    'Agent enrolled successfully',
  );

  return {
    deviceId: deviceResult.deviceId,
    deviceToken: deviceResult.deviceToken,
    agentUserId,
    managerId,
    message: 'Enrollment successful. Use deviceToken for heartbeat authentication.',
  };
}

// ── Legacy helper (kept for backward compat with tests) ──────────────────────

/** @deprecated Use createEnrollmentToken() for real enrollment flows */
export function buildAgentEnrollmentCode(agentId: string): string {
  const normalized = agentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const seed = crypto.createHash('sha256').update(agentId).digest('hex').slice(0, 12).toUpperCase();
  const token = `${seed.slice(0, 4)}-${seed.slice(4, 8)}-${seed.slice(8, 12)}`;
  return normalized ? `${normalized.slice(0, 4).toUpperCase()}-${token}` : token;
}