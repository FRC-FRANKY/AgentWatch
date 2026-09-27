# Architecture Overview

AgentWatch uses a layered architecture with a secure REST API, PostgreSQL data store, Redis for rate limiting, and a React dashboard for managers.

## Components

- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript
- Database: PostgreSQL
- Cache/rate limiting: Redis
- Real-time signaling: WebSocket
- Screen streaming: WebRTC with TURN/STUN configuration
- Agent client: Electron/desktop client for authorized workstation agents

## Request Flow

1. Manager authenticates using email/password and MFA.
2. Backend verifies JWT and permissions.
3. Resource access is checked against manager-agent assignments.
4. Monitoring sessions are created only for approved device/agent pairs.
5. WebSocket signaling authenticates the session before WebRTC negotiation.
6. Authorized agent client establishes the screen stream.

## Security Boundaries

- Public traffic is limited to HTTPS/WSS.
- JWT secrets are environment variables only.
- Refresh tokens are stored as hashes and rotated.
- Every protected endpoint is checked by backend authorization middleware.
- Audit logs are append-only and logged for every sensitive action.
