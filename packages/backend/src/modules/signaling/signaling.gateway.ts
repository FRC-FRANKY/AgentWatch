/**
 * modules/signaling/signaling.gateway.ts — WebSocket Signaling Server
 *
 * SECURITY DESIGN:
 * - F-01 FIX: WebSocket AUTH now requires a valid JWT access token in addition
 *   to the webrtc_session_token. The JWT cryptographically binds the connection
 *   to a specific, MFA-verified user identity. Client-supplied userId is no
 *   longer trusted — identity is read from the verified JWT claims.
 * - F-17 FIX: END_SESSION now calls endSession() to update the DB record.
 *   Previously, cleanupSession() only closed WebSocket connections but left
 *   the monitoring_sessions row in ACTIVE state indefinitely.
 * - Session token verified against DB before any signaling is allowed
 * - Agent and Manager connections are tracked separately per session
 * - WebRTC signals relayed only between authorized peers in same session
 * - TURN credentials are time-limited and session-scoped (never reused)
 * - Unknown message types rejected — strict allowlist
 */

import http from 'http';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { query } from '../../config/database';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { verifyAccessToken } from '../auth/token.service';
import { endSession } from '../sessions/sessions.service';
import type { JwtAccessPayload } from '../../shared/types/auth.types';

// ── Types ─────────────────────────────────────────────────────────────────────

type PeerRole = 'MANAGER' | 'AGENT';

interface AuthenticatedPeer {
  ws: WebSocket;
  role: PeerRole;
  userId: string;
  userEmail: string;
  sessionId: string;
  authenticated: boolean;
}

// Allowed WebRTC signaling message types — strict allowlist
const ALLOWED_SIGNAL_TYPES = new Set([
  'OFFER', 'ANSWER', 'ICE_CANDIDATE',
]);

// In-memory WebSocket session state: sessionId → { manager, agent }
const sessions = new Map<string, { manager?: AuthenticatedPeer; agent?: AuthenticatedPeer }>();

// ── TURN Credentials ──────────────────────────────────────────────────────────

function generateTurnCredentials(sessionId: string): {
  urls: string[]; username: string; credential: string; ttl: number;
} {
  const ttl = env.TURN_CREDENTIAL_TTL_SECONDS;
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}:${sessionId.slice(0, 8)}`;
  const credential = crypto
    .createHmac('sha1', env.TURN_SECRET)
    .update(username)
    .digest('base64');
  return {
    urls: env.TURN_SERVER_URLS.split(',').map((u) => u.trim()),
    username, credential, ttl,
  };
}

// ── Session State ──────────────────────────────────────────────────────────────

function getOrCreateSessionState(sessionId: string): {
  manager?: AuthenticatedPeer; agent?: AuthenticatedPeer;
} {
  if (!sessions.has(sessionId)) sessions.set(sessionId, {});
  return sessions.get(sessionId)!;
}

function cleanupSession(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  if (state.manager?.ws.readyState === WebSocket.OPEN) state.manager.ws.close(1000, 'Session ended');
  if (state.agent?.ws.readyState === WebSocket.OPEN) state.agent.ws.close(1000, 'Session ended');
  sessions.delete(sessionId);
  logger.info({ sessionId }, 'Signaling session cleaned up');
}

// ── WebSocket Gateway Factory ─────────────────────────────────────────────────

export function createSignalingGateway(server: http.Server): void {
  const wss = new WebSocketServer({
    server,
    path: '/ws/signal',
    maxPayload: 64 * 1024, // 64 KB — prevent memory exhaustion
  });

  wss.on('connection', (ws: WebSocket, req) => {
    let peer: AuthenticatedPeer | null = null;
    const connectionIp = req.socket.remoteAddress ?? 'unknown';

    // Must authenticate within 10 seconds
    const authTimeout = setTimeout(() => {
      if (!peer?.authenticated) {
        logger.warn({ ip: connectionIp }, 'WebSocket auth timeout — closing connection');
        ws.close(4001, 'Authentication timeout');
      }
    }, 10000);

    ws.on('message', async (rawData) => {
      try {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(rawData.toString()) as Record<string, unknown>;
        } catch {
          ws.close(4002, 'Invalid JSON');
          return;
        }

        const msgType = message['type'] as string;

        // ── AUTH message ───────────────────────────────────────────────────────
        if (msgType === 'AUTH') {
          if (peer?.authenticated) {
            ws.send(JSON.stringify({ type: 'ERROR', error: 'Already authenticated' }));
            return;
          }

          const sessionId   = message['sessionId'] as string;
          const token       = message['token'] as string;      // webrtc_session_token
          const userJwt     = message['authToken'] as string;  // F-01: user access JWT
          const role        = message['role'] as PeerRole;

          if (!sessionId || !token || !userJwt || !['MANAGER', 'AGENT'].includes(role)) {
            ws.close(4003, 'Invalid auth payload');
            return;
          }

          // F-01 FIX: Verify the user's JWT access token cryptographically.
          // This binds the WS connection to a verified, MFA-confirmed user identity.
          // We do NOT trust the client-supplied userId string.
          let userPayload: JwtAccessPayload;
          try {
            userPayload = verifyAccessToken(userJwt);
          } catch {
            logger.warn({ sessionId, ip: connectionIp }, 'WS auth: invalid user JWT');
            ws.close(4010, 'Invalid user token');
            return;
          }

          // F-01 FIX: Managers MUST have MFA verified to view screens
          if (role === 'MANAGER' && !userPayload.mfa_verified) {
            logger.warn({ sessionId, userId: userPayload.sub }, 'WS auth: MFA not verified for manager');
            ws.close(4011, 'MFA required for monitoring');
            return;
          }

          // Verify session exists and token is valid
          const sessionResult = await query<{
            id: string; manager_id: string; agent_id: string; status: string;
            webrtc_session_token: string | null; webrtc_token_expires_at: Date | null;
          }>(
            `SELECT id, manager_id, agent_id, status,
                    webrtc_session_token, webrtc_token_expires_at
             FROM monitoring_sessions
             WHERE id = $1`,
            [sessionId],
          );

          const session = sessionResult.rows[0];
          if (!session?.webrtc_session_token) {
            logger.warn({ sessionId, ip: connectionIp }, 'WS auth: session not found or no token');
            ws.close(4004, 'Invalid session');
            return;
          }

          if (session.webrtc_token_expires_at && new Date() > session.webrtc_token_expires_at) {
            ws.close(4005, 'Session token expired');
            return;
          }

          if (!['PENDING', 'ACTIVE'].includes(session.status)) {
            ws.close(4006, 'Session is not active');
            return;
          }

          // Constant-time webrtc_session_token comparison
          const providedBuf = Buffer.from(token);
          const expectedBuf = Buffer.from(session.webrtc_session_token);
          if (
            providedBuf.length !== expectedBuf.length ||
            !crypto.timingSafeEqual(providedBuf, expectedBuf)
          ) {
            logger.warn({ sessionId, ip: connectionIp }, 'WS auth: token mismatch');
            ws.close(4007, 'Invalid token');
            return;
          }

          // F-01 FIX: Identity verified from JWT — not from client-supplied userId string.
          // JWT sub must match the session's manager_id or agent_id.
          const verifiedUserId = userPayload.sub;
          if (
            (role === 'MANAGER' && verifiedUserId !== session.manager_id) ||
            (role === 'AGENT'   && verifiedUserId !== session.agent_id)
          ) {
            logger.warn({ sessionId, ip: connectionIp, role, verifiedUserId }, 'WS auth: JWT identity mismatch');
            ws.close(4008, 'Identity mismatch');
            return;
          }

          clearTimeout(authTimeout);

          peer = {
            ws,
            role,
            userId: verifiedUserId,
            userEmail: userPayload.email,
            sessionId,
            authenticated: true,
          };

          const state = getOrCreateSessionState(sessionId);
          if (role === 'MANAGER') state.manager = peer;
          else state.agent = peer;

          // Issue time-limited, session-scoped TURN credentials
          const turnCreds = generateTurnCredentials(sessionId);
          ws.send(JSON.stringify({
            type: 'AUTHENTICATED',
            turnServers: [{ urls: turnCreds.urls, username: turnCreds.username, credential: turnCreds.credential }],
          }));

          logger.info({ sessionId, role, userId: peer.userId }, 'WS peer authenticated');

          if (state.manager && state.agent) {
            state.manager.ws.send(JSON.stringify({ type: 'PEER_READY' }));
          }
          return;
        }

        // ── All subsequent messages require authentication ──────────────────────
        if (!peer?.authenticated) {
          ws.close(4009, 'Not authenticated');
          return;
        }

        // ── WebRTC Signaling messages ──────────────────────────────────────────
        if (ALLOWED_SIGNAL_TYPES.has(msgType)) {
          const state = sessions.get(peer.sessionId);
          if (!state) {
            ws.send(JSON.stringify({ type: 'ERROR', error: 'Session not found' }));
            return;
          }

          const targetPeer = peer.role === 'MANAGER' ? state.agent : state.manager;
          if (!targetPeer || targetPeer.ws.readyState !== WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ERROR', error: 'Peer not connected' }));
            return;
          }

          // Relay only the expected fields — no unknown data passthrough
          const relay: Record<string, unknown> = { type: msgType };
          if (msgType === 'OFFER' || msgType === 'ANSWER') {
            relay['sdp'] = message['sdp'];
          } else if (msgType === 'ICE_CANDIDATE') {
            relay['candidate'] = message['candidate'];
          }

          targetPeer.ws.send(JSON.stringify(relay));
          return;
        }

        // ── End session signal ─────────────────────────────────────────────────
        if (msgType === 'END_SESSION') {
          if (!peer?.authenticated) return;

          logger.info(
            { sessionId: peer.sessionId, initiatedBy: peer.role },
            'Session end requested via WebSocket',
          );

          // F-17 FIX: Update the DB session record — previously only WebSocket
          // connections were closed, leaving the monitoring_sessions row ACTIVE.
          try {
            await endSession(
              peer.sessionId,
              peer.userId,
              peer.userEmail,
              peer.role,
              { reason: peer.role === 'AGENT' ? 'AGENT_TERMINATE' : 'MANAGER_REQUEST' },
              connectionIp,
              '',     // userAgent not available in WS context
              '',     // requestId not available in WS context
            );
          } catch (err) {
            // endSession logs its own audit — log and continue to close connections
            logger.error({ err, sessionId: peer.sessionId }, 'endSession failed in WS handler');
          }

          cleanupSession(peer.sessionId);
          return;
        }

        // Unknown message type — reject
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Unknown message type' }));

      } catch (err) {
        logger.error({ err, ip: connectionIp }, 'WebSocket message processing error');
        ws.close(4000, 'Internal error');
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (peer?.authenticated) {
        const state = sessions.get(peer.sessionId);
        if (state) {
          if (peer.role === 'MANAGER') state.manager = undefined;
          else state.agent = undefined;

          const other = peer.role === 'MANAGER' ? state.agent : state.manager;
          if (other?.ws.readyState === WebSocket.OPEN) {
            other.ws.send(JSON.stringify({ type: 'PEER_DISCONNECTED' }));
          }
        }
        logger.info({ sessionId: peer.sessionId, role: peer.role }, 'WS peer disconnected');
      }
    });

    ws.on('error', (err) => {
      logger.error({ err, ip: connectionIp }, 'WebSocket error');
    });
  });

  logger.info('WebSocket signaling gateway started at /ws/signal');
}

// Exported for session termination from HTTP routes
export function terminateSignalingSession(sessionId: string): void {
  cleanupSession(sessionId);
}
