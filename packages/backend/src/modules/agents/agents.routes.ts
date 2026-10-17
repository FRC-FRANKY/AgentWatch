/**
 * modules/agents/agents.routes.ts — Manager-Agent Lifecycle API
 *
 * SECURITY:
 * - managerId is ALWAYS taken from req.user.id (authenticated JWT), NEVER from request body.
 * - All routes require authentication + MFA.
 * - Ownership is verified server-side before any data is returned or mutated.
 * - Device assignment verifies manager-agent access before registering device.
 * - Enrollment tokens are single-use, time-limited, and stored as SHA-256 hashes.
 *
 * Routes:
 *   GET  /api/agents                  — List agents accessible to the authenticated manager
 *   POST /api/agents/access           — Grant manager access to an existing AGENT user
 *   GET  /api/agents/:agentId         — Get a specific agent (ownership enforced)
 *   POST /api/agents/enrollment-tokens — Create enrollment token for an agent
 *   GET  /api/agents/enrollment-tokens — List manager's enrollment tokens
 *   POST /api/agents/enroll           — Agent client self-enrollment (no auth required)
 *   POST /api/agents/:agentId/devices — Register a device for an agent (ownership enforced)
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireMFA } from '../../middleware/requireMFA';
import { authorize, authorizeAny } from '../../middleware/authorize';
import { AppError } from '../../middleware/errorHandler';
import {
  ensureManagerAgentAccess,
  verifyManagerAgentAccess,
  createEnrollmentToken,
  listEnrollmentTokensForManager,
  enrollAgent,
  listAgentsForManager,
} from './agents.service';

export const agentsRoutes = Router();

// ── Public enrollment endpoint (no JWT, uses enrollment token) ────────────────

/**
 * POST /api/agents/enroll
 * Called by the agent client to self-register using an enrollment token.
 * Does NOT require a user JWT — the enrollment token provides the authorization context.
 */
agentsRoutes.post('/enroll', async (req, res, next) => {
  try {
    const {
      enrollmentToken,
      hostname,
      deviceName,
      macAddress,
      osType,
      osVersion,
      clientVersion,
    } = req.body as {
      enrollmentToken?: string;
      hostname?: string;
      deviceName?: string;
      macAddress?: string;
      osType?: string;
      osVersion?: string;
      clientVersion?: string;
    };

    if (!enrollmentToken || !hostname || !deviceName) {
      res.status(400).json({
        error: 'enrollmentToken, hostname, and deviceName are required',
      });
      return;
    }

    const result = await enrollAgent(
      {
        rawToken: enrollmentToken,
        hostname,
        deviceName,
        macAddress,
        osType,
        osVersion,
        clientVersion,
      },
      req.ip ?? 'unknown',
    );

    res.status(201).json(result);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith('INVALID_TOKEN') || msg.startsWith('TOKEN_USED') || msg.startsWith('TOKEN_EXPIRED')) {
      next(new AppError(401, msg));
    } else if (msg.startsWith('ENROLLMENT_INCOMPLETE')) {
      next(new AppError(422, msg));
    } else {
      next(err);
    }
  }
});

// ── All routes below require authentication + MFA ─────────────────────────────

agentsRoutes.use(authenticate, requireMFA);

// ── GET /api/agents — List agents for the authenticated manager ───────────────

agentsRoutes.get('/', authorizeAny('agents:view_assigned', 'agents:view_all'), async (req, res, next) => {
  try {
    const { getAgentsForUser } = await import('../users/users.service');
    const page = Math.max(1, parseInt(req.query['page'] as string ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string ?? '50', 10)));
    const search = req.query['search'] as string | undefined;
    const status = req.query['status'] as string | undefined;

    const result = await getAgentsForUser(req.user!.id, req.user!.role, page, limit, search, status);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/agents/enrollment-tokens — List enrollment tokens for manager ────

agentsRoutes.get('/enrollment-tokens', authorize('access:grant'), async (req, res, next) => {
  try {
    const tokens = await listEnrollmentTokensForManager(req.user!.id);
    res.json({ tokens });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/agents/enrollment-tokens — Create enrollment token ───────────────

agentsRoutes.post('/enrollment-tokens', authorize('access:grant'), async (req, res, next) => {
  try {
    const { agentUserId, label, expiresInHours } = req.body as {
      agentUserId?: string;
      label?: string;
      expiresInHours?: number;
    };

    const result = await createEnrollmentToken(
      {
        managerId: req.user!.id,  // ALWAYS from authenticated context
        agentUserId,
        label,
        expiresInHours,
      },
      req.user!.id,
      req.user!.email,
      req.user!.role,
      req.ip ?? 'unknown',
      req.headers['user-agent'] ?? 'unknown',
      req.requestId,
    );

    res.status(201).json(result);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith('INVALID_AGENT') || msg.startsWith('ACCESS_DENIED')) {
      next(new AppError(403, msg));
    } else {
      next(err);
    }
  }
});

// ── POST /api/agents/access — Grant manager access to an agent user ───────────

/**
 * Grants the authenticated manager access to an existing AGENT user.
 * The manager can then:
 *   - Register/view that agent's device
 *   - Create enrollment tokens for that agent
 *   - Request monitoring sessions for that agent
 */
agentsRoutes.post('/access', authorize('access:grant'), async (req, res, next) => {
  try {
    const { agentId, reason } = req.body as {
      agentId?: string;
      reason?: string;
    };

    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const result = await ensureManagerAgentAccess({
      managerId: req.user!.id,   // ALWAYS from authenticated context
      agentId,
      grantedById: req.user!.id,
      reason: reason ?? 'Manager self-service access grant',
    });

    res.status(201).json(result);
  } catch (err) {
    const msg = (err as Error).message;
    if (
      msg.startsWith('AGENT_NOT_FOUND') ||
      msg.startsWith('INVALID_ROLE') ||
      msg.startsWith('SELF_ACCESS_DENIED')
    ) {
      next(new AppError(400, msg));
    } else {
      next(err);
    }
  }
});

// ── GET /api/agents/:agentId — Get agent details (ownership enforced) ─────────

agentsRoutes.get('/:agentId', authorizeAny('agents:view_assigned', 'agents:view_all'), async (req, res, next) => {
  try {
    const { agentId } = req.params as { agentId: string };

    // For ADMIN role, skip ownership check
    if (req.user!.role !== 'ADMIN') {
      const hasAccess = await verifyManagerAgentAccess(req.user!.id, agentId);
      if (!hasAccess) {
        // Return 404 to avoid leaking information about agent existence
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
    }

    const { getUserById } = await import('../users/users.service');
    const agent = await getUserById(agentId);

    if (!agent || agent.roleName !== 'AGENT') {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json(agent);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/agents/:agentId/devices — Register a device for an agent ────────

/**
 * Manager registers a device for one of their agents.
 * Security:
 * 1. Manager must be authenticated + MFA verified
 * 2. Manager must have active access grant to the specified agent
 * 3. ONLY THEN is device creation allowed
 *
 * This prevents Manager B from registering devices for Manager A's agents.
 */
agentsRoutes.post('/:agentId/devices', authorize('devices:register'), async (req, res, next) => {
  try {
    const { agentId } = req.params as { agentId: string };

    // Step 1: Verify manager has access to this agent (ownership enforcement)
    // ADMIN role bypasses ownership check
    if (req.user!.role !== 'ADMIN') {
      const hasAccess = await verifyManagerAgentAccess(req.user!.id, agentId);
      if (!hasAccess) {
        // 403 with generic message — do not leak agent existence
        res.status(403).json({ error: 'Access denied: you do not have access to this agent' });
        return;
      }
    }

    // Step 2: Register the device
    const { registerDevice } = await import('../devices/devices.service');
    const body = req.body as {
      deviceName?: string;
      hostname?: string;
      macAddress?: string;
      osType?: string;
      osVersion?: string;
      clientVersion?: string;
      notes?: string;
    };

    if (!body.deviceName || !body.hostname) {
      res.status(400).json({ error: 'deviceName and hostname are required' });
      return;
    }

    const result = await registerDevice(
      {
        agentUserId: agentId,
        deviceName: body.deviceName,
        hostname: body.hostname,
        macAddress: body.macAddress ?? null,
        osType: body.osType ?? null,
        osVersion: body.osVersion ?? null,
        clientVersion: body.clientVersion ?? null,
        notes: body.notes ?? null,
      },
      req.user!.id,
      req.user!.email,
      req.user!.role,
      req.ip ?? 'unknown',
      req.headers['user-agent'] ?? 'unknown',
      req.requestId,
    );

    res.status(201).json(result);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('already has an active registered device')) {
      next(new AppError(409, msg));
    } else if (msg.includes('Only AGENT users') || msg.includes('Invalid agent user')) {
      next(new AppError(400, msg));
    } else {
      next(err);
    }
  }
});

// ── Agents list (for manager self-service view) ───────────────────────────────

agentsRoutes.get('/me/agents', authorize('agents:view_assigned'), async (req, res, next) => {
  try {
    const agents = await listAgentsForManager(req.user!.id);
    res.json({ agents, total: agents.length });
  } catch (err) {
    next(err);
  }
});