-- Migration 010: Create security_events table
-- Security events are a separate, higher-urgency log for anomalous activity.
-- Distinct from audit_logs — security_events trigger alerts.

CREATE TYPE security_event_type AS ENUM (
    'BRUTE_FORCE_DETECTED',
    'ACCOUNT_LOCKED',
    'SUSPICIOUS_IP',
    'UNAUTHORIZED_ACCESS_ATTEMPT',
    'PRIVILEGE_ESCALATION_ATTEMPT',
    'IDOR_ATTEMPT',
    'RATE_LIMIT_EXCEEDED',
    'INVALID_TOKEN',
    'EXPIRED_TOKEN',
    'DEVICE_MISMATCH',
    'CONCURRENT_SESSION_DETECTED',
    'MFA_BYPASS_ATTEMPT',
    'ANOMALOUS_LOCATION',
    'SESSION_HIJACKING_SUSPECTED'
);

CREATE TYPE security_event_severity AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);

CREATE TABLE IF NOT EXISTS security_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      security_event_type NOT NULL,
    severity        security_event_severity NOT NULL,
    actor_id        UUID REFERENCES users(id),
    actor_email     VARCHAR(255),
    target_id       UUID,
    target_type     VARCHAR(50),
    source_ip       INET,
    user_agent      TEXT,
    details         JSONB,
    is_reviewed     BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_security_events_type ON security_events(event_type);
CREATE INDEX idx_security_events_severity ON security_events(severity);
CREATE INDEX idx_security_events_actor_id ON security_events(actor_id);
CREATE INDEX idx_security_events_is_reviewed ON security_events(is_reviewed);
CREATE INDEX idx_security_events_created_at ON security_events(created_at DESC);
CREATE INDEX idx_security_events_source_ip ON security_events(source_ip);

COMMENT ON TABLE security_events IS
    'High-urgency security anomaly log. Distinct from audit_logs. Used for threat detection and incident response.';
