# AgentWatch — Remote Agent Workstation Monitoring System

> **Enterprise transparent remote workstation monitoring — built privacy-first.**

[![License: Proprietary](https://img.shields.io/badge/license-Proprietary-red.svg)]()
[![Security: RBAC](https://img.shields.io/badge/security-RBAC%20%2B%20MFA-green)]()
[![Compliance: RA 10173](https://img.shields.io/badge/compliance-RA%2010173-blue)]()

---

## Overview

AgentWatch is a **transparent, consent-informed** remote workstation monitoring system that allows authorized managers to view the live screen of authorized company workstations. It is **explicitly designed to NOT be covert spyware**.

### What it does
- Allows authorized managers to view a live screen of an authorized company workstation via secure WebRTC.
- Displays a **visible monitoring notification** on the agent workstation at all times.
- Logs every monitoring session in a full audit trail.

### What it does NOT do
- ❌ No keylogging
- ❌ No hidden webcam activation
- ❌ No hidden microphone activation
- ❌ No covert screenshots
- ❌ No screen recording stored by default
- ❌ No monitoring of personal devices

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md).

---

## Packages

| Package | Description |
|---------|-------------|
| `packages/backend` | Node.js + Express + TypeScript REST API + WebSocket signaling |
| `packages/frontend` | React + Vite + TypeScript manager dashboard |
| `packages/agent-client` | Electron workstation client (on-premise) |

---

## Quick Start (Development)

### Prerequisites
- Node.js >= 20
- Docker + Docker Compose
- PostgreSQL 15+

### 1. Clone and install
```bash
git clone <repo-url>
cd agentwatch
cp .env.example .env          # Fill in all required values
cp packages/backend/.env.example packages/backend/.env
cp packages/frontend/.env.example packages/frontend/.env
cp packages/agent-client/.env.example packages/agent-client/.env
```

### 2. Start infrastructure
```bash
docker compose -f docker-compose.dev.yml up -d
```

### 3. Run migrations
```bash
cd packages/backend
npm run migrate
npm run seed:dev   # Development seed only — NEVER run in production
```

### 4. Start backend
```bash
npm run dev
```

### 5. Start frontend (new terminal)
```bash
cd packages/frontend
npm run dev
```

---

## How to Use

See [docs/usage.md](./docs/usage.md) for the end-user workflow, login steps, dashboard usage, and monitoring session flow.

## Testing

See [docs/testing.md](./docs/testing.md) for the full local testing workflow, including backend tests, frontend checks, and startup validation.

## Security

See [docs/SECURITY.md](./docs/SECURITY.md).

## Compliance

See [docs/COMPLIANCE.md](./docs/COMPLIANCE.md).  
Policies: [policies/](./policies/)

## Deployment

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

---

## Privacy & Legal

This system is designed in accordance with the **Philippine Data Privacy Act of 2012 (RA 10173)**.

All monitoring is:
- Transparent to the monitored employee
- Limited to legitimate business purposes
- Proportional (screen view only, no surveillance)
- Subject to full audit logging
- Controllable by the employee (visible status, session awareness)

---

## License

Proprietary. All rights reserved. Unauthorized copying, distribution, or use is prohibited.
