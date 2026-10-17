/**
 * shared/types/session.types.ts
 */

export type SessionStatus = 'PENDING' | 'ACTIVE' | 'ENDED' | 'TERMINATED' | 'EXPIRED' | 'FAILED';

export interface MonitoringSession {
  id: string;
  managerId: string;
  agentId: string;
  deviceId: string;
  status: SessionStatus;
  requestedAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  endedBy?: string;
  terminationReason?: string;
  webrtcSessionToken?: string;
  webrtcTokenExpiresAt?: Date;
  managerIp?: string;
  managerUserAgent?: string;
  sessionDurationSeconds?: number;
}

export interface CreateSessionDto {
  agentId: string;
  deviceId: string;
}

export interface EndSessionDto {
  reason: 'MANAGER_REQUEST' | 'AGENT_TERMINATE' | 'ADMIN_TERMINATE' | 'TIMEOUT' | 'ERROR';
}
