-- Migration 008: Create monitoring_sessions table
-- Each monitoring session has a lifecycle: PENDING → ACTIVE → ENDED/TERMINATED/EXPIRED
-- Screen content is NEVER stored here.
-- WebRTC signaling token is cleared after session ends.

CREATE TYPE session_status AS ENUM (
    'PENDING',      -- Session created, waiting for agent to accept
    'ACTIVE',       -- WebRTC connection established, monitoring live
    'ENDED',        -- Gracefully ended by manager
    'TERMINATED',   -- Terminated by agent, admin, or system
    'EXPIRED',      -- Exceeded max session duration
    'FAILED'        -- Failed to establish WebRTC connection
);

CREATE TABLE IF NOT EXISTS monitoring_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id          UUID NOT NULL REFERENCES users(id),
    agent_id            UUID NOT NULL REFERENCES users(id),
    device_id           UUID NOT NULL REFERENCES devices(id),
    status              session_status NOT NULL DEFAULT 'PENDING',
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,                   -- WebRTC connection established
    ended_at            TIMESTAMPTZ,                   -- Session ended (any reason)
    ended_by            UUID REFERENCES users(id),     -- Who terminated the session
    termination_reason  VARCHAR(100),                  -- 'MANAGER_REQUEST', 'AGENT_TERMINATE', 'TIMEOUT', 'ERROR'
    webrtc_session_token TEXT,                         -- Short-lived token for WebRTC auth (cleared on end)
    webrtc_token_expires_at TIMESTAMPTZ,
    manager_ip          INET,
    manager_user_agent  TEXT,
    session_duration_seconds INTEGER,                  -- Computed on end
    -- NO screen_content, NO recording_url, NO keystrokes -- by design

    CONSTRAINT chk_session_ended_has_time
        CHECK (
            (status IN ('ACTIVE', 'PENDING')) OR
            (ended_at IS NOT NULL)
        ),
    CONSTRAINT chk_session_started_before_ended
        CHECK (started_at IS NULL OR ended_at IS NULL OR started_at <= ended_at),
    CONSTRAINT chk_session_duration_positive
        CHECK (session_duration_seconds IS NULL OR session_duration_seconds >= 0)
);

CREATE INDEX idx_sessions_manager_id ON monitoring_sessions(manager_id);
CREATE INDEX idx_sessions_agent_id ON monitoring_sessions(agent_id);
CREATE INDEX idx_sessions_device_id ON monitoring_sessions(device_id);
CREATE INDEX idx_sessions_status ON monitoring_sessions(status);
CREATE INDEX idx_sessions_requested_at ON monitoring_sessions(requested_at DESC);

-- Prevent overlapping active sessions for the same device
CREATE UNIQUE INDEX idx_sessions_one_active_per_device
    ON monitoring_sessions(device_id)
    WHERE status IN ('PENDING', 'ACTIVE');

-- Auto-expire sessions that exceed max duration (called by scheduler)
CREATE OR REPLACE FUNCTION expire_stale_sessions(max_duration_minutes INTEGER DEFAULT 120)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE monitoring_sessions
    SET
        status = 'EXPIRED',
        ended_at = NOW(),
        termination_reason = 'TIMEOUT',
        session_duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
    WHERE status = 'ACTIVE'
      AND started_at < NOW() - (max_duration_minutes || ' minutes')::INTERVAL;
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$;

COMMENT ON TABLE monitoring_sessions IS
    'Monitoring session lifecycle. Screen content is NEVER stored here by design (privacy safeguard).';
COMMENT ON COLUMN monitoring_sessions.webrtc_session_token IS
    'Short-lived token for WebRTC authorization. MUST be cleared when session ends.';
COMMENT ON COLUMN monitoring_sessions.session_duration_seconds IS
    'Computed and stored when session ends. Used for reporting and audit.';
