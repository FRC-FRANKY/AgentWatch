/**
 * modules/auth/token.service.ts — JWT & Refresh Token Management
 *
 * SECURITY DESIGN:
 * - Access tokens: 15-minute expiry, HS256, contain mfa_verified claim
 * - Refresh tokens: 7-day expiry, stored as SHA-256 hash, rotation on every use
 * - Partial token: separate secret (F-09 fix), valid only for MFA step (5 min)
 * - Token reuse detection: revoked token reuse → entire family revoked
 * - mfa_verified stored in refresh_tokens row (F-10 fix) — preserved on rotation
 * - No tokens in logs (logger.ts redacts them)
 */

import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../../config/env';
import { query, withTransaction } from '../../config/database';
import { logger } from '../../config/logger';
import type { JwtAccessPayload, JwtRefreshPayload } from '../../shared/types/auth.types';

// ── Token Hashing ─────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ── Access Token ──────────────────────────────────────────────────────────────

export function issueAccessToken(
  payload: Omit<JwtAccessPayload, 'iat' | 'exp' | 'jti'>,
): string {
  const jti = uuidv4();
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn'],
    issuer: 'agentwatch',
    audience: 'agentwatch-api',
  };

  return jwt.sign(
    { ...payload, jti },
    env.JWT_ACCESS_SECRET as Secret,
    options,
  );
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'agentwatch',
    audience: 'agentwatch-api',
  }) as JwtAccessPayload;
}

/**
 * Partial token: issued after successful password verification, before MFA.
 * Valid only for the MFA verify endpoint (audience: agentwatch-mfa), expires in 5 minutes.
 *
 * F-09 FIX: Uses JWT_PARTIAL_SECRET — a separate key from JWT_ACCESS_SECRET.
 * Compromise of one secret does not compromise both token types.
 */
export function issuePartialToken(userId: string, email: string, role: string, roleId: string): string {
  const options: SignOptions = {
    expiresIn: '5m',
    issuer: 'agentwatch',
    audience: 'agentwatch-mfa',
  };

  return jwt.sign(
    { sub: userId, email, role, roleId, mfa_verified: false, partial: true },
    env.JWT_PARTIAL_SECRET as Secret,
    options,
  );
}

export function verifyPartialToken(token: string): JwtAccessPayload {
  const payload = jwt.verify(token, env.JWT_PARTIAL_SECRET, {  // F-09: separate secret
    issuer: 'agentwatch',
    audience: 'agentwatch-mfa',
  }) as JwtAccessPayload & { partial?: boolean };

  if (!payload.partial) {
    throw new Error('Not a partial token');
  }
  return payload;
}

// ── Refresh Token ─────────────────────────────────────────────────────────────

/**
 * F-10 FIX: mfaVerified parameter is stored in the refresh_tokens row.
 * On rotation, it is read back and used to re-issue the access token —
 * instead of deriving it from is_mfa_enabled (which would silently elevate tokens).
 */
export async function issueRefreshToken(
  userId: string,
  familyId: string,
  sourceIp?: string,
  userAgent?: string,
  mfaVerified = false,   // F-10: stored with the token
): Promise<string> {
  if (process.env.USE_DEMO_MODE === 'true') {
    const raw = crypto.randomBytes(64).toString('hex');
    const refreshToken: JwtRefreshPayload = {
      sub: userId,
      family: familyId,
      jti: `demo-${uuidv4()}`,
    };

    const options: SignOptions = {
      expiresIn: env.JWT_REFRESH_EXPIRY as SignOptions['expiresIn'],
      issuer: 'agentwatch',
      audience: 'agentwatch-refresh',
    };

    return jwt.sign(refreshToken, env.JWT_REFRESH_SECRET as Secret, options) + '.' + raw;
  }

  const raw = crypto.randomBytes(64).toString('hex');
  const tokenHash = hashToken(raw);
  const tokenId = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7d

  await query(
    `INSERT INTO refresh_tokens
       (id, user_id, token_hash, family_id, expires_at, source_ip, user_agent, mfa_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tokenId, userId, tokenHash, familyId, expiresAt, sourceIp, userAgent, mfaVerified],
  );

  const refreshToken: JwtRefreshPayload = {
    sub: userId,
    family: familyId,
    jti: tokenId,
  };

  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRY as SignOptions['expiresIn'],
    issuer: 'agentwatch',
    audience: 'agentwatch-refresh',
  };

  return jwt.sign(refreshToken, env.JWT_REFRESH_SECRET as Secret, options) + '.' + raw;
}

/**
 * Rotates refresh token.
 * Returns mfaVerified from the stored record (F-10 fix).
 */
export async function rotateRefreshToken(
  incomingToken: string,
  sourceIp?: string,
  userAgent?: string,
): Promise<{ userId: string; familyId: string; newRefreshToken: string; mfaVerified: boolean }> {
  const lastDotIdx = incomingToken.lastIndexOf('.');
  if (lastDotIdx === -1) {
    throw new Error('Invalid refresh token format');
  }
  const jwtPart = incomingToken.slice(0, lastDotIdx);
  const rawEntropy = incomingToken.slice(lastDotIdx + 1);

  let payload: JwtRefreshPayload;
  try {
    payload = jwt.verify(jwtPart, env.JWT_REFRESH_SECRET, {
      issuer: 'agentwatch',
      audience: 'agentwatch-refresh',
    }) as JwtRefreshPayload;
  } catch {
    throw new Error('Invalid or expired refresh token');
  }

  // Demo mode: skip DB lookup and just re-issue a new refresh token
  if (process.env.USE_DEMO_MODE === 'true') {
    const newFamilyId = payload.family ?? uuidv4();
    const newRaw = crypto.randomBytes(64).toString('hex');
    const newId = `demo-${uuidv4()}`;
    const newJwt: JwtRefreshPayload = {
      sub: payload.sub,
      family: newFamilyId,
      jti: newId,
    };
    const refreshOptions: SignOptions = {
      expiresIn: env.JWT_REFRESH_EXPIRY as SignOptions['expiresIn'],
      issuer: 'agentwatch',
      audience: 'agentwatch-refresh',
    };
    const newRefreshToken = jwt.sign(newJwt, env.JWT_REFRESH_SECRET as Secret, refreshOptions) + '.' + newRaw;
    return { userId: payload.sub, familyId: newFamilyId, newRefreshToken, mfaVerified: true };
  }

  const tokenHash = hashToken(rawEntropy);

  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string; user_id: string; family_id: string;
      is_revoked: boolean; expires_at: Date; mfa_verified: boolean;
    }>(
      `SELECT id, user_id, family_id, is_revoked, expires_at, mfa_verified
       FROM refresh_tokens
       WHERE token_hash = $1 AND user_id = $2
       FOR UPDATE`,
      [tokenHash, payload.sub],
    );

    const storedToken = result.rows[0];

    if (!storedToken) {
      logger.warn({ userId: payload.sub }, 'Refresh token not found — possible forgery attempt');
      throw new Error('Invalid refresh token');
    }

    if (storedToken.is_revoked) {
      // TOKEN REUSE ATTACK — revoke entire family
      logger.error(
        { userId: payload.sub, familyId: storedToken.family_id },
        'Refresh token reuse detected — revoking entire token family',
      );
      await client.query(
        `UPDATE refresh_tokens
         SET is_revoked = TRUE, revoked_at = NOW(), revoked_reason = 'SUSPICIOUS'
         WHERE family_id = $1 AND user_id = $2`,
        [storedToken.family_id, payload.sub],
      );
      throw new Error('Security violation: refresh token reuse detected. Please log in again.');
    }

    if (new Date() > storedToken.expires_at) {
      throw new Error('Refresh token expired');
    }

    if (storedToken.family_id !== payload.family) {
      logger.error({ userId: payload.sub }, 'Refresh token family mismatch');
      throw new Error('Invalid refresh token');
    }

    // Revoke old token
    await client.query(
      `UPDATE refresh_tokens
       SET is_revoked = TRUE, revoked_at = NOW(), revoked_reason = 'ROTATED', last_used_at = NOW()
       WHERE id = $1`,
      [storedToken.id],
    );

    // Issue new token in same family — preserve mfa_verified state (F-10)
    const newRaw = crypto.randomBytes(64).toString('hex');
    const newHash = hashToken(newRaw);
    const newId = uuidv4();
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await client.query(
      `INSERT INTO refresh_tokens
         (id, user_id, token_hash, family_id, expires_at, source_ip, user_agent, mfa_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId, payload.sub, newHash, storedToken.family_id, newExpiry,
       sourceIp, userAgent, storedToken.mfa_verified],
    );

    const newJwt: JwtRefreshPayload = {
      sub: payload.sub,
      family: storedToken.family_id,
      jti: newId,
    };

    const refreshOptions: SignOptions = {
      expiresIn: env.JWT_REFRESH_EXPIRY as SignOptions['expiresIn'],
      issuer: 'agentwatch',
      audience: 'agentwatch-refresh',
    };

    const newRefreshToken =
      jwt.sign(newJwt, env.JWT_REFRESH_SECRET as Secret, refreshOptions) + '.' + newRaw;

    return {
      userId: payload.sub,
      familyId: storedToken.family_id,
      newRefreshToken,
      mfaVerified: storedToken.mfa_verified,  // F-10: return stored value
    };
  });
}

export async function revokeAllUserTokens(userId: string, reason: string): Promise<void> {
  if (process.env.USE_DEMO_MODE === 'true') {
    // In demo mode, no DB — nothing to revoke
    return;
  }
  await query(
    `UPDATE refresh_tokens
     SET is_revoked = TRUE, revoked_at = NOW(), revoked_reason = $2
     WHERE user_id = $1 AND is_revoked = FALSE`,
    [userId, reason],
  );
}

export function buildTokenPair(accessToken: string): { accessToken: string; expiresIn: number } {
  const decoded = jwt.decode(accessToken) as { exp?: number };
  const expiresIn = decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900;
  return { accessToken, expiresIn };
}
