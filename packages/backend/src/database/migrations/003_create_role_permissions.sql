-- Migration 003: Create role_permissions junction table
-- Maps roles to permissions (many-to-many).
-- This is the core of the RBAC system.

CREATE TABLE IF NOT EXISTS role_permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_by      UUID,          -- user_id who granted this permission (null for seeded data)
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);

COMMENT ON TABLE role_permissions IS 'Maps roles to permissions. Core RBAC junction table.';
COMMENT ON COLUMN role_permissions.granted_by IS 'The user ID who granted this role-permission link. NULL for seed data.';
