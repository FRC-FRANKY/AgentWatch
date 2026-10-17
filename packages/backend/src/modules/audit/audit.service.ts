/**
 * modules/audit/audit.service.ts — Immutable Audit Trail
 *
 * SECURITY:
 * - Singleton pattern ensures single write path
 * - All writes are INSERT-only (DB trigger blocks UPDATE/DELETE)
 * - Redacts sensitive fields before writing — recursive deep scan (F-21 fix)
 * - F-05 FIX: CRITICAL security actions (monitoring, permission changes) will
 *   re-throw on write failure — these events MUST be recorded
 * - F-21 FIX: sanitizeDetails now performs deep recursive sanitization —
 *   previously only top-level keys were checked, allowing nested secret fields
 */

import { query } from '../../config/database';
import { logger } from '../../config/logger';
import type { CreateAuditLogDto } from '../../shared/types/audit.types';

// Fields that must NEVER appear in audit log details (at any nesting depth)
const FORBIDDEN_DETAIL_KEYS = new Set([
  'password', 'password_hash', 'passwordHash', 'token', 'accessToken',
  'refreshToken', 'deviceToken', 'secret', 'mfaSecret', 'totp',
  'otp', 'screen_content', 'screenContent', 'keystrokes', 'mfa_secret',
]);

// F-05: Actions where audit failure should fail the parent operation
const CRITICAL_AUDIT_ACTIONS = new Set([
  'MONITORING_REQUESTED',
  'MONITORING_STARTED',
  'MONITORING_ENDED',
  'MONITORING_TERMINATED',
  'PERMISSION_DENIED',
  'ROLE_CHANGED',
  'USER_DISABLED',
  'DEVICE_REGISTERED',
  'ACCOUNT_LOCKED',
  'SECURITY_EVENT',
]);

// F-21 FIX: Deep recursive sanitizer — checks nested objects at all levels
function sanitizeDetails(
  details?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  return sanitizeDeep(details) as Record<string, unknown>;
}

function sanitizeDeep(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(sanitizeDeep);

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_DETAIL_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeDeep(val);
    }
  }
  return result;
}

async function writeAuditEntry(dto: CreateAuditLogDto, sanitized: Record<string, unknown> | undefined): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (action, actor_id, actor_email, actor_role, target_id, target_type,
        session_id, details, source_ip, user_agent, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      dto.action,
      dto.actorId ?? null,
      dto.actorEmail ?? null,
      dto.actorRole ?? null,
      dto.targetId ?? null,
      dto.targetType ?? null,
      dto.sessionId ?? null,
      sanitized ? JSON.stringify(sanitized) : null,
      dto.sourceIp ?? null,
      dto.userAgent ?? null,
      dto.requestId ?? null,
    ],
  );
}

export class AuditService {
  private static instance: AuditService;

  private constructor() {}

  static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  /**
   * Write an audit log entry.
   *
   * F-05 FIX: For CRITICAL_AUDIT_ACTIONS (monitoring, security events),
   * write failures are re-thrown — the calling operation must fail rather than
   * silently lose the audit record. Non-critical events still fail gracefully.
   *
   * NEVER include passwords, tokens, or screen content in details.
   */
  async log(dto: CreateAuditLogDto): Promise<void> {
    const sanitized = sanitizeDetails(dto.details);
    const isCritical = CRITICAL_AUDIT_ACTIONS.has(dto.action);

    try {
      await writeAuditEntry(dto, sanitized);
    } catch (err) {
      logger.error(
        {
          error: (err as Error).message,
          action: dto.action,
          actorId: dto.actorId,
          isCritical,
        },
        'CRITICAL: Audit log write failed',
      );

      if (isCritical) {
        // F-05: Re-throw for monitoring/security events — caller must handle this
        throw new Error(
          `Audit write failed for critical action '${dto.action}'. ` +
          'The operation has been aborted to maintain accountability.',
        );
      }
      // Non-critical audit failures: log and continue
    }
  }

  /**
   * Write a security event (higher urgency, separate table).
   * Security events always re-throw on write failure.
   */
  async logSecurityEvent(params: {
    eventType: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    actorId?: string;
    actorEmail?: string;
    targetId?: string;
    targetType?: string;
    sourceIp?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const sanitized = params.details ? sanitizeDetails(params.details) : null;
    try {
      await query(
        `INSERT INTO security_events
           (event_type, severity, actor_id, actor_email, target_id, target_type,
            source_ip, user_agent, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          params.eventType,
          params.severity,
          params.actorId ?? null,
          params.actorEmail ?? null,
          params.targetId ?? null,
          params.targetType ?? null,
          params.sourceIp ?? null,
          params.userAgent ?? null,
          sanitized ? JSON.stringify(sanitized) : null,
        ],
      );
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Security event write failed');
      throw err; // Security events always propagate
    }
  }
}
