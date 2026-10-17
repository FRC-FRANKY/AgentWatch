-- Migration 013: Fix MANAGER and IT_SUPPORT permission gaps
-- MANAGER was missing: sessions:terminate, audit:view, security:view, devices:view
-- IT_SUPPORT was missing: security:view
-- This migration adds the missing permissions idempotently.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'MANAGER'
  AND p.name IN (
    'sessions:terminate',
    'audit:view',
    'security:view',
    'devices:view'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'IT_SUPPORT'
  AND p.name IN ('security:view', 'audit:view')
ON CONFLICT (role_id, permission_id) DO NOTHING;
