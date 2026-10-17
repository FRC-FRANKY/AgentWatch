-- Migration 011: Create refresh_tokens table
-- Implements refresh-token rotation.
-- Each token is single-use — on refresh, the old token is revoked and a new one issued.
-- Token is stored as a SHA-256 hash — never the raw token.

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,      -- SHA-256 of the raw token
    family_id       UUID NOT NULL,             -- Groups tokens from the same refresh chain
    is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  VARCHAR(50),               -- 'ROTATED', 'LOGOUT', 'ADMIN_REVOKE', 'SUSPICIOUS'
    mfa_verified    BOOLEAN NOT NULL DEFAULT FALSE, -- F-10: MFA state at token issuance time
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    user_agent      TEXT,
    source_ip       INET,
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_family_id ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_tokens_is_revoked ON refresh_tokens(is_revoked);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- Detect token reuse attack:
-- If a revoked token from a family is presented, revoke the ENTIRE family.
-- This is implemented in application code (token.service.ts) using family_id.

COMMENT ON TABLE refresh_tokens IS
    'Refresh token store with rotation support. '
    'token_hash stores SHA-256 of raw token — never the raw value. '
    'Token reuse detection implemented via family_id: if a revoked token is reused, '
    'ALL tokens in that family are revoked (session compromise detection).';
COMMENT ON COLUMN refresh_tokens.family_id IS
    'Rotation chain ID. All tokens from the same login share a family_id. '
    'Reuse of a revoked family token triggers full family revocation.';
