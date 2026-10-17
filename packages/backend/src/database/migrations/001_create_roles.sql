-- Migration 001: Create roles table
-- Roles define the job function within the system (ADMIN, MANAGER, TEAM_LEADER, IT_SUPPORT, AGENT)
-- Permissions are separately managed and assigned via role_permissions.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- For gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- For ILIKE index optimization

CREATE TABLE IF NOT EXISTS roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(50) NOT NULL UNIQUE,
    display_name    VARCHAR(100) NOT NULL,
    description     TEXT,
    is_system_role  BOOLEAN NOT NULL DEFAULT FALSE,  -- System roles cannot be deleted
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_roles_name ON roles(name);
CREATE INDEX idx_roles_is_active ON roles(is_active);

-- Prevent deletion of system roles
CREATE OR REPLACE FUNCTION prevent_system_role_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.is_system_role = TRUE THEN
        RAISE EXCEPTION 'Cannot delete system role: %', OLD.name;
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_prevent_system_role_delete
    BEFORE DELETE ON roles
    FOR EACH ROW EXECUTE FUNCTION prevent_system_role_delete();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE roles IS 'Job-function roles. System roles (is_system_role=TRUE) cannot be deleted.';
COMMENT ON COLUMN roles.is_system_role IS 'If TRUE, this role is built-in and cannot be deleted via the UI.';
