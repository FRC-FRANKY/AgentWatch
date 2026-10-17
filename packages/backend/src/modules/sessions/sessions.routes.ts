/**
 * modules/sessions/sessions.routes.ts
 */
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireMFA } from '../../middleware/requireMFA';
import { authorize } from '../../middleware/authorize';
import { validateInput } from '../../middleware/validateInput';
import { requestSessionSchema, endSessionSchema } from '../../shared/schemas/session.schemas';
import { requestMonitoringSession, endSession, getSessionById } from './sessions.service';
import { AppError } from '../../middleware/errorHandler';
import type { EndSessionDto } from '../../shared/types/session.types';

export const sessionsRoutes = Router();

// All session routes require authentication + MFA
sessionsRoutes.use(authenticate, requireMFA);

// ── GET /api/sessions — List monitoring sessions
sessionsRoutes.get(
  '/',
  authorize('sessions:view_own'),
  async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string ?? '50', 10)));
      const status = req.query['status'] as string | undefined;
      const offset = (page - 1) * limit;

      const params: unknown[] = [];
      let whereClause = 'WHERE 1=1';

      const canViewAll = req.user!.permissions.has('sessions:view_all') || req.user!.role === 'ADMIN';
      if (!canViewAll) {
        params.push(req.user!.id);
        whereClause += ` AND ms.manager_id = $${params.length}`;
      }

      if (status && status !== 'all') {
        params.push(status.toUpperCase());
        whereClause += ` AND ms.status = $${params.length}`;
      }

      params.push(limit, offset);

      const { query } = await import('../../config/database');

      const result = await query(
        `SELECT ms.id, ms.manager_id, mu.email AS manager_email, mu.display_name AS manager_name,
                ms.agent_id, au.email AS agent_email, au.display_name AS agent_name,
                ms.device_id, d.device_name,
                ms.status, ms.requested_at, ms.started_at, ms.ended_at,
                ms.session_duration_seconds
         FROM monitoring_sessions ms
         LEFT JOIN users mu ON mu.id = ms.manager_id
         LEFT JOIN users au ON au.id = ms.agent_id
         LEFT JOIN devices d ON d.id = ms.device_id
         ${whereClause}
         ORDER BY ms.requested_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      const countParams = params.slice(0, params.length - 2);
      const countResult = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM monitoring_sessions ms ${whereClause}`,
        countParams,
      );

      res.json({
        sessions: result.rows,
        total: parseInt((countResult.rows[0] as { count: string })?.count ?? '0', 10),
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/sessions — Request a monitoring session
sessionsRoutes.post(
  '/',
  authorize('sessions:request'),
  validateInput(requestSessionSchema),
  async (req, res, next) => {
    try {
      const session = await requestMonitoringSession(
        req.user!.id,
        req.user!.email,
        req.user!.role,
        req.body as { agentId: string; deviceId: string },
        req.ip ?? 'unknown',
        req.headers['user-agent'] ?? 'unknown',
        req.requestId,
      );
      // Do not return webrtc_session_token in the listing — only in getById for authorized manager
      const { webrtcSessionToken, ...safeSession } = session;
      void webrtcSessionToken; // explicitly ignore
      res.status(201).json(safeSession);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('AUTHORIZATION_DENIED')) next(new AppError(403, msg));
      else if (msg.startsWith('DEVICE_OFFLINE') || msg.startsWith('DEVICE_STALE')) next(new AppError(422, msg));
      else if (msg.startsWith('SESSION_CONFLICT')) next(new AppError(409, msg));
      else next(err);
    }
  },
);

// ── GET /api/sessions/:id — Get session details (authorized users only)
sessionsRoutes.get(
  '/:id',
  authorize('sessions:view_own'),
  async (req, res, next) => {
    try {
      const session = await getSessionById(
        req.params['id'] as string,
        req.user!.id,
        req.user!.role,
      );
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json(session);
    } catch (err) {
      next(err);
    }
  },
);

// ── DELETE /api/sessions/:id — End a monitoring session
sessionsRoutes.delete(
  '/:id',
  authorize('sessions:terminate'),   // F-08 FIX: was missing — any auth'd user could attempt
  validateInput(endSessionSchema),

  async (req, res, next) => {
    try {
      await endSession(
        req.params['id'] as string,
        req.user!.id,
        req.user!.email,
        req.user!.role,
        req.body as EndSessionDto,
        req.ip ?? 'unknown',
        req.headers['user-agent'] ?? 'unknown',
        req.requestId,
      );
      res.status(200).json({ message: 'Session ended' });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('AUTHORIZATION_DENIED')) next(new AppError(403, msg));
      else next(err);
    }
  },
);
