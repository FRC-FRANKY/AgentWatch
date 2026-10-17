/**
 * modules/users/users.routes.ts — User Management API Routes
 *
 * Routes:
 *   GET  /api/users              - List users (ADMIN)
 *   POST /api/users              - Create user (ADMIN)
 *   GET  /api/users/:id          - Get user details (ADMIN)
 *   PATCH /api/users/:id         - Update user (ADMIN)
 *   GET  /api/users/me/profile   - Get own profile (authenticated)
 *   GET  /api/users/dashboard/stats - Dashboard statistics
 *   GET  /api/users/agents       - List agents (MANAGER/ADMIN)
 *   GET  /api/users/sessions     - List sessions (MANAGER/ADMIN)
 *   GET  /api/users/security-events - Security events (authorized)
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireMFA } from '../../middleware/requireMFA';
import { authorize, authorizeAny } from '../../middleware/authorize';
import { AppError } from '../../middleware/errorHandler';
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  getDashboardStats,
  getAgentsForUser,
  listSessions,
  getSecurityEvents,
} from './users.service';

export const usersRoutes = Router();
usersRoutes.use(authenticate, requireMFA);

// ── Dashboard stats ─────────────────────────────────────────────────────────

usersRoutes.get('/dashboard/stats', async (req, res, next) => {
  try {
    // Demo mode: return computed stats from DEMO_USERS map
    if (process.env.USE_DEMO_MODE === 'true') {
      res.json({
        onlineAgents: 3,
        offlineAgents: 1,
        activeMonitoring: 1,
        securityEvents: 2,
      });
      return;
    }
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// ── Agents list (for monitoring) ─────────────────────────────────────────────

usersRoutes.get('/agents', authorizeAny('agents:view_assigned', 'agents:view_all'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string ?? '50', 10)));
    const search = req.query['search'] as string | undefined;
    const status = req.query['status'] as string | undefined;

    // Demo mode: return mock agent list
    if (process.env.USE_DEMO_MODE === 'true') {
      const demoAgents = [
        {
          id: 'demo-agent-1',
          displayName: 'Juan Dela Cruz',
          email: 'juan@agentwatch.local',
          departmentName: 'Customer Support',
          deviceStatus: 'ONLINE',
          deviceName: 'PC-AGENT-001',
          deviceId: 'demo-device-1',
          lastHeartbeatAt: new Date(Date.now() - 2 * 60 * 1000),
          activeSession: false,
        },
        {
          id: 'demo-agent-2',
          displayName: 'Alicia Gomez',
          email: 'alicia@agentwatch.local',
          departmentName: 'Operations',
          deviceStatus: 'ONLINE',
          deviceName: 'OP-WS-014',
          deviceId: 'demo-device-2',
          lastHeartbeatAt: new Date(Date.now() - 30 * 1000),
          activeSession: true,
        },
        {
          id: 'demo-agent-3',
          displayName: 'Nina Cruz',
          email: 'nina@agentwatch.local',
          departmentName: 'Engineering',
          deviceStatus: 'OFFLINE',
          deviceName: 'ENG-WS-003',
          deviceId: 'demo-device-3',
          lastHeartbeatAt: new Date(Date.now() - 12 * 60 * 1000),
          activeSession: false,
        },
        {
          id: 'demo-agent-4',
          displayName: 'Marcus Lee',
          email: 'marcus@agentwatch.local',
          departmentName: 'Finance',
          deviceStatus: 'ONLINE',
          deviceName: 'FIN-WS-009',
          deviceId: 'demo-device-4',
          lastHeartbeatAt: new Date(Date.now() - 60 * 1000),
          activeSession: false,
        },
      ];

      let filtered = demoAgents;
      if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(
          (a) =>
            a.displayName.toLowerCase().includes(s) ||
            a.email.toLowerCase().includes(s) ||
            (a.deviceName?.toLowerCase().includes(s) ?? false),
        );
      }
      if (status && status !== 'all') {
        filtered = filtered.filter((a) => a.deviceStatus?.toLowerCase() === status.toLowerCase());
      }

      res.json({ agents: filtered, total: filtered.length });
      return;
    }

    const result = await getAgentsForUser(req.user!.id, req.user!.role, page, limit, search, status);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── Sessions list ────────────────────────────────────────────────────────────

usersRoutes.get('/sessions', authorizeAny('sessions:view_own', 'sessions:view_all'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string ?? '50', 10)));
    const status = req.query['status'] as string | undefined;

    // Demo mode
    if (process.env.USE_DEMO_MODE === 'true') {
      const demoSessions = [
        {
          id: 'demo-session-1',
          managerId: 'demo-manager',
          managerEmail: 'manager@agentwatch.local',
          agentId: 'demo-agent-1',
          agentEmail: 'juan@agentwatch.local',
          agentName: 'Juan Dela Cruz',
          deviceId: 'demo-device-1',
          deviceName: 'PC-AGENT-001',
          status: 'ENDED',
          requestedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
          startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
          endedAt: new Date(Date.now() - 3 * 60 * 60 * 1000 + 13 * 60 * 1000),
          sessionDurationSeconds: 822,
        },
        {
          id: 'demo-session-2',
          managerId: 'demo-admin',
          managerEmail: 'admin@agentwatch.local',
          agentId: 'demo-agent-2',
          agentEmail: 'alicia@agentwatch.local',
          agentName: 'Alicia Gomez',
          deviceId: 'demo-device-2',
          deviceName: 'OP-WS-014',
          status: 'ACTIVE',
          requestedAt: new Date(Date.now() - 22 * 60 * 1000),
          startedAt: new Date(Date.now() - 22 * 60 * 1000),
          sessionDurationSeconds: null,
        },
      ];

      let filtered = demoSessions;
      if (status && status !== 'all') {
        filtered = filtered.filter((s) => s.status.toLowerCase() === status.toLowerCase());
      }

      res.json({ sessions: filtered, total: filtered.length });
      return;
    }

    const result = await listSessions(req.user!.id, req.user!.role, page, limit, status);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── Security events ──────────────────────────────────────────────────────────

usersRoutes.get('/security-events', authorizeAny('security:view', 'security:manage'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string ?? '50', 10)));
    const severity = req.query['severity'] as string | undefined;

    // Demo mode
    if (process.env.USE_DEMO_MODE === 'true') {
      const demoEvents = [
        {
          id: 'demo-event-1',
          eventType: 'FAILED_LOGIN',
          severity: 'MEDIUM',
          actorEmail: 'unknown@example.com',
          sourceIp: '192.168.1.100',
          details: { attempts: 3 },
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
          status: 'OPEN',
        },
        {
          id: 'demo-event-2',
          eventType: 'PERMISSION_DENIED',
          severity: 'HIGH',
          actorEmail: 'agent@agentwatch.local',
          sourceIp: '10.0.0.80',
          details: { path: '/api/sessions', method: 'POST' },
          createdAt: new Date(Date.now() - 45 * 60 * 1000),
          status: 'OPEN',
        },
        {
          id: 'demo-event-3',
          eventType: 'DEVICE_AUTH_FAILURE',
          severity: 'CRITICAL',
          actorEmail: null,
          sourceIp: '10.0.0.55',
          details: { deviceId: 'unknown' },
          createdAt: new Date(Date.now() - 18 * 60 * 1000),
          status: 'OPEN',
        },
      ];

      let filtered = demoEvents;
      if (severity && severity !== 'all') {
        filtered = filtered.filter((e) => e.severity.toLowerCase() === severity.toLowerCase());
      }

      res.json({ events: filtered, total: filtered.length });
      return;
    }

    const result = await getSecurityEvents(page, limit, severity);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── User CRUD ────────────────────────────────────────────────────────────────

usersRoutes.get('/me/profile', async (req, res, next) => {
  try {
    if (process.env.USE_DEMO_MODE === 'true') {
      const DEMO_DISPLAY_NAMES: Record<string, string> = {
        'demo-admin': 'System Administrator',
        'demo-manager': 'Operations Manager',
        'demo-support': 'IT Support Engineer',
        'demo-agent': 'Remote Agent',
      };
      res.json({
        id: req.user!.id,
        email: req.user!.email,
        displayName: DEMO_DISPLAY_NAMES[req.user!.id] ?? req.user!.email,
        role: req.user!.role,
        permissions: Array.from(req.user!.permissions),
        isMfaEnabled: false,
      });
      return;
    }
    const user = await getUserById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.roleName,
      permissions: Array.from(req.user!.permissions),
      isMfaEnabled: user.isMfaEnabled,
      lastLoginAt: user.lastLoginAt,
      departmentName: user.departmentName,
    });
  } catch (err) {
    next(err);
  }
});

usersRoutes.get('/', authorize('users:view'), async (req, res, next) => {
  try {
    if (process.env.USE_DEMO_MODE === 'true') {
      res.json({
        users: [
          { id: 'demo-admin', email: 'admin@agentwatch.local', displayName: 'System Administrator', roleName: 'ADMIN', isActive: true, isMfaEnabled: false },
          { id: 'demo-manager', email: 'manager@agentwatch.local', displayName: 'Operations Manager', roleName: 'MANAGER', isActive: true, isMfaEnabled: false },
          { id: 'demo-support', email: 'support@agentwatch.local', displayName: 'IT Support Engineer', roleName: 'IT_SUPPORT', isActive: true, isMfaEnabled: false },
          { id: 'demo-agent', email: 'agent@agentwatch.local', displayName: 'Remote Agent', roleName: 'AGENT', isActive: true, isMfaEnabled: false },
        ],
        total: 4,
      });
      return;
    }
    const page = Math.max(1, parseInt(req.query['page'] as string ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string ?? '50', 10)));
    const search = req.query['search'] as string | undefined;
    const result = await listUsers(page, limit, search);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

usersRoutes.get('/:id', authorize('users:view'), async (req, res, next) => {
  try {
    const user = await getUserById(req.params['id'] as string);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

usersRoutes.post('/', authorize('users:create'), async (req, res, next) => {
  try {
    const user = await createUser(
      req.body,
      req.user!.id,
      req.user!.email,
      req.user!.role,
      req.ip ?? 'unknown',
      req.headers['user-agent'] ?? 'unknown',
      req.requestId,
    );
    res.status(201).json(user);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith('EMAIL_CONFLICT')) {
      next(new AppError(409, 'A user with this email already exists'));
      return;
    }
    next(err);
  }
});

usersRoutes.patch('/:id', authorize('users:update'), async (req, res, next) => {
  try {
    const user = await updateUser(
      req.params['id'] as string,
      req.body,
      req.user!.id,
      req.user!.email,
      req.user!.role,
      req.ip ?? 'unknown',
      req.headers['user-agent'] ?? 'unknown',
      req.requestId,
    );
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});
