-- Migration 002: Create permissions table
-- Each permission represents a discrete capability (e.g., 'sessions:request', 'audit:view').
-- Permissions follow the format: resource:action

CREATE TABLE IF NOT EXISTS permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE,
    display_name    VARCHAR(150) NOT NULL,
    description     TEXT,
    resource        VARCHAR(50) NOT NULL,   -- e.g., 'sessions', 'users', 'devices'
    action          VARCHAR(50) NOT NULL,   -- e.g., 'request', 'view', 'create', 'delete'
    is_sensitive    BOOLEAN NOT NULL DEFAULT FALSE,  -- Flag extra-privileged permissions for audit attention
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_permissions_name ON permissions(name);
CREATE INDEX idx_permissions_resource ON permissions(resource);
CREATE INDEX idx_permissions_resource_action ON permissions(resource, action);

COMMENT ON TABLE permissions IS 'Discrete capabilities. Format: resource:action. Sensitive permissions trigger additional audit logging.';
COMMENT ON COLUMN permissions.is_sensitive IS 'If TRUE, usage of this permission is flagged in security events.';
COMMENT ON COLUMN permissions.resource IS 'The resource being accessed (e.g., sessions, users, devices, audit).';
COMMENT ON COLUMN permissions.action IS 'The action being performed (e.g., view, request, create, delete, manage).';
