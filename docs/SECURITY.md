# Security Review — AgentWatch Remote Agent Workstation Monitoring System
**Classification:** Internal — Confidential  
**Review Date:** 2026-09-26  
**Reviewer:** Security Architecture Review  
**Compliance:** RA 10173 (Philippine DPA), Privacy-by-Design, OWASP Top 10

---

> [!IMPORTANT]
> This document is the living security audit for the AgentWatch system. Update after each phase.

---

## Security Architecture Summary

| Layer | Control | Status |
|-------|---------|--------|
| Authentication | Argon2id + JWT + MFA | ✅ Implemented |
| Token Security | Split-token rotation, SHA-256 hashed, family revocation | ✅ Implemented |
| Authorization | RBAC + resource-level (manager_agent_access) | ✅ Implemented |
| MFA Enforcement | mfa_verified claim, requireMFA middleware | ✅ Implemented |
| Session Security | DB-enforced one-active-per-device, auto-expiry | ✅ Implemented |
| WebSocket Security | Auth timeout, constant-time compare, message allowlist | ✅ Implemented |
| WebRTC Security | Backend-authorized TURN creds, session-scoped | ✅ Implemented |
| Audit Logs | Immutable (DB trigger), no screen/token content | ✅ Implemented |
| Input Validation | Zod on all endpoints | ✅ Implemented |
| Error Handling | No stack traces to client in production | ✅ Implemented |
| Rate Limiting | Login (10/15min), API (200/min) | ✅ Implemented |
| CORS | Strict allowlist | ✅ Implemented |
| Security Headers | Helmet, strict CSP | ✅ Implemented |
| Secret Management | Env vars, Zod validated at startup | ✅ Implemented |
| Logging | Pino with redaction paths | ✅ Implemented |
| Surveillance Controls | No keylog/webcam/mic | ✅ By Design |

---

## Finding 1: Refresh Token Reuse Attack

**Severity:** CRITICAL  
**Affected Component:** token.service.ts — `rotateRefreshToken()`  
**Status:** ✅ Mitigated  

**Attack Scenario:** Attacker steals a refresh token from cookie jar or network. Uses it to obtain a new access token. Legitimate user also tries to use their current token.

**Fix Implemented:** Token family rotation. When a revoked token is presented, the entire family is revoked. Both the attacker and the legitimate user are logged out.

---

## Finding 2: User Enumeration via Login

**Severity:** HIGH  
**Affected Component:** auth.service.ts — `login()`  
**Status:** ✅ Mitigated  

**Attack Scenario:** Attacker submits known vs. unknown email addresses. Timing difference reveals which emails exist.

**Fix Implemented:** Dummy Argon2id hash is always verified even when user is not found. Response messages are identical for invalid email and invalid password.

---

## Finding 3: IDOR on Agent Access

**Severity:** CRITICAL  
**Affected Component:** sessions.service.ts — `requestMonitoringSession()`  
**Status:** ✅ Mitigated  

**Attack Scenario:** Manager submits `agentId` of an agent they are not authorized to monitor.

**Fix Implemented:** `checkManagerAgentRelation()` queries `manager_agent_access` with both `manager_id = auth_user.id` AND `agent_id = requested_agent_id`. Both must match an active, non-expired row.

---

## Finding 4: Manager Accessing Another Manager's Session

**Severity:** HIGH  
**Affected Component:** sessions.service.ts — `endSession()` / `getSessionById()`  
**Status:** ✅ Mitigated  

**Fix Implemented:** `endSession()` verifies `endedById === session.manager_id` before allowing termination. `getSessionById()` checks `session.managerId === requestingUserId`.

---

## Finding 5: WebSocket Signaling Without Authentication

**Severity:** CRITICAL  
**Affected Component:** signaling.gateway.ts  
**Status:** ✅ Mitigated  

**Attack Scenario:** Unauthenticated attacker opens WebSocket connection and attempts to inject WebRTC offers.

**Fix Implemented:** 10-second auth timeout closes unauthenticated connections. All signaling messages rejected before AUTH is verified. Token compared with `crypto.timingSafeEqual()`.

---

## Finding 6: IT_SUPPORT Screen Access

**Severity:** HIGH  
**Affected Component:** RBAC seed (012_seed_roles_and_permissions.sql)  
**Status:** ✅ Mitigated  

**Attack Scenario:** IT_SUPPORT role is used to view employee screens without authorization.

**Fix Implemented:** IT_SUPPORT role explicitly does NOT have `sessions:request` permission in the seed. Verified in migration 012.

---

## Finding 7: Audit Log Tampering

**Severity:** HIGH  
**Affected Component:** audit_logs table (migration 009)  
**Status:** ✅ Mitigated  

**Attack Scenario:** Administrator deletes audit log entries to cover unauthorized monitoring.

**Fix Implemented:** DB trigger `trg_audit_no_delete` and `trg_audit_no_update` block all modifications. Logs are insert-only.

---

## Finding 8: Screen Content in Logs

**Severity:** HIGH (Privacy)  
**Affected Component:** audit.service.ts  
**Status:** ✅ Mitigated  

**Fix Implemented:** `FORBIDDEN_DETAIL_KEYS` set blocks `screen_content`, `keystrokes`, etc. from being written to audit logs. The WebRTC stream never passes through the backend.

---

## Finding 9: Token Exposure in Logs

**Severity:** HIGH  
**Affected Component:** logger.ts  
**Status:** ✅ Mitigated  

**Fix Implemented:** Pino redact paths cover all token field names. HTTP request/response headers are redacted. Auth controller never logs token values.

---

## Finding 10: Session Expiry

**Severity:** MEDIUM  
**Affected Component:** monitoring_sessions table  
**Status:** ✅ Mitigated  

**Fix Implemented:** `expire_stale_sessions()` DB function clears sessions exceeding `MAX_SESSION_DURATION_MINUTES`. WebRTC token is also cleared. Scheduler must call this periodically.

---

## Privacy Controls (RA 10173)

| Principle | Control | Status |
|-----------|---------|--------|
| Transparency | Visible tray icon, monitoring notice acknowledgment in users table | ✅ |
| Legitimate Purpose | RBAC enforces business-only access | ✅ |
| Proportionality | Screen only, no keylog/webcam/mic | ✅ |
| Security Safeguards | TLS, Argon2id, MFA, rate limiting | ✅ |
| Access Control | manager_agent_access, deny-by-default | ✅ |
| Retention | No screen recordings by default, configurable retention | ✅ |
| Accountability | Full immutable audit trail | ✅ |

---

## Remaining Risks (To Address in Later Phases)

| Risk | Severity | Phase |
|------|----------|-------|
| Agent client bypass (killing process) | MEDIUM | Phase 7 |
| Compromised manager account (MFA bypass) | HIGH | Phase 10 |
| TURN server compromise | HIGH | Phase 10 |
| Monitoring abuse by ADMIN | MEDIUM | Phase 10 |
| Audit log off-site backup | MEDIUM | Phase 12 |
| WebRTC DTLS certificate pinning | MEDIUM | Phase 6 |
