# API Reference

## Auth

- POST /api/auth/login
- POST /api/auth/mfa/verify
- POST /api/auth/refresh
- POST /api/auth/logout

## Dashboard and resources

- GET /api/dashboard
- GET /api/agents
- GET /api/agents/:id
- GET /api/devices
- GET /api/devices/:id
- POST /api/devices/register
- POST /api/devices/:id/disable
- GET /api/sessions
- GET /api/sessions/:id
- POST /api/monitoring/request
- POST /api/monitoring/:id/start
- POST /api/monitoring/:id/end
- GET /api/audit-logs
- GET /api/security/events
- GET /api/users
- POST /api/users
- PATCH /api/users/:id
- POST /api/users/:id/disable

## Response format

Errors should follow the standard format:

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this resource."
  }
}
```
