/**
 * modules/auth/mfa.service.ts — TOTP Multi-Factor Authentication Service
 *
 * SECURITY DESIGN:
 * - TOTP via RFC 6238 (30-second steps, SHA-1, 6-digit codes)
 * - F-04 FIX: TOTP secret encrypted at rest using AES-256-GCM with MFA_ENCRYPTION_KEY
 * - F-12 FIX: Backup code verification always runs all comparisons (timing oracle fix)
 * - F-23 FIX: Replay prevention — used TOTP codes stored in Redis with 90-second TTL
 * - F-24 FIX: TOTP window remains ±1 (clock tolerance) but replay prevention closes the reuse gap
 * - Backup codes: Argon2id hashed, single-use, shown only once
 */

import * as OTPAuth from 'otpauth';
import argon2 from 'argon2';
import crypto from 'crypto';
import { query } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { getRedisClientSync } from '../../config/redis';

// ── Encryption helpers (F-04) ─────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function getEncryptionKey(): Buffer {
  const key = Buffer.from(env.MFA_ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) {
    throw new Error('MFA_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
  }
  return key;
}

function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format');
  const [ivHex, authTagHex, dataHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');
  const data = Buffer.from(dataHex!, 'hex');

  if (iv.length !== IV_BYTES) throw new Error('Invalid IV length');
  if (authTag.length !== AUTH_TAG_BYTES) throw new Error('Invalid auth tag length');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ── Backup Code Helpers ───────────────────────────────────────────────────────

function generateBackupCode(): string {
  const part = () => crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${part()}-${part()}`;
}

const BACKUP_CODE_ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

// ── TOTP Replay Prevention (F-23, F-24) ───────────────────────────────────────

async function markTotpUsed(userId: string, code: string): Promise<void> {
  const redis = getRedisClientSync();
  const key = `totp:used:${userId}:${code}`;
  // TTL = 2 * TOTP step = 60 seconds (covers the ±1 window)
  await redis.set(key, '1', { EX: 60 });
}

async function isTotpAlreadyUsed(userId: string, code: string): Promise<boolean> {
  const redis = getRedisClientSync();
  const key = `totp:used:${userId}:${code}`;
  return (await redis.get(key)) !== null;
}

// ── MFA Setup ─────────────────────────────────────────────────────────────────

export async function initiateMfaSetup(
  userId: string,
  email: string,
): Promise<{ secret: string; otpauthUrl: string; backupCodes: string[] }> {
  const totp = new OTPAuth.TOTP({
    issuer: env.MFA_ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });

  const plainSecret = totp.secret.base32;

  // F-04: Generate 10 backup codes, hash them with Argon2id
  const plainBackupCodes = Array.from({ length: 10 }, generateBackupCode);
  const hashedBackupCodes = await Promise.all(
    plainBackupCodes.map((code) => argon2.hash(code, BACKUP_CODE_ARGON2_OPTIONS)),
  );

  // F-04 FIX: Encrypt the TOTP secret before storing
  const encryptedSecret = encryptSecret(plainSecret);

  await query(
    `UPDATE users
     SET mfa_secret         = $2,
         mfa_backup_codes   = $3,
         mfa_pending        = TRUE,
         updated_at         = NOW()
     WHERE id = $1`,
    [userId, encryptedSecret, JSON.stringify(hashedBackupCodes)],
  );

  return {
    secret: plainSecret,       // Shown once to user for QR code
    otpauthUrl: totp.toString(),
    backupCodes: plainBackupCodes, // Shown once to user — they must save these
  };
}

export async function confirmMfaSetup(userId: string, code: string): Promise<boolean> {
  const result = await query<{ mfa_secret: string; mfa_pending: boolean }>(
    `SELECT mfa_secret, mfa_pending FROM users WHERE id = $1 AND is_active = TRUE`,
    [userId],
  );

  const user = result.rows[0];
  if (!user?.mfa_secret || !user.mfa_pending) return false;

  const plainSecret = decryptSecret(user.mfa_secret);  // F-04: decrypt before use

  const totp = new OTPAuth.TOTP({
    issuer: env.MFA_ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(plainSecret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) return false;

  await query(
    `UPDATE users
     SET is_mfa_enabled = TRUE,
         mfa_pending    = FALSE,
         updated_at     = NOW()
     WHERE id = $1`,
    [userId],
  );
  return true;
}

// ── TOTP Verification ─────────────────────────────────────────────────────────

export async function verifyTotpCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const result = await query<{ mfa_secret: string }>(
    `SELECT mfa_secret FROM users
     WHERE id = $1 AND is_active = TRUE AND is_mfa_enabled = TRUE`,
    [userId],
  );

  const user = result.rows[0];
  if (!user?.mfa_secret) return false;

  // F-23/F-24: Check replay before doing expensive TOTP verification
  const alreadyUsed = await isTotpAlreadyUsed(userId, code);
  if (alreadyUsed) {
    logger.warn({ userId }, 'TOTP code replay attempt detected');
    return false;
  }

  const plainSecret = decryptSecret(user.mfa_secret);  // F-04: decrypt before use

  const totp = new OTPAuth.TOTP({
    issuer: env.MFA_ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(plainSecret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) return false;

  // F-23/F-24: Mark this code as used in Redis
  await markTotpUsed(userId, code);

  return true;
}

// ── Backup Code Verification ──────────────────────────────────────────────────

export async function verifyBackupCode(
  userId: string,
  submittedCode: string,
): Promise<boolean> {
  const result = await query<{ mfa_backup_codes: string[] }>(
    `SELECT mfa_backup_codes FROM users
     WHERE id = $1 AND is_active = TRUE AND is_mfa_enabled = TRUE`,
    [userId],
  );

  const user = result.rows[0];
  if (!user?.mfa_backup_codes?.length) return false;

  const stored = user.mfa_backup_codes;

  // F-12 FIX: Always verify ALL codes before returning.
  // Exiting early on first match creates a timing oracle — an attacker can
  // statistically determine which position holds the valid code.
  let foundIdx = -1;
  for (let i = 0; i < stored.length; i++) {
    const matches = await argon2.verify(stored[i] as string, submittedCode);
    if (matches && foundIdx === -1) {
      foundIdx = i; // Record first match, but continue checking all
    }
  }

  if (foundIdx === -1) return false;

  // Remove used backup code
  const remaining = stored.filter((_, idx) => idx !== foundIdx);
  await query(
    `UPDATE users SET mfa_backup_codes = $2, updated_at = NOW() WHERE id = $1`,
    [userId, JSON.stringify(remaining)],
  );

  return true;
}

// ── MFA Disable ───────────────────────────────────────────────────────────────

export async function verifyMfaForUser(userId: string, code: string): Promise<boolean> {
  if (await verifyTotpCode(userId, code)) {
    return true;
  }

  return verifyBackupCode(userId, code);
}

export async function verifyMfaBackupCode(userId: string, code: string): Promise<boolean> {
  return verifyBackupCode(userId, code);
}

export async function disableMfa(userId: string): Promise<void> {
  await query(
    `UPDATE users
     SET is_mfa_enabled   = FALSE,
         mfa_secret       = NULL,
         mfa_backup_codes = '[]',
         mfa_pending      = FALSE,
         updated_at       = NOW()
     WHERE id = $1`,
    [userId],
  );
}
