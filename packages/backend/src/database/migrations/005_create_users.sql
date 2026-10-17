-- Migration 005: Create users table
-- SECURITY NOTES:
-- * password_hash stores Argon2id hash only — never plaintext
-- * mfa_secret is the TOTP seed — should be encrypted at rest in production (pgcrypto)
-- * failed_login_attempts + locked_until implement account lockout
-- * is_active = FALSE is a soft disable — blocks all authentication

CREATE TABLE IF NOT EXISTS users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   VARCHAR(255) NOT NULL UNIQUE,
    display_name            VARCHAR(100) NOT NULL,
    employee_id             VARCHAR(50) UNIQUE,
    password_hash           TEXT NOT NULL,                     -- Argon2id hash
    role_id                 UUID NOT NULL REFERENCES roles(id),
    department_id           UUID REFERENCES departments(id),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    is_mfa_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret              TEXT,                              -- TOTP secret (store encrypted in prod)
    mfa_backup_codes        TEXT[],                            -- Hashed backup codes
    failed_login_attempts   INTEGER NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,                       -- NULL means not locked
    last_login_at           TIMESTAMPTZ,
    last_login_ip           INET,
    last_seen_at            TIMESTAMPTZ,
    password_changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    must_change_password    BOOLEAN NOT NULL DEFAULT FALSE,
    monitoring_notice_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    monitoring_notice_acknowledged_at TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              UUID REFERENCES users(id),
    deactivated_at          TIMESTAMPTZ,
    deactivated_by          UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX idx_users_email ON users(LOWER(email));  -- Case-insensitive email uniqueness
CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_department_id ON users(department_id);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_employee_id ON users(employee_id);
CREATE INDEX idx_users_locked_until ON users(locked_until) WHERE locked_until IS NOT NULL;

-- Add FK from departments.manager_id now that users table exists
ALTER TABLE departments
    ADD CONSTRAINT fk_departments_manager
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Prevent storing unhashed passwords (basic guard — actual hashing must be in application code)
-- This checks that the value is NOT a common hash format — it does NOT guarantee Argon2id
CREATE OR REPLACE FUNCTION check_password_hash_format()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Argon2id hashes start with '$argon2id$'
    -- bcrypt hashes start with '$2b$' or '$2a$'
    -- Reject if it looks like a plaintext password (no recognized prefix)
    IF NEW.password_hash IS NOT NULL
       AND NEW.password_hash NOT LIKE '$argon2%'
       AND NEW.password_hash NOT LIKE '$2b$%'
       AND NEW.password_hash NOT LIKE '$2a$%' THEN
        RAISE EXCEPTION 'password_hash does not appear to be a valid hash. Store hashed values only.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_check_password_hash
    BEFORE INSERT OR UPDATE OF password_hash ON users
    FOR EACH ROW EXECUTE FUNCTION check_password_hash_format();

COMMENT ON TABLE users IS 'System users. password_hash stores Argon2id only. Never store plaintext passwords.';
COMMENT ON COLUMN users.mfa_secret IS 'TOTP secret seed. Should be encrypted at rest using pgcrypto in production.';
COMMENT ON COLUMN users.locked_until IS 'If set and in the future, account is locked. Login must be rejected.';
COMMENT ON COLUMN users.monitoring_notice_acknowledged IS 'Employee confirmed they received the monitoring notice (RA 10173 transparency).';
