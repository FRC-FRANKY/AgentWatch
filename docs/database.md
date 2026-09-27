# Database Design

The application uses PostgreSQL with role-based access and audit tracking.

## Core entities

- User
- Role
- Permission
- Department
- Device
- ManagerAgentAccess
- MonitoringSession
- AuditLog
- SecurityEvent
- RefreshToken

## Important rules

- User passwords are never stored in plaintext.
- Refresh tokens are hashed before storage.
- Monitoring sessions reference both the manager and the assigned agent.
- Device heartbeat updates determine online/offline status.
- Every security or monitoring activity is auditable.

## Local setup

```bash
cd packages/backend
npm run migrate
npm run seed:dev
```
