/**
 * middleware/authenticate.ts — JWT Authentication Middleware
 *
 * Extracts and verifies the Bearer token from the Authorization header.
 * Sets req.user on success, rejects with 401 on failure.
 *
 * SECURITY:
 * - Verifies signature, issuer, audience, and expiry
 * - Loads permissions from DB on each request (ensures revoked roles take effect)
 * - Attaches requestId from X-Request-ID header (or generates one)
 * - Does NOT log the token itself
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { verifyAccessToken } from '../modules/auth/token.service';
import { query } from '../config/database';
import { logger } from '../config/logger';

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        roleId: string;
        managerId?: string | null;
        mfaVerified: boolean;
        permissions: Set<string>;
      };
      requestId: string;
    }
  }
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Attach request ID for correlation
  // F-20 FIX: Validate the client-supplied request ID is a real UUID.
  // Accepting arbitrary strings allows log injection attacks.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const clientRequestId = req.headers['x-request-id'] as string | undefined;
  req.requestId = (clientRequestId && UUID_RE.test(clientRequestId))
    ? clientRequestId
    : uuidv4();

  res.setHeader('X-Request-ID', req.requestId);

  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);

    let permissions: Set<string>;

    if (process.env.USE_DEMO_MODE === 'true') {
      // In demo mode, derive permissions from role without DB lookup
      permissions = getDemoPermissionsForRole(payload.role);
    } else {
      // Load permissions from DB — don't rely solely on JWT claims
      // This ensures permission changes take effect without waiting for token expiry
      const permResult = await query<{ name: string }>(
        `SELECT p.name
         FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
         WHERE rp.role_id = $1`,
        [payload.roleId],
      );
      permissions = new Set(permResult.rows.map((r) => r.name));
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      roleId: payload.roleId,
      managerId: payload.managerId ?? null,
      mfaVerified: payload.mfa_verified,
      permissions,
    };

    next();
  } catch {
    logger.debug({ requestId: req.requestId }, 'Token verification failed');
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Demo mode permission map — mirrors migration 012_seed_roles_and_permissions.sql
function getDemoPermissionsForRole(role: string): Set<string> {
  const common = ['profile:view', 'profile:update', 'notice:acknowledge'];
  const byRole: Record<string, string[]> = {
    ADMIN: [
      'users:view', 'users:create', 'users:update', 'users:delete',
      'roles:view', 'roles:manage', 'permissions:manage',
      'departments:view', 'departments:manage',
      'devices:view', 'devices:register', 'devices:manage', 'devices:disable',
      'agents:view_assigned', 'agents:view_all',
      'access:grant', 'access:revoke',
      'sessions:request', 'sessions:view_own', 'sessions:view_all', 'sessions:terminate',
      'audit:view', 'audit:export',
      'security:view', 'security:manage',
      ...common,
    ],
    MANAGER: [
      'agents:view_assigned',
      'sessions:request', 'sessions:view_own', 'sessions:terminate',
      'audit:view',
      'security:view',
      'devices:view',
      ...common,
    ],
    TEAM_LEADER: [
      'agents:view_assigned',
      'sessions:request', 'sessions:view_own', 'sessions:terminate',
      ...common,
    ],
    IT_SUPPORT: [
      'devices:view', 'devices:register', 'devices:manage',
      'security:view',
      ...common,
    ],
    AGENT: [...common],
  };
  return new Set(byRole[role] ?? common);
}
