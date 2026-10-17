/**
 * shared/types/audit.types.ts
 */

export type AuditAction =
  | 'LOGIN' | 'LOGOUT' | 'FAILED_LOGIN' | 'ACCOUNT_LOCKED' | 'ACCOUNT_UNLOCKED'
  | 'MFA_SETUP' | 'MFA_SUCCESS' | 'MFA_FAILURE' | 'MFA_BACKUP_USED'
  | 'PASSWORD_CHANGED' | 'PASSWORD_RESET_REQUESTED'
  | 'DEVICE_REGISTERED' | 'DEVICE_ONLINE' | 'DEVICE_OFFLINE' | 'DEVICE_DISABLED'
  | 'MONITORING_REQUESTED' | 'MONITORING_STARTED' | 'MONITORING_ENDED'
  | 'MONITORING_TERMINATED' | 'MONITORING_EXPIRED'
  | 'PERMISSION_DENIED' | 'ACCESS_GRANTED' | 'ACCESS_REVOKED'
  | 'ROLE_CHANGED' | 'USER_CREATED' | 'USER_UPDATED' | 'USER_DISABLED' | 'USER_ENABLED'
  | 'SECURITY_EVENT' | 'SESSION_EXPIRED' | 'TOKEN_REFRESHED'
  | 'AUDIT_LOG_VIEWED' | 'SETTINGS_CHANGED'
  | 'ENROLLMENT_TOKEN_CREATED' | 'AGENT_ENROLLED';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  targetId?: string;
  targetType?: string;
  sessionId?: string;
  details?: Record<string, unknown>;  // NEVER passwords, tokens, or screen content
  sourceIp?: string;
  userAgent?: string;
  requestId?: string;
  createdAt: Date;
}

export interface CreateAuditLogDto {
  action: AuditAction;
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  targetId?: string;
  targetType?: string;
  sessionId?: string;
  details?: Record<string, unknown>;
  sourceIp?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuditLogQuery {
  action?: AuditAction;
  actorId?: string;
  targetId?: string;
  sessionId?: string;
  sourceIp?: string;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  limit?: number;
}
