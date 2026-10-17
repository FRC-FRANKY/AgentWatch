import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireMFA } from '../../middleware/requireMFA';
import { authorize } from '../../middleware/authorize';
import { validateInput } from '../../middleware/validateInput';
import { heartbeatRateLimiter } from '../../middleware/rateLimiter';
import { AppError } from '../../middleware/errorHandler';
import { registerDeviceSchema, heartbeatDeviceSchema } from '../../shared/schemas/device.schemas';
import { heartbeatDevice, listDevicesForView, registerDevice, verifyDeviceToken } from './devices.service';
import { query } from '../../config/database';
import { env } from '../../config/env';
import { startSession } from '../sessions/sessions.service';

export const devicesRoutes = Router();

devicesRoutes.post(
  '/heartbeat',
  heartbeatRateLimiter,
  validateInput(heartbeatDeviceSchema),
  async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AppError(401, 'Device authentication required');
      }

      const token = authHeader.slice(7).trim();
      const result = await heartbeatDevice(token, req.ip ?? 'unknown', req.body);
      res.json(result);
    } catch (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      const message = (err as Error).message;
      if (message.includes('Device not found') || message.includes('disabled')) {
        next(new AppError(401, message));
        return;
      }
      next(err);
    }
  },
);

devicesRoutes.use(authenticate, requireMFA);

devicesRoutes.get('/', authorize('devices:view'), async (req, res, next) => {
  try {
    const devices = await listDevicesForView(req.user!.role, req.user!.id);
    res.json({ devices });
  } catch (err) {
    next(err);
  }
});

  devicesRoutes.post(
  '/register',
  authorize('devices:register'),
  validateInput(registerDeviceSchema),
  async (req, res, next) => {
    try {
      const result = await registerDevice(
        req.body,
        req.user!.id,
        req.user!.email,
        req.user!.role,
        req.ip ?? 'unknown',
        req.headers['user-agent'] ?? 'unknown',
        req.requestId,
      );
      res.status(201).json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('already has an active registered device') || message.includes('Only AGENT')) {
        next(new AppError(409, message));
        return;
      }
      next(err);
    }
  },
);

// ── Device-authenticated session endpoints (no user JWT required) ─────────────
// These routes use the device JWT, not the user access JWT.
// The agent daemon uses these to detect and accept monitoring requests.

/**
 * GET /api/devices/session
 * Returns the pending monitoring session for this device (if any).
 * Called by the agent client to poll for monitoring requests.
 */
devicesRoutes.get('/session', heartbeatRateLimiter, async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Device authentication required');
    }
    const payload = verifyDeviceToken(authHeader.slice(7).trim());

    const result = await query<{
      id: string; manager_id: string; webrtc_session_token: string;
    }>(
      `SELECT id, manager_id, webrtc_session_token
       FROM monitoring_sessions
       WHERE device_id = $1
         AND status = 'PENDING'
         AND (webrtc_token_expires_at IS NULL OR webrtc_token_expires_at > NOW())
       ORDER BY requested_at DESC
       LIMIT 1`,
      [payload.device_id],
    );

    const session = result.rows[0];
    if (!session) {
      res.status(404).json({ message: 'No pending session' });
      return;
    }

    // Build TURN credentials
    const turnUrls = env.TURN_SERVER_URLS.split(',').map((u) => u.trim());
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: turnUrls,
        username: `${Math.floor(Date.now() / 1000) + env.TURN_CREDENTIAL_TTL_SECONDS}:${session.id.slice(0, 8)}`,
        credential: '',  // HMAC computed by the signaling gateway on WS AUTH
      },
    ];

    res.json({
      sessionId: session.id,
      managerId: session.manager_id,
      webrtcToken: session.webrtc_session_token,
      iceServers,
    });
  } catch (err) {
    if (err instanceof AppError) { next(err); return; }
    next(new AppError(401, 'Device authentication failed'));
  }
});

/**
 * POST /api/devices/session/:sessionId/accept
 * Agent accepts a monitoring session — transitions it to ACTIVE.
 * The agent then uses the returned webrtcToken to join the WebSocket signaling.
 */
devicesRoutes.post('/session/:sessionId/accept', heartbeatRateLimiter, async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Device authentication required');
    }
    const payload = verifyDeviceToken(authHeader.slice(7).trim());
    const { sessionId } = req.params;

    // Verify this session belongs to this device
    const check = await query<{ id: string; webrtc_session_token: string }>(
      `SELECT id, webrtc_session_token FROM monitoring_sessions
       WHERE id = $1 AND device_id = $2 AND status = 'PENDING'`,
      [sessionId, payload.device_id],
    );
    const session = check.rows[0];
    if (!session) {
      throw new AppError(404, 'Session not found or not pending');
    }

    // Mark session as ACTIVE (agent has accepted)
    await startSession(sessionId);

    const turnUrls = env.TURN_SERVER_URLS.split(',').map((u) => u.trim());
    res.json({
      sessionId,
      webrtcToken: session.webrtc_session_token,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: turnUrls },
      ],
    });
  } catch (err) {
    if (err instanceof AppError) { next(err); return; }
    next(err);
  }
});

