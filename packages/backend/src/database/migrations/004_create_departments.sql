-- Migration 004: Create departments table

CREATE TABLE IF NOT EXISTS departments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    manager_id      UUID,                  -- FK added after users table (see migration 005)
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_departments_name ON departments(name);
CREATE INDEX idx_departments_is_active ON departments(is_active);

CREATE TRIGGER trg_departments_updated_at
    BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE departments IS 'Organizational departments. Each user belongs to one department.';
