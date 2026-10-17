-- Migration 006: Create devices table
-- Devices are company workstations registered by IT_SUPPORT.
-- Each device is linked to exactly one agent (user with AGENT role).
-- Device authentication uses a separate JWT signed with DEVICE_JWT_SECRET.

CREATE TABLE IF NOT EXISTS devices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_name         VARCHAR(100) NOT NULL,
    hostname            VARCHAR(255) NOT NULL,
    mac_address         VARCHAR(17),                        -- Optional identifier
    agent_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    registration_token  TEXT UNIQUE,                        -- One-time registration token (cleared after use)
    device_secret_hash  TEXT NOT NULL,                      -- Hashed device secret (used for device auth)
    status              VARCHAR(20) NOT NULL DEFAULT 'OFFLINE'
                            CHECK (status IN ('ONLINE', 'OFFLINE', 'DISABLED', 'UNREGISTERED')),
    last_heartbeat_at   TIMESTAMPTZ,
    last_heartbeat_ip   INET,
    last_seen_ip        INET,
    os_type             VARCHAR(50),
    os_version          VARCHAR(100),
    client_version      VARCHAR(20),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    notes               TEXT,
    registered_at       TIMESTAMPTZ,
    registered_by       UUID REFERENCES users(id),
    deregistered_at     TIMESTAMPTZ,
    deregistered_by     UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_devices_agent_user_id ON devices(agent_user_id)
    WHERE is_active = TRUE;  -- One active device per agent

CREATE INDEX idx_devices_status ON devices(status);
CREATE INDEX idx_devices_hostname ON devices(hostname);
CREATE INDEX idx_devices_last_heartbeat ON devices(last_heartbeat_at);

CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Automatically mark device OFFLINE if last heartbeat is stale (called by application scheduler)
CREATE OR REPLACE FUNCTION mark_stale_devices_offline(threshold_seconds INTEGER DEFAULT 90)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE devices
    SET status = 'OFFLINE', updated_at = NOW()
    WHERE status = 'ONLINE'
      AND last_heartbeat_at < NOW() - (threshold_seconds || ' seconds')::INTERVAL;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$;

COMMENT ON TABLE devices IS 'Company workstations. Each active device is assigned to exactly one agent.';
COMMENT ON COLUMN devices.registration_token IS 'One-time token cleared after device registration completes.';
COMMENT ON COLUMN devices.device_secret_hash IS 'Hashed device secret used for device authentication. Never store plaintext.';
COMMENT ON COLUMN devices.status IS 'ONLINE/OFFLINE driven by heartbeat. DISABLED means manually blocked.';
