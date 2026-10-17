/**
 * modules/users/users.service.ts — User Management
 *
 * SECURITY:
 * - Passwords are never returned in any API response.
 * - All mutations are logged to the audit trail.
 * - Display name returned from login (via handleMe) comes from DB, not JWT.
 */

import { query, withTransaction } from '../../config/database';
import { hashPassword } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { logger } from '../../config/logger';

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  employeeId?: string;
  roleName: string;
  roleId: string;
  departmentName?: string;
  isActive: boolean;
  isMfaEnabled: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  password: string;
  roleId: string;
  departmentId?: string;
  employeeId?: string;
}

export interface UpdateUserInput {
  displayName?: string;
  roleId?: string;
  departmentId?: string;
  isActive?: boolean;
}

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  employee_id?: string;
  role_name: string;
  role_id: string;
  department_name?: string;
  is_active: boolean;
  is_mfa_enabled: boolean;
  last_login_at?: Date;
  created_at: Date;
};

export async function listUsers(
  page = 1,
  limit = 50,
  search?: string,
): Promise<{ users: UserSummary[]; total: number }> {
  const offset = (page - 1) * limit;
  const searchParam = search ? `%${search.toLowerCase()}%` : null;

  const whereClause = searchParam
    ? `WHERE (LOWER(u.email) LIKE $3 OR LOWER(u.display_name) LIKE $3)`
    : '';

  const params: unknown[] = [limit, offset];
  if (searchParam) params.push(searchParam);

  const result = await query<UserRow>(
    `SELECT u.id, u.email, u.display_name, u.employee_id,
            r.name AS role_name, u.role_id, d.name AS department_name,
            u.is_active, u.is_mfa_enabled, u.last_login_at, u.created_at
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN departments d ON d.id = u.department_id
     ${whereClause}
     ORDER BY u.created_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );

  const countParams: unknown[] = [];
  if (searchParam) countParams.push(searchParam);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users u ${whereClause}`,
    searchParam ? [searchParam] : [],
  );

  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  return {
    users: result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      employeeId: row.employee_id,
      roleName: row.role_name,
      roleId: row.role_id,
      departmentName: row.department_name,
      isActive: row.is_active,
      isMfaEnabled: row.is_mfa_enabled,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    })),
    total,
  };
}

export async function getUserById(userId: string): Promise<UserSummary | null> {
  const result = await query<UserRow>(
    `SELECT u.id, u.email, u.display_name, u.employee_id,
            r.name AS role_name, u.role_id, d.name AS department_name,
            u.is_active, u.is_mfa_enabled, u.last_login_at, u.created_at
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = $1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    employeeId: row.employee_id,
    roleName: row.role_name,
    roleId: row.role_id,
    departmentName: row.department_name,
    isActive: row.is_active,
    isMfaEnabled: row.is_mfa_enabled,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export async function createUser(
  input: CreateUserInput,
  createdById: string,
  createdByEmail: string,
  createdByRole: string,
  sourceIp: string,
  userAgent: string,
  requestId: string,
): Promise<UserSummary> {
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    // Check email uniqueness
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [input.email],
    );
    if (existing.rows.length > 0) {
      throw new Error('EMAIL_CONFLICT: A user with this email already exists');
    }

    const result = await client.query<UserRow>(
      `INSERT INTO users (
         email, display_name, employee_id, password_hash, role_id,
         department_id, is_active, is_mfa_enabled,
         monitoring_notice_acknowledged, must_change_password, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE, TRUE, TRUE, $7)
       RETURNING id, email, display_name, employee_id, role_id, is_active,
                 is_mfa_enabled, last_login_at, created_at`,
      [
        input.email,
        input.displayName,
        input.employeeId ?? null,
        passwordHash,
        input.roleId,
        input.departmentId ?? null,
        createdById,
      ],
    );

    const user = result.rows[0];

    // Fetch role name
    const roleResult = await client.query<{ name: string }>(
      'SELECT name FROM roles WHERE id = $1',
      [input.roleId],
    );

    await AuditService.getInstance().log({
      action: 'USER_CREATED',
      actorId: createdById,
      actorEmail: createdByEmail,
      actorRole: createdByRole,
      targetId: user.id,
      targetType: 'USER',
      details: { email: input.email, roleId: input.roleId },
      sourceIp,
      userAgent,
      requestId,
    });

    logger.info({ userId: user.id, email: user.email }, 'User created');

    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      employeeId: user.employee_id,
      roleName: roleResult.rows[0]?.name ?? 'UNKNOWN',
      roleId: user.role_id,
      isActive: user.is_active,
      isMfaEnabled: user.is_mfa_enabled,
      createdAt: user.created_at,
    };
  });
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  updatedById: string,
  updatedByEmail: string,
  updatedByRole: string,
  sourceIp: string,
  userAgent: string,
  requestId: string,
): Promise<UserSummary | null> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];

  if (input.displayName !== undefined) {
    params.push(input.displayName);
    setClauses.push(`display_name = $${params.length}`);
  }
  if (input.roleId !== undefined) {
    params.push(input.roleId);
    setClauses.push(`role_id = $${params.length}`);
  }
  if (input.departmentId !== undefined) {
    params.push(input.departmentId);
    setClauses.push(`department_id = $${params.length}`);
  }
  if (input.isActive !== undefined) {
    params.push(input.isActive);
    setClauses.push(`is_active = $${params.length}`);
    if (!input.isActive) {
      setClauses.push('deactivated_at = NOW()');
      params.push(updatedById);
      setClauses.push(`deactivated_by = $${params.length}`);
    }
  }

  params.push(userId);
  const userIdParam = `$${params.length}`;

  await query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = ${userIdParam}`,
    params,
  );

  const action = input.isActive === false ? 'USER_DISABLED' : 'USER_UPDATED';
  await AuditService.getInstance().log({
    action,
    actorId: updatedById,
    actorEmail: updatedByEmail,
    actorRole: updatedByRole,
    targetId: userId,
    targetType: 'USER',
    details: { changes: input },
    sourceIp,
    userAgent,
    requestId,
  });

  return getUserById(userId);
}

export async function getDashboardStats(): Promise<{
  onlineAgents: number;
  offlineAgents: number;
  activeMonitoring: number;
  securityEvents: number;
}> {
  const [agentStats, sessionStats, securityStats] = await Promise.all([
    query<{ status: string; count: string }>(
      `SELECT d.status, COUNT(DISTINCT d.agent_user_id)::text AS count
       FROM devices d
       JOIN users u ON u.id = d.agent_user_id
       JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'AGENT' AND d.is_active = TRUE AND u.is_active = TRUE
       GROUP BY d.status`,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM monitoring_sessions WHERE status IN ('PENDING', 'ACTIVE')`,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM security_events
       WHERE created_at >= NOW() - INTERVAL '24 hours'`,
    ),
  ]);

  let onlineAgents = 0;
  let offlineAgents = 0;
  for (const row of agentStats.rows) {
    const count = parseInt(row.count, 10);
    if (row.status === 'ONLINE') onlineAgents = count;
    else offlineAgents += count;
  }

  return {
    onlineAgents,
    offlineAgents,
    activeMonitoring: parseInt(sessionStats.rows[0]?.count ?? '0', 10),
    securityEvents: parseInt(securityStats.rows[0]?.count ?? '0', 10),
  };
}

export async function getAgentsForUser(
  userId: string,
  userRole: string,
  page = 1,
  limit = 50,
  search?: string,
  status?: string,
): Promise<{
  agents: Array<{
    id: string;
    displayName: string;
    email: string;
    departmentName?: string;
    deviceStatus?: string;
    deviceName?: string;
    deviceId?: string;
    lastHeartbeatAt?: Date;
    activeSession?: boolean;
  }>;
  total: number;
}> {
  const offset = (page - 1) * limit;
  const params: unknown[] = [];

  let baseQuery: string;

  if (userRole === 'ADMIN') {
    baseQuery = `
      SELECT u.id, u.display_name, u.email, dep.name AS department_name,
             d.status AS device_status, d.device_name, d.id AS device_id,
             d.last_heartbeat_at,
             EXISTS(
               SELECT 1 FROM monitoring_sessions ms
               WHERE ms.agent_id = u.id AND ms.status IN ('PENDING', 'ACTIVE')
             ) AS active_session
      FROM users u
      JOIN roles r ON r.id = u.role_id AND r.name = 'AGENT'
      LEFT JOIN departments dep ON dep.id = u.department_id
      LEFT JOIN devices d ON d.agent_user_id = u.id AND d.is_active = TRUE
      WHERE u.is_active = TRUE
    `;
  } else {
    params.push(userId);
    baseQuery = `
      SELECT u.id, u.display_name, u.email, dep.name AS department_name,
             d.status AS device_status, d.device_name, d.id AS device_id,
             d.last_heartbeat_at,
             EXISTS(
               SELECT 1 FROM monitoring_sessions ms
               WHERE ms.agent_id = u.id AND ms.status IN ('PENDING', 'ACTIVE')
             ) AS active_session
      FROM manager_agent_access maa
      JOIN users u ON u.id = maa.agent_id
      JOIN roles r ON r.id = u.role_id AND r.name = 'AGENT'
      LEFT JOIN departments dep ON dep.id = u.department_id
      LEFT JOIN devices d ON d.agent_user_id = u.id AND d.is_active = TRUE
      WHERE maa.manager_id = $${params.length} AND maa.is_active = TRUE
        AND (maa.expires_at IS NULL OR maa.expires_at > NOW())
        AND u.is_active = TRUE
    `;
  }

  const conditions: string[] = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(LOWER(u.display_name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`);
  }
  if (status && status !== 'all') {
    params.push(status.toUpperCase());
    conditions.push(`d.status = $${params.length}`);
  }

  const whereAddition = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

  params.push(limit, offset);
  const limitOffset = `LIMIT $${params.length - 1} OFFSET $${params.length}`;

  type AgentRow = {
    id: string;
    display_name: string;
    email: string;
    department_name?: string;
    device_status?: string;
    device_name?: string;
    device_id?: string;
    last_heartbeat_at?: Date;
    active_session: boolean;
  };

  const result = await query<AgentRow>(
    `${baseQuery}${whereAddition} ORDER BY u.display_name ASC ${limitOffset}`,
    params,
  );

  // Count query (without limit/offset)
  const countParams = params.slice(0, params.length - 2);
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM (${baseQuery}${whereAddition}) AS subq`,
    countParams,
  );

  return {
    agents: result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      departmentName: row.department_name,
      deviceStatus: row.device_status,
      deviceName: row.device_name,
      deviceId: row.device_id,
      lastHeartbeatAt: row.last_heartbeat_at,
      activeSession: row.active_session,
    })),
    total: parseInt(countResult.rows[0]?.count ?? '0', 10),
  };
}

export async function listSessions(
  userId: string,
  userRole: string,
  page = 1,
  limit = 50,
  status?: string,
): Promise<{
  sessions: Array<{
    id: string;
    managerId: string;
    managerEmail?: string;
    agentId: string;
    agentEmail?: string;
    agentName?: string;
    deviceId: string;
    deviceName?: string;
    status: string;
    requestedAt: Date;
    startedAt?: Date;
    endedAt?: Date;
    sessionDurationSeconds?: number;
  }>;
  total: number;
}> {
  const offset = (page - 1) * limit;
  const params: unknown[] = [];

  let whereClause = '';

  if (userRole === 'ADMIN') {
    whereClause = 'WHERE 1=1';
  } else {
    params.push(userId);
    whereClause = `WHERE ms.manager_id = $${params.length}`;
  }

  if (status && status !== 'all') {
    params.push(status.toUpperCase());
    whereClause += ` AND ms.status = $${params.length}`;
  }

  params.push(limit, offset);

  type SessionRow = {
    id: string;
    manager_id: string;
    manager_email?: string;
    agent_id: string;
    agent_email?: string;
    agent_name?: string;
    device_id: string;
    device_name?: string;
    status: string;
    requested_at: Date;
    started_at?: Date;
    ended_at?: Date;
    session_duration_seconds?: number;
  };

  const result = await query<SessionRow>(
    `SELECT ms.id, ms.manager_id, mu.email AS manager_email,
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

  return {
    sessions: result.rows.map((row) => ({
      id: row.id,
      managerId: row.manager_id,
      managerEmail: row.manager_email,
      agentId: row.agent_id,
      agentEmail: row.agent_email,
      agentName: row.agent_name,
      deviceId: row.device_id,
      deviceName: row.device_name,
      status: row.status,
      requestedAt: row.requested_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      sessionDurationSeconds: row.session_duration_seconds,
    })),
    total: parseInt(countResult.rows[0]?.count ?? '0', 10),
  };
}

export async function getSecurityEvents(
  page = 1,
  limit = 50,
  severity?: string,
): Promise<{
  events: Array<{
    id: string;
    eventType: string;
    severity: string;
    actorEmail?: string;
    sourceIp?: string;
    details?: Record<string, unknown>;
    createdAt: Date;
    resolvedAt?: Date;
    status: string;
  }>;
  total: number;
}> {
  const offset = (page - 1) * limit;
  const params: unknown[] = [];

  let whereClause = 'WHERE 1=1';
  if (severity && severity !== 'all') {
    params.push(severity.toUpperCase());
    whereClause += ` AND severity = $${params.length}`;
  }

  params.push(limit, offset);

  type EventRow = {
    id: string;
    event_type: string;
    severity: string;
    actor_email?: string;
    source_ip?: string;
    details?: Record<string, unknown>;
    created_at: Date;
    resolved_at?: Date;
    status: string;
  };

  const result = await query<EventRow>(
    `SELECT id, event_type, severity, actor_email, source_ip, details,
            created_at, resolved_at, status
     FROM security_events
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM security_events ${whereClause}`,
    params.slice(0, params.length - 2),
  );

  return {
    events: result.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      severity: row.severity,
      actorEmail: row.actor_email,
      sourceIp: row.source_ip,
      details: row.details,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      status: row.status,
    })),
    total: parseInt(countResult.rows[0]?.count ?? '0', 10),
  };
}
