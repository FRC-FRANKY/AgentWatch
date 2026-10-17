/**
 * middleware/authorize.ts — RBAC Permission Check Middleware
 *
 * Checks that the authenticated user has the required permission.
 * DENY BY DEFAULT: if permission not in user's set → 403.
 * Also logs permission denials to the audit trail.
 *
 * Usage:
 *   router.post('/sessions', authenticate, requireMFA, authorize('sessions:request'), handler)
 */

import { Request, Response, NextFunction } from 'express';
import { AuditService } from '../modules/audit/audit.service';

export function authorize(requiredPermission: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!req.user.permissions.has(requiredPermission)) {
      // Audit: permission denied
      await AuditService.getInstance().log({
        action: 'PERMISSION_DENIED',
        actorId: req.user.id,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        details: {
          required_permission: requiredPermission,
          path: req.path,
          method: req.method,
        },
        sourceIp: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId,
      });

      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

/**
 * Requires ANY of the listed permissions (OR logic).
 * Useful for endpoints accessible by multiple roles.
 */
export function authorizeAny(...permissions: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const hasAny = permissions.some((p) => req.user!.permissions.has(p));

    if (!hasAny) {
      await AuditService.getInstance().log({
        action: 'PERMISSION_DENIED',
        actorId: req.user.id,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        details: {
          required_any_of: permissions,
          path: req.path,
          method: req.method,
        },
        sourceIp: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId,
      });

      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
