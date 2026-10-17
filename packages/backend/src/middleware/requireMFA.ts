/**
 * middleware/requireMFA.ts — MFA Enforcement Middleware
 *
 * Must be placed AFTER authenticate middleware.
 * Rejects requests where the JWT does not have mfa_verified: true.
 *
 * Apply this to all sensitive endpoints:
 * - Monitoring session requests
 * - User management
 * - Role management
 * - Audit log access
 * - Device management
 *
 * SECURITY: If MFA is bypassed (e.g., via partial token), the mfa_verified
 * claim will be false and this middleware blocks the request.
 */

import { Request, Response, NextFunction } from 'express';
import { AuditService } from '../modules/audit/audit.service';

export function requireMFA(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!req.user.mfaVerified) {
    // Log this as a security event — attempting to access sensitive endpoints without MFA
    void AuditService.getInstance().log({
      action: 'PERMISSION_DENIED',
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      details: { reason: 'MFA_NOT_VERIFIED', path: req.path },
      sourceIp: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });

    res.status(403).json({
      error: 'MFA verification required',
      code: 'MFA_REQUIRED',
    });
    return;
  }

  next();
}
