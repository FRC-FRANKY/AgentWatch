-- Migration 009: Create audit_logs table
-- SECURITY: audit_logs must be append-only.
-- No UPDATE or DELETE allowed — enforced by DB trigger.
-- Monitoring events log session metadata only — never screen content.

CREATE TYPE audit_action AS ENUM (
    'LOGIN',
    'LOGOUT',
    'FAILED_LOGIN',
    'ACCOUNT_LOCKED',
    'ACCOUNT_UNLOCKED',
    'MFA_SETUP',
    'MFA_SUCCESS',
    'MFA_FAILURE',
    'MFA_BACKUP_USED',
    'PASSWORD_CHANGED',
    'PASSWORD_RESET_REQUESTED',
    'DEVICE_REGISTERED',
    'DEVICE_ONLINE',
    'DEVICE_OFFLINE',
    'DEVICE_DISABLED',
    'MONITORING_REQUESTED',
    'MONITORING_STARTED',
    'MONITORING_ENDED',
    'MONITORING_TERMINATED',
    'MONITORING_EXPIRED',
    'PERMISSION_DENIED',
    'ACCESS_GRANTED',
    'ACCESS_REVOKED',
    'ROLE_CHANGED',
    'USER_CREATED',
    'USER_DISABLED',
    'USER_ENABLED',
    'SECURITY_EVENT',
    'SESSION_EXPIRED',
    'TOKEN_REFRESHED',
    'AUDIT_LOG_VIEWED',
    'SETTINGS_CHANGED'
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action          audit_action NOT NULL,
    actor_id        UUID REFERENCES users(id),              -- Who performed the action (NULL for system/anonymous)
    actor_email     VARCHAR(255),                           -- Denormalized for historical record (user may be deleted)
    actor_role      VARCHAR(50),                            -- Denormalized role at time of action
    target_id       UUID,                                   -- Subject of the action (user_id, device_id, session_id)
    target_type     VARCHAR(50),                            -- 'USER', 'DEVICE', 'SESSION', 'ROLE', etc.
    session_id      UUID REFERENCES monitoring_sessions(id) ON DELETE SET NULL,
    details         JSONB,                                  -- Additional structured context (NO passwords, NO tokens, NO screen content)
    source_ip       INET,
    user_agent      TEXT,
    request_id      UUID,                                   -- Correlates to HTTP request
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- NO updated_at — audit logs are immutable
);

-- Immutability enforcement
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are immutable. DELETE and UPDATE are not permitted on audit_logs.';
END;
$$;

CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER trg_audit_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_session_id ON audit_logs(session_id);
CREATE INDEX idx_audit_target_id ON audit_logs(target_id);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_source_ip ON audit_logs(source_ip);

COMMENT ON TABLE audit_logs IS
    'Immutable audit trail. UPDATE and DELETE are blocked by trigger. '
    'details JSONB must NEVER contain passwords, tokens, or screen content.';
COMMENT ON COLUMN audit_logs.actor_email IS
    'Denormalized for historical integrity — actor user may be deleted later.';
COMMENT ON COLUMN audit_logs.details IS
    'Structured context. Permitted: session metadata, resource IDs, status changes. '
    'Forbidden: passwords, tokens, screen content, personal private data.';
