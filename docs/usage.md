# How to Use AgentWatch

AgentWatch is a privacy-first workstation monitoring system for authorized managers to monitor approved company devices. It is designed to be transparent, role-based, and auditable.

This guide explains how to use the application once it is running locally.

## 1) Start the application

Follow the setup flow in [README.md](../README.md) or the testing guide in [docs/testing.md](./testing.md).

In short:

```bash
npm install

# Start infrastructure

docker compose -f docker-compose.dev.yml up -d

# Run DB setup
npm run --workspace packages/backend migrate
npm run --workspace packages/backend seed:dev

# Start backend and frontend in separate terminals
npm run --workspace packages/backend dev
npm run --workspace packages/frontend dev
```

Then open:

```text
http://localhost:5173
```

## 2) Sign in

The seeded demo accounts are defined in the backend example environment file and include:

- Admin: `admin@agentwatch.local` / `Admin123!`
- Manager: `manager@agentwatch.local` / `Manager123!`
- Support: `support@agentwatch.local` / `Support123!`
- Agent: `agent@agentwatch.local` / `Agent123!`

Use these credentials for local testing.

## 3) Understand the roles

AgentWatch uses role-based access control. Different user roles have different permissions:

- Admin: full platform access, user/device management, audit visibility
- Manager: usually manages monitoring requests and approved sessions
- Support: may assist with system operations and maintenance tasks
- Agent: workstation user account; may be the monitored device owner

If your account is not allowed to perform a task, the application should reject it and log the access attempt.

## 4) Use the dashboard

After signing in, the frontend dashboard is where you do most operational tasks. Typical tasks include:

- viewing system overview and active status
- checking agents and device health
- reviewing monitoring sessions
- investigating audit logs and security events
- managing users or assignment permissions if your role allows it

The exact page layout depends on the frontend UI structure, but the operational goal is to monitor only authorized devices and only within approved business policies.

## 5) Request a monitoring session

A manager or authorized user can request monitoring access for a permitted workstation.

Typical user flow:

1. Select the target device or agent from the dashboard
2. Review permissions and authorization status
3. Start a monitoring request
4. Confirm the request is approved for the correct user or role
5. Begin the session only when the target is valid and authorized

The system is designed to be transparent, with visible monitoring notifications and full session logging.

## 6) Monitor a workstation

Once a session is authorized:

- the manager can view the live screen from the approved workstation
- the monitored employee should see a visible monitoring notification
- all session activity is recorded in audit logs
- the session can be ended when the task is complete or the policy requires it

## 7) Review audit and security data

Use the dashboard or backend audit endpoints to check:

- who started or ended a session
- which device was involved
- whether monitoring was approved and by whom
- whether security events or access violations occurred

This is important for internal compliance and operational accountability.

## 8) Log out and end session safely

Always end monitoring sessions cleanly and sign out when you are done. This prevents stale access and keeps audit records complete.

## 9) Common usage notes

- Only monitor company-approved workstations
- Do not use the app for covert surveillance or personal-device monitoring
- Keep MFA and permission checks enabled for production deployments
- Use the local demo accounts only in development or sandbox environments

## 10) Production usage

In production, use real credentials and a secure environment instead of the demo accounts. Review the policy and security documentation in:

- [docs/SECURITY.md](./SECURITY.md)
- [docs/privacy.md](./privacy.md)
- [docs/deployment.md](./deployment.md)

This application is meant for transparent enterprise monitoring, not for covert employee surveillance.
