-- Migration 014: Create enrollment_tokens table
-- Supports the real agent enrollment flow.
-- A manager creates an enrollment token, the agent client uses it to self-register.
--
-- Security requirements:
--   * Token hash stored (never plaintext) — SHA-256 of the raw 32-byte token
--   * Single-use: consumed = TRUE after successful enrollment
--   * Expirable: expires_at enforced server-side
--   * Tied to a specific manager + optionally a pre-created agent user
--   * Deleted manager cascades (ON DELETE CASCADE)

CREATE TABLE IF NOT EXISTS enrollment_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash      TEXT NOT NULL UNIQUE,           -- SHA-256 of the raw enrollment token
    manager_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,  -- Pre-assigned agent user (optional)
    label           VARCHAR(200),                   -- Human-readable label (e.g. "Workstation for Juan")
    is_consumed     BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE after a successful enrollment
    consumed_at     TIMESTAMPTZ,
    consumed_by_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    expires_at      TIMESTAMPTZ NOT NULL,           -- Must be enforced; reject expired tokens
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_enrollment_tokens_manager_id ON enrollment_tokens(manager_id);
CREATE INDEX idx_enrollment_tokens_agent_user_id ON enrollment_tokens(agent_user_id);
CREATE INDEX idx_enrollment_tokens_expires_at ON enrollment_tokens(expires_at)
    WHERE is_consumed = FALSE;

CREATE TRIGGER trg_enrollment_tokens_updated_at
    BEFORE UPDATE ON enrollment_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Also add access:grant and devices:register permissions to MANAGER role
-- (needed so managers can self-serve agent registration + device assignment)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'MANAGER'
  AND p.name IN ('access:grant', 'devices:register')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMENT ON TABLE enrollment_tokens IS
    'Single-use, time-limited tokens that allow an agent client to self-enroll with the backend. '
    'Tokens are stored as SHA-256 hashes — plaintext is shown to the manager once and never stored.';
COMMENT ON COLUMN enrollment_tokens.token_hash IS
    'SHA-256 hash of the raw 32-byte enrollment token. Plaintext is never stored.';
COMMENT ON COLUMN enrollment_tokens.is_consumed IS
    'Set to TRUE after the agent successfully uses the token. Reuse is rejected.';
COMMENT ON COLUMN enrollment_tokens.expires_at IS
    'Server-side enforcement. Expired tokens are rejected regardless of is_consumed state.';
