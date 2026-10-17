/**
 * services/api.ts — Legacy compatibility re-export
 *
 * The main API layer has been moved to services/api/index.ts.
 * This file re-exports everything for backward compatibility.
 */

export {
  authApi,
  apiClient as api,
  getErrorMessage,
  sessionsApi,
  agentsApi,
  devicesApi,
  usersApi,
  dashboardApi,
  healthApi,
  auditApi,
  securityApi,
  rolesApi,
} from './api/index';

export type {
  User, Agent, Device, Session,
  AuditLog, SecurityEvent, DashboardStats,
  HealthStatus, EnrollmentToken, EnrollmentTokenResult,
  LoginResponse, MfaVerifyResponse, PaginatedResponse,
} from './api/index';

// ── Legacy function exports ───────────────────────────────────────────────────
import { authApi } from './api/index';

export default authApi;
export const login = (email: string, password: string) => authApi.login(email, password);
export const verifyMfa = (partialToken: string, code: string) => authApi.verifyMfa(partialToken, code);
export const logout = () => authApi.logout();
