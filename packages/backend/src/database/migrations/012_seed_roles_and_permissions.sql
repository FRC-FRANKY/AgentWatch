-- Migration 012: Seed roles and permissions
-- Seeds the 5 system roles and all permissions.
-- Role-permission assignments implement the least-privilege model.
-- This seed is idempotent — safe to re-run.

-- ── Roles ─────────────────────────────────────────────────────────────────────
INSERT INTO roles (name, display_name, description, is_system_role) VALUES
    ('ADMIN',        'Administrator',   'Full system access. Manage users, roles, devices, permissions, security.',      TRUE),
    ('MANAGER',      'Manager',         'Monitor assigned agents. View monitoring history. Request/end sessions.',        TRUE),
    ('TEAM_LEADER',  'Team Leader',     'Monitor assigned team members. Limited to own team.',                            TRUE),
    ('IT_SUPPORT',   'IT Support',      'Register and manage devices. No automatic screen-viewing permissions.',          TRUE),
    ('AGENT',        'Agent',           'View monitoring status and notice. Cannot monitor others.',                      TRUE)
ON CONFLICT (name) DO NOTHING;

-- ── Permissions ────────────────────────────────────────────────────────────────
INSERT INTO permissions (name, display_name, resource, action, is_sensitive) VALUES
    -- User management
    ('users:view',          'View Users',               'users',    'view',     FALSE),
    ('users:create',        'Create Users',             'users',    'create',   FALSE),
    ('users:update',        'Update Users',             'users',    'update',   FALSE),
    ('users:delete',        'Deactivate Users',         'users',    'delete',   TRUE),

    -- Role management
    ('roles:view',          'View Roles',               'roles',    'view',     FALSE),
    ('roles:manage',        'Manage Roles',             'roles',    'manage',   TRUE),

    -- Permission management
    ('permissions:manage',  'Manage Permissions',       'permissions', 'manage', TRUE),

    -- Department management
    ('departments:view',    'View Departments',         'departments', 'view',  FALSE),
    ('departments:manage',  'Manage Departments',       'departments', 'manage',FALSE),

    -- Device management
    ('devices:view',        'View Devices',             'devices',  'view',     FALSE),
    ('devices:register',    'Register Devices',         'devices',  'register', FALSE),
    ('devices:manage',      'Manage Devices',           'devices',  'manage',   FALSE),
    ('devices:disable',     'Disable Devices',          'devices',  'disable',  TRUE),

    -- Agent access
    ('agents:view_assigned','View Assigned Agents',     'agents',   'view',     FALSE),
    ('agents:view_all',     'View All Agents',          'agents',   'view_all', FALSE),

    -- Access grants
    ('access:grant',        'Grant Monitoring Access',  'access',   'grant',    TRUE),
    ('access:revoke',       'Revoke Monitoring Access', 'access',   'revoke',   TRUE),

    -- Monitoring sessions (sensitive)
    ('sessions:request',    'Request Monitoring Session','sessions', 'request', TRUE),
    ('sessions:view_own',   'View Own Sessions',        'sessions', 'view_own', FALSE),
    ('sessions:view_all',   'View All Sessions',        'sessions', 'view_all', TRUE),
    ('sessions:terminate',  'Terminate Any Session',    'sessions', 'terminate',TRUE),

    -- Audit logs
    ('audit:view',          'View Audit Logs',          'audit',    'view',     FALSE),
    ('audit:export',        'Export Audit Logs',        'audit',    'export',   TRUE),

    -- Security
    ('security:view',       'View Security Events',     'security', 'view',     FALSE),
    ('security:manage',     'Manage Security Settings', 'security', 'manage',   TRUE),

    -- Profile (self-service)
    ('profile:view',        'View Own Profile',         'profile',  'view',     FALSE),
    ('profile:update',      'Update Own Profile',       'profile',  'update',   FALSE),

    -- Monitoring notice (all users need this)
    ('notice:acknowledge',  'Acknowledge Monitoring Notice', 'notice', 'acknowledge', FALSE)

ON CONFLICT (name) DO NOTHING;

-- ── Role-Permission Assignments ────────────────────────────────────────────────

-- ADMIN: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- MANAGER
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'MANAGER'
  AND p.name IN (
    'agents:view_assigned',
    'sessions:request',
    'sessions:view_own',
    'profile:view',
    'profile:update',
    'notice:acknowledge'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- TEAM_LEADER
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'TEAM_LEADER'
  AND p.name IN (
    'agents:view_assigned',
    'sessions:request',
    'sessions:view_own',
    'profile:view',
    'profile:update',
    'notice:acknowledge'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- IT_SUPPORT: device management ONLY — NO screen-viewing permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'IT_SUPPORT'
  AND p.name IN (
    'devices:view',
    'devices:register',
    'devices:manage',
    'profile:view',
    'profile:update',
    'notice:acknowledge'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- AGENT: minimal — can see their own status and the monitoring notice
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'AGENT'
  AND p.name IN (
    'profile:view',
    'profile:update',
    'notice:acknowledge'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;
