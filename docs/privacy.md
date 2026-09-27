# Privacy and Data Handling

AgentWatch is designed to minimize privacy impact while supporting legitimate business needs.

## Data minimization

- Only approved metadata is collected for sessions.
- Screen content is not stored as a default behavior.
- Sensitive credentials are never exposed in the UI or logs.
- Device status and heartbeat are limited to operational health and monitoring needs.

## Retention

- Audit logs should follow the configured retention policy.
- Monitoring metadata should be deleted according to the organization’s data-retention schedule.
- Session records should be reviewable, but access is restricted by role.

## User transparency

- Agent clients display a visible monitoring status.
- All requests must be tied to an approved business purpose.
- The system logs why a session was requested and who approved it.
