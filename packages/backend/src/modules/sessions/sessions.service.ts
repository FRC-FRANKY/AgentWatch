/**
 * modules/sessions/sessions.service.ts — Monitoring Session Management
 *
 * IMPLEMENTS THE FULL 9-STEP AUTHORIZATION CHAIN:
 * 1. checkAuthenticated()         — caller must be authenticated (done by middleware)
 * 2. checkMFAVerified()           — caller must have MFA verified (done by middleware)
 * 3. checkRole()                  — caller must have 'sessions:request' permission (middleware)
 * 4. checkManagerAgentRelation()  — manager_agent_access row must exist and be active
 * 5. checkDeviceOwnership()       — device must belong to that agent
 * 6. checkDeviceOnline()          — device heartbeat must be recent
 * 7. checkNoActiveSession()       — no duplicate active session for this device
 * 8. createMonitoringSession()    — persisted to DB
 * 9. writeAuditLog()              — immutable audit entry
 *
 * PRIVACY: Screen content is NEVER stored. Session metadata only.
 */

import crypto from 'crypto';
import { query, withTransaction } from '../../config/database';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { setSessionState, deleteSessionState, setDevicePresence } from '../../config/firebase';
import { setFirestoreSessionStatus, setFirestoreSessionEnded, setFirestoreDashboardStats } from '../../config/firebase';
import type { MonitoringSession, CreateSessionDto, EndSessionDto } from '../../shared/types/session.types';

const audit = AuditService.getInstance();
type MonitoringSessionRow = MonitoringSession & Record<string, unknown>;

// ── Authorization Checks ──────────────────────────────────────────────────────

// ── Session Creation ──────────────────────────────────────────────────────────

export async function requestMonitoringSession(
  managerId: string,
  managerEmail: string,
  managerRole: string,
  dto: CreateSessionDto,
  sourceIp: string,
  userAgent: string,
  requestId: string,
): Promise<MonitoringSession> {
  const { agentId, deviceId } = dto;

  return withTransaction(async (client) => {
    // ── Step 4: Manager-Agent relationship ───────────────────────────────────
    const maaResult = await client.query(
      `SELECT id FROM manager_agent_access
       WHERE manager_id = $1 AND agent_id = $2
         AND is_active = TRUE
         AND (expires_at IS NULL OR expires_at > NOW())
       FOR UPDATE`,
      [managerId, agentId],
    );
    if (maaResult.rows.length === 0) {
      await audit.log({
        action: 'PERMISSION_DENIED',
        actorId: managerId, actorEmail: managerEmail, actorRole: managerRole,
        targetId: agentId, targetType: 'USER',
        details: { reason: 'NO_AGENT_ACCESS_GRANT', deviceId },
        sourceIp, userAgent, requestId,
      });
      throw new Error('AUTHORIZATION_DENIED: No access grant between this manager and agent');
    }

    // ── Step 5: Device ownership ─────────────────────────────────────────────
    const devResult = await client.query(
      `SELECT id, status, last_heartbeat_at FROM devices
       WHERE id = $1 AND agent_user_id = $2 AND is_active = TRUE`,
      [deviceId, agentId],
    );
    if (devResult.rows.length === 0) {
      throw new Error('AUTHORIZATION_DENIED: Device does not belong to the specified agent');
    }

    // ── Step 6: Device online ────────────────────────────────────────────────
    const device = devResult.rows[0] as { id: string; status: string; last_heartbeat_at: Date | null };
    if (device.status !== 'ONLINE') {
      throw new Error(`DEVICE_OFFLINE: Device is ${device.status}`);
    }
    if (!device.last_heartbeat_at) {
      throw new Error('DEVICE_OFFLINE: No heartbeat received');
    }
    const heartbeatAge = (Date.now() - device.last_heartbeat_at.getTime()) / 1000;
    if (heartbeatAge > env.DEVICE_OFFLINE_THRESHOLD_SECONDS) {
      throw new Error(`DEVICE_STALE: Last heartbeat ${Math.round(heartbeatAge)}s ago`);
    }

    // ── Step 7: No duplicate active session ──────────────────────────────────
    const dupResult = await client.query(
      `SELECT id FROM monitoring_sessions
       WHERE device_id = $1 AND status IN ('PENDING', 'ACTIVE')
       FOR UPDATE`,
      [deviceId],
    );
    if (dupResult.rows.length > 0) {
      throw new Error('SESSION_CONFLICT: Device already has an active monitoring session');
    }

    // ── Step 8: Create session ───────────────────────────────────────────────
    // Generate a short-lived WebRTC session token
    const webrtcToken = crypto.randomBytes(32).toString('hex');
    const webrtcTokenExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const sessionResult = await client.query<MonitoringSessionRow>(
      `INSERT INTO monitoring_sessions
         (manager_id, agent_id, device_id, status, webrtc_session_token,
          webrtc_token_expires_at, manager_ip, manager_user_agent)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7)
       RETURNING *`,
      [managerId, agentId, deviceId, webrtcToken, webrtcTokenExpiry, sourceIp, userAgent],
    );

    const session = sessionResult.rows[0] as MonitoringSession;

    // ── Step 9: Audit log ────────────────────────────────────────────────────
    await audit.log({
      action: 'MONITORING_REQUESTED',
      actorId: managerId, actorEmail: managerEmail, actorRole: managerRole,
      targetId: agentId, targetType: 'USER',
      sessionId: session.id,
      details: { deviceId, sessionId: session.id },
      sourceIp, userAgent, requestId,
    });

    logger.info(
      { sessionId: session.id, managerId, agentId, deviceId },
      'Monitoring session requested',
    );

    // Write initial session state to Firebase RTDB (fire-and-forget)
    void setSessionState(session.id, {
      status: 'PENDING',
      managerId,
      agentId,
      deviceId,
      requestedAt: Date.now(),
      startedAt: null,
      lastHeartbeatAt: null,
      endedAt: null,
    });

    // Write initial session state to Firestore
    void setFirestoreSessionStatus(session.id, {
      managerId,
      agentId,
      deviceId,
      status: 'PENDING',
      requestedAt: new Date(),
      startedAt: null,
      endedAt: null,
    });

    // Update device presence with active session ID
    void setDevicePresence(deviceId, {
      online: true,
      agentUserId: agentId,
      lastSeen: Date.now(),
      sessionId: session.id,
    });

    return session;
  });
}

// ── Session Lifecycle ─────────────────────────────────────────────────────────

export async function startSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE monitoring_sessions
     SET status = 'ACTIVE', started_at = NOW()
     WHERE id = $1 AND status = 'PENDING'`,
    [sessionId],
  );

  const result = await query<{ manager_id: string; agent_id: string; device_id: string }>(
    `SELECT manager_id, agent_id, device_id FROM monitoring_sessions WHERE id = $1`,
    [sessionId],
  );

  if (result.rows[0]) {
    const s = result.rows[0];
    await audit.log({
      action: 'MONITORING_STARTED',
      targetId: s.agent_id, targetType: 'USER',
      sessionId,
      details: { managerId: s.manager_id, deviceId: s.device_id },
    });

    // Update Firebase RTDB session status to CONNECTED
    void setSessionState(sessionId, {
      status: 'CONNECTED',
      startedAt: Date.now(),
    });

    // Update Firestore session status
    void setFirestoreSessionStatus(sessionId, {
      managerId: s.manager_id,
      agentId: s.agent_id,
      deviceId: s.device_id,
      status: 'CONNECTED',
      startedAt: new Date(),
    });
  }
}

export async function endSession(
  sessionId: string,
  endedById: string,
  endedByEmail: string,
  endedByRole: string,
  dto: EndSessionDto,
  sourceIp: string,
  userAgent: string,
  requestId: string,
): Promise<void> {
  // Authorization: only the manager who owns the session, or ADMIN, can end it
  const result = await query<{
    manager_id: string; agent_id: string; device_id: string; status: string; started_at: Date | null;
  }>(
    `SELECT manager_id, agent_id, device_id, status, started_at
     FROM monitoring_sessions WHERE id = $1`,
    [sessionId],
  );

  const session = result.rows[0];
  if (!session) throw new Error('Session not found');

  // F-06 FIX: TEAM_LEADER can only end sessions for their supervised agents.
  // Previously blanket TEAM_LEADER role allowed ending ANY session (IDOR).
  let canEnd = endedById === session.manager_id || endedByRole === 'ADMIN';
  if (!canEnd && endedByRole === 'TEAM_LEADER') {
    const tl = await query<{ id: string }>(
      `SELECT maa.id FROM manager_agent_access maa
       WHERE maa.manager_id = $1 AND maa.agent_id = $2 AND maa.is_active = TRUE`,
      [endedById, session.agent_id],
    );
    canEnd = tl.rows.length > 0;
  }

  if (!canEnd) {
    await audit.log({
      action: 'PERMISSION_DENIED',
      actorId: endedById, actorEmail: endedByEmail, actorRole: endedByRole,
      sessionId,
      details: { reason: 'NOT_SESSION_OWNER', sessionId },
      sourceIp, userAgent, requestId,
    });
    throw new Error('AUTHORIZATION_DENIED: Access denied'); // F-22: generic message
  }

  if (!['PENDING', 'ACTIVE'].includes(session.status)) {
    throw new Error(`Session is already in terminal state: ${session.status}`);
  }

  const durationSeconds = session.started_at
    ? Math.floor((Date.now() - session.started_at.getTime()) / 1000)
    : null;

  await query(
    `UPDATE monitoring_sessions
     SET status = 'ENDED',
         ended_at = NOW(),
         ended_by = $2,
         termination_reason = $3,
         session_duration_seconds = $4,
         webrtc_session_token = NULL  -- Clear WebRTC token immediately
     WHERE id = $1`,
    [sessionId, endedById, dto.reason, durationSeconds],
  );

  const action = dto.reason === 'AGENT_TERMINATE' ? 'MONITORING_TERMINATED' : 'MONITORING_ENDED';

  await audit.log({
    action,
    actorId: endedById, actorEmail: endedByEmail, actorRole: endedByRole,
    targetId: session.agent_id, targetType: 'USER',
    sessionId,
    details: {
      reason: dto.reason,
      durationSeconds,
      deviceId: session.device_id,
    },
    sourceIp, userAgent, requestId,
  });

  logger.info({ sessionId, reason: dto.reason, durationSeconds }, 'Monitoring session ended');

  // Remove active session state from Firebase RTDB (session is now in terminal state)
  void deleteSessionState(sessionId);
  // Update device presence — clear session ID
  void setDevicePresence(session.device_id, {
    online: true,
    agentUserId: session.agent_id,
    lastSeen: Date.now(),
    sessionId: null,
  });

  // Mark session ENDED in Firestore
  void setFirestoreSessionEnded(sessionId, new Date());

  // Refresh dashboard stats for the session owner in Firestore (best-effort)
  void (async () => {
    try {
      const statsResult = await query<{ status: string; count: string }>(
        `SELECT d.status, COUNT(DISTINCT d.agent_user_id)::text AS count
         FROM devices d
         JOIN users u ON u.id = d.agent_user_id
         JOIN roles r ON r.id = u.role_id
         JOIN manager_agent_access maa ON maa.agent_id = u.id AND maa.manager_id = $1
           AND maa.is_active = TRUE
         WHERE r.name = 'AGENT' AND d.is_active = TRUE AND u.is_active = TRUE
         GROUP BY d.status`,
        [endedById === session.manager_id ? endedById : session.manager_id],
      );
      const activeSessions = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM monitoring_sessions
         WHERE manager_id = $1 AND status IN ('PENDING', 'ACTIVE')`,
        [session.manager_id],
      );
      let online = 0; let offline = 0;
      for (const r of statsResult.rows) {
        if (r.status === 'ONLINE') online = parseInt(r.count, 10);
        else offline += parseInt(r.count, 10);
      }
      void setFirestoreDashboardStats(session.manager_id, {
        onlineAgents: online,
        offlineAgents: offline,
        activeMonitoring: parseInt(activeSessions.rows[0]?.count ?? '0', 10),
      });
    } catch {
      // Non-critical — dashboard stats can be slightly stale
    }
  })();
}

export async function getSessionById(
  sessionId: string,
  requestingUserId: string,
  requestingUserRole: string,
): Promise<MonitoringSession | null> {
  const result = await query<MonitoringSessionRow>(
    `SELECT * FROM monitoring_sessions WHERE id = $1`,
    [sessionId],
  );

  const session = result.rows[0];
  if (!session) return null;

  // ADMIN can view any session
  if (requestingUserRole === 'ADMIN') {
    session.webrtcSessionToken = undefined;
    session.webrtcTokenExpiresAt = undefined;
    return session;
  }

  // Resource-level authorization (Phase 8):
  // Verify the full ownership chain:
  //   session → agent → manager_agent_access → authenticated manager
  //
  // Checking session.managerId alone is insufficient — it doesn't prevent IDOR
  // if a manager is somehow presented with a session ID they don't own.
  // We also verify the manager-agent access grant is still active.
  const accessCheck = await query<{ id: string }>(
    `SELECT maa.id
     FROM monitoring_sessions ms
     JOIN manager_agent_access maa
       ON maa.manager_id = $1
      AND maa.agent_id = ms.agent_id
      AND maa.is_active = TRUE
      AND (maa.expires_at IS NULL OR maa.expires_at > NOW())
     WHERE ms.id = $2
       AND ms.manager_id = $1`,
    [requestingUserId, sessionId],
  );

  if (accessCheck.rows.length === 0) {
    // Do not reveal whether the session exists at all
    return null;
  }

  // Never return the WebRTC session token via API
  session.webrtcSessionToken = undefined;
  session.webrtcTokenExpiresAt = undefined;

  return session;
}
