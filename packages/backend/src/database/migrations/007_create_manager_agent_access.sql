-- Migration 007: Create manager_agent_access table
-- CRITICAL AUTHORIZATION TABLE
-- Controls WHICH managers/team leaders can monitor WHICH agents.
-- A monitoring session can ONLY be created if a row exists in this table.
-- This is the resource-level authorization gate for monitoring.
-- Deny-by-default: no row = no access, regardless of role.

CREATE TABLE IF NOT EXISTS manager_agent_access (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by      UUID NOT NULL REFERENCES users(id),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    revoked_by      UUID REFERENCES users(id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    reason          TEXT,                  -- Business justification for the access grant
    expires_at      TIMESTAMPTZ,           -- Optional time-limited access
    UNIQUE(manager_id, agent_id)           -- One access record per pair
);

CREATE INDEX idx_maa_manager_id ON manager_agent_access(manager_id);
CREATE INDEX idx_maa_agent_id ON manager_agent_access(agent_id);
CREATE INDEX idx_maa_is_active ON manager_agent_access(is_active);
CREATE INDEX idx_maa_expires_at ON manager_agent_access(expires_at) WHERE expires_at IS NOT NULL;

-- Prevent a manager from being assigned access to themselves
CREATE OR REPLACE FUNCTION prevent_self_access()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.manager_id = NEW.agent_id THEN
        RAISE EXCEPTION 'A user cannot be granted monitoring access to themselves.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_maa_prevent_self_access
    BEFORE INSERT OR UPDATE ON manager_agent_access
    FOR EACH ROW EXECUTE FUNCTION prevent_self_access();

COMMENT ON TABLE manager_agent_access IS
    'Resource-level authorization: which manager/team-leader can monitor which agent. '
    'Deny-by-default: monitoring is blocked unless an active, non-expired row exists here.';
COMMENT ON COLUMN manager_agent_access.reason IS 'Business justification required when granting access (accountability).';
COMMENT ON COLUMN manager_agent_access.expires_at IS 'Optional: automatically expires temporary access grants.';
