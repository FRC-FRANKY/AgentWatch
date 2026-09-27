# AgentWatch — Remote Agent Workstation Monitoring System
## Architecture Document

> **Version:** 1.0.0  
> **Classification:** Internal — Confidential  
> **Last Updated:** 2026-09-26  
> **Compliance:** Philippine Data Privacy Act of 2012 (RA 10173), Privacy-by-Design, Security-by-Design

---

## 1. System Overview

AgentWatch is a **transparent, consent-informed, purpose-limited** remote workstation monitoring system that allows authorized managers to view the live screen of an authorized company workstation. It is explicitly designed to be:

- **Not covert** — agents are always visibly informed when monitoring is active.
- **Not a spyware tool** — no keylogging, no hidden webcam/microphone access, no covert screenshots.
- **Privacy-by-Design** — data minimization, purpose limitation, and transparency are built into the core.
- **Security-by-Design** — deny-by-default authorization, least privilege, audit trail on every action.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Manager Browser                       │
│              (React + Vite + TypeScript)                  │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTPS / WSS (TLS 1.3)
                        ▼
┌──────────────────────────────────────────────────────────┐
│               API Gateway / Backend Server                │
│              (Node.js + Express + TypeScript)             │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Auth Module │  │  RBAC Engine │  │  Session Mgr  │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ WebSocket    │  │  Audit Log   │  │  Rate Limiter │  │
│  │ Signaling    │  │  Service     │  │  & Sec Headers│  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└───────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                    │
│         (users, sessions, audit_logs, devices, etc.)     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│               Manager Browser (WebRTC Peer)               │
└───────────────────────┬──────────────────────────────────┘
                        │ Secure WebRTC (DTLS-SRTP)
                        │ (ICE via TURN/STUN — backend authorized)
                        ▼
┌──────────────────────────────────────────────────────────┐
│              AgentWatch Workstation Client                 │
│         (Electron/Node.js + TypeScript — on-premise)      │
│                                                          │
│  • Device Registration & Auth                            │
│  • Heartbeat (reports ONLINE/OFFLINE)                    │
│  • Monitoring Status Tray Icon                           │
│  • WebRTC Screen Capture (Display Media only)            │
│  • Session Termination Control                           │
│  • Visible alert: "Monitoring is ACTIVE"                 │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Security Architecture Principles

### 3.1 Authentication Flow
```
User → POST /auth/login → Argon2id password verify → JWT (15 min) + Refresh Token (7d)
     → POST /auth/mfa/verify → TOTP/WebAuthn check → MFA-scoped JWT issued
     → All sensitive endpoints require MFA-verified JWT
```

### 3.2 Authorization Pipeline (every monitoring request)
```
1. checkAuthenticated()       – Valid JWT, not expired
2. checkMFAVerified()         – JWT contains mfa_verified: true
3. checkRole()                – Role has required permission
4. checkManagerAgentRelation() – manager_agent_access row exists
5. checkDeviceOwnership()     – Device belongs to that agent
6. checkDeviceOnline()        – Device heartbeat < 60s
7. checkNoActiveSession()     – No duplicate session
8. createMonitoringSession()  – Persisted to DB
9. writeAuditLog()            – Immutable audit entry
10. emitWebSocketSignal()     – Authorized signal only
```

### 3.3 WebRTC Security
- ICE candidates exchanged only through backend-authorized WebSocket channel
- TURN credentials are time-limited, per-session, and generated server-side
- Agent client verifies the incoming session token before accepting
- No direct peer-to-peer unless both sides are verified

### 3.4 Deny-by-Default
- All API routes return 403 unless explicitly authorized
- New roles have zero permissions until granted
- New users have no agent assignments until explicitly created

---

## 4. Data Flow — Monitoring Session

```
Manager                    Backend                    Agent Client
   │                          │                            │
   │── POST /sessions/request ─▶                           │
   │                          │── Authorize (9 checks) ──▶ │
   │                          │◀─ 200 OK (session token) ──│
   │◀─ session_id + WS token ─│                            │
   │                          │                            │
   │── WS connect (signed) ───▶                            │
   │                          │── WS: MONITORING_REQUEST ──▶
   │                          │                            │
   │                          │◀── WS: AGENT_READY ────────│
   │                          │                            │
   │── WebRTC Offer ──────────────────────────────────────▶│
   │◀─ WebRTC Answer ──────────────────────────────────────│
   │◀═ DTLS-SRTP screen stream ════════════════════════════│
   │                          │                            │
   │── POST /sessions/end ────▶                            │
   │                          │── WS: SESSION_ENDED ───────▶
   │                          │                            │
   │                          │── Audit: MONITORING_ENDED ─│
```

---

## 5. Database Entity Relationship (Overview)

```
users ──< manager_agent_access >── users (agent)
users ──< monitoring_sessions >── devices
users ──< audit_logs
roles ──< role_permissions >── permissions
users >── roles
devices >── users (agent)
departments >── users
```

---

## 6. Compliance Mapping (RA 10173)

| RA 10173 Principle     | Implementation                                               |
|------------------------|--------------------------------------------------------------|
| Transparency           | Visible tray icon; employee monitoring notice; audit trail   |
| Legitimate Purpose     | Only screen view; business purpose enforced by RBAC          |
| Proportionality        | No keylog/webcam/mic; screen only during session             |
| Security Safeguards    | TLS 1.3, Argon2id, JWT, MFA, rate limiting, RBAC             |
| Access Control         | deny-by-default; manager_agent_access table                  |
| Retention              | No screen recordings stored by default; configurable         |
| Accountability         | Full audit log; session audit trail; admin controls          |

---

## 7. Folder Structure

See `PROJECT_STRUCTURE.md` for the complete annotated file tree.
