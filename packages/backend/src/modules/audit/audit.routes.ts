/**
 * modules/audit/audit.routes.ts
 */
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireMFA } from '../../middleware/requireMFA';
import { authorize } from '../../middleware/authorize';
import { query } from '../../config/database';
import { AuditService } from './audit.service';

export const auditRoutes = Router();

auditRoutes.use(authenticate, requireMFA);

// GET /api/audit — List audit logs (ADMIN only)
auditRoutes.get(
  '/',
  authorize('audit:view'),
  async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string ?? '50', 10)));
      const offset = (page - 1) * limit;

      const result = await query(
        `SELECT id, action, actor_email, actor_role, target_id, target_type,
                session_id, details, source_ip, created_at
         FROM audit_logs
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );

      // Log that audit logs were viewed (meta-audit)
      void AuditService.getInstance().log({
        action: 'AUDIT_LOG_VIEWED',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        details: { page, limit },
        sourceIp: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId,
      });

      res.json({ data: result.rows, page, limit });
    } catch (err) {
      next(err);
    }
  },
);
