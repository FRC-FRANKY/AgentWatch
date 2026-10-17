/**
 * services/api/index.ts — Centralized API Service Layer
 *
 * Single source of truth for all backend communication.
 * All API calls go through this layer — never scatter fetch/axios calls in components.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { useAuthStore } from '../../app/store/authStore';

// ── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  displayName: string;
  roleName: string;
  roleId?: string;
  departmentName?: string;
  isActive: boolean;
  isMfaEnabled: boolean;
  lastLoginAt?: string;
  createdAt?: string;
  employeeId?: string;
}

export interface Agent {
  id: string;
  displayName: string;
  email: string;
  departmentName?: string;
  deviceStatus?: 'ONLINE' | 'OFFLINE' | 'DISABLED' | string;
  deviceName?: string;
  deviceId?: string;
  lastHeartbeatAt?: string;
  activeSession: boolean;
}

export interface Device {
  id: string;
  deviceName: string;
  hostname: string;
  macAddress?: string;
  agentUserId?: string;
  status: 'ONLINE' | 'OFFLINE' | 'DISABLED' | string;
  lastHeartbeatAt?: string;
  lastSeenIp?: string;
  osType?: string;
  osVersion?: string;
  clientVersion?: string;
  isActive: boolean;
  registeredAt?: string;
  updatedAt?: string;
}

export interface Session {
  id: string;
  managerId: string;
  managerEmail?: string;
  managerName?: string;
  agentId: string;
  agentEmail?: string;
  agentName?: string;
  deviceId: string;
  deviceName?: string;
  status: 'PENDING' | 'ACTIVE' | 'ENDED' | 'TERMINATED' | 'EXPIRED' | 'FAILED' | string;
  requestedAt: string;
  startedAt?: string;
  endedAt?: string;
  sessionDurationSeconds?: number;
}

export interface AuditLog {
  id: string;
  action: string;
  actorEmail?: string;
  actorRole?: string;
  targetId?: string;
  targetType?: string;
  sessionId?: string;
  details?: Record<string, unknown>;
  sourceIp?: string;
  createdAt: string;
}

export interface SecurityEvent {
  id: string;
  eventType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;
  actorEmail?: string;
  sourceIp?: string;
  details?: Record<string, unknown>;
  createdAt: string;
  resolvedAt?: string;
  status: string;
}

export interface DashboardStats {
  onlineAgents: number;
  offlineAgents: number;
  activeMonitoring: number;
  securityEvents: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'offline';
  database?: 'ok' | 'error';
  timestamp?: string;
  uptime?: number;
}

export interface EnrollmentToken {
  id: string;
  label?: string;
  agentUserId?: string;
  isConsumed: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface EnrollmentTokenResult extends EnrollmentToken {
  rawToken: string;  // Shown once, never stored again
  managerId: string;
}

export interface LoginResponse {
  requiresMfa: boolean;
  accessToken?: string;
  expiresIn?: number;
  displayName?: string;
  role?: string;
  partialToken?: string;
}

export interface MfaVerifyResponse {
  accessToken: string;
  expiresIn: number;
}

export interface PaginatedResponse<T> {
  data?: T[];
  agents?: T[];
  users?: T[];
  devices?: T[];
  sessions?: T[];
  events?: T[];
  total: number;
  page?: number;
  limit?: number;
}

// ── Axios Instance ────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

let refreshPromise: Promise<string | null> | null = null;

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: inject access token ──────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('agentwatch_access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: handle 401 with refresh ────────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean };

    // Only attempt refresh on 401, non-auth endpoints, first retry only
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest?.url?.includes('/auth/login') &&
      !originalRequest?.url?.includes('/auth/mfa') &&
      !originalRequest?.url?.includes('/auth/refresh')
    ) {
      originalRequest._retry = true;

      // Deduplicate concurrent refresh attempts
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }

      const newToken = await refreshPromise;
      if (newToken && originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      }

      // Refresh failed — clear session
      useAuthStore.getState().clearSession();
    }

    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  },
);

async function refreshAccessToken(): Promise<string | null> {
  try {
    const response = await axios.post<{ accessToken: string; expiresIn: number }>(
      `${API_BASE}/auth/refresh`,
      {},
      { withCredentials: true },
    );
    const { accessToken } = response.data;
    localStorage.setItem('agentwatch_access_token', accessToken);

    // Update the store with the fresh token
    const store = useAuthStore.getState();
    if (store.session) {
      store.setSession({ ...store.session, accessToken });
    }

    return accessToken;
  } catch {
    return null;
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const { data } = await apiClient.post<LoginResponse>('/auth/login', { email, password });
    return data;
  },

  async verifyMfa(partialToken: string, code: string): Promise<MfaVerifyResponse> {
    const { data } = await apiClient.post<MfaVerifyResponse>('/auth/mfa/verify', {
      partialToken,
      code,
    });
    return data;
  },

  async logout(): Promise<void> {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Clear local state regardless of server response
    } finally {
      useAuthStore.getState().clearSession();
    }
  },

  async getMe(): Promise<User & { role: string; permissions: string[]; mfaVerified: boolean }> {
    const { data } = await apiClient.get('/auth/me');
    return data;
  },

  async refresh(): Promise<{ accessToken: string; expiresIn: number }> {
    const { data } = await axios.post<{ accessToken: string; expiresIn: number }>(
      `${API_BASE}/auth/refresh`,
      {},
      { withCredentials: true },
    );
    return data;
  },
};

// ── Health ────────────────────────────────────────────────────────────────────

export const healthApi = {
  async check(): Promise<HealthStatus> {
    try {
      const { data } = await axios.get<HealthStatus>(`${API_BASE}/health`, { timeout: 5000 });
      return data;
    } catch {
      return { status: 'offline' };
    }
  },
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

export const dashboardApi = {
  async getStats(): Promise<DashboardStats> {
    const { data } = await apiClient.get<DashboardStats>('/users/dashboard/stats');
    return data;
  },
};

// ── Agents ────────────────────────────────────────────────────────────────────

export const agentsApi = {
  /** List agents accessible to the authenticated manager */
  async list(params?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  }): Promise<{ agents: Agent[]; total: number }> {
    // Uses /users/agents (legacy route, still served by usersRoutes)
    const { data } = await apiClient.get<{ agents: Agent[]; total: number }>('/users/agents', {
      params,
    });
    return data;
  },

  /** Grant the authenticated manager access to an existing agent user */
  async grantAccess(agentId: string, reason?: string): Promise<{ id: string; agentId: string; managerId: string }> {
    const { data } = await apiClient.post('/agents/access', { agentId, reason });
    return data;
  },

  /** Create a one-time enrollment token for an agent */
  async createEnrollmentToken(input: {
    agentUserId?: string;
    label?: string;
    expiresInHours?: number;
  }): Promise<EnrollmentTokenResult> {
    const { data } = await apiClient.post<EnrollmentTokenResult>('/agents/enrollment-tokens', input);
    return data;
  },

  /** List enrollment tokens created by the authenticated manager */
  async listEnrollmentTokens(): Promise<{ tokens: EnrollmentToken[] }> {
    const { data } = await apiClient.get<{ tokens: EnrollmentToken[] }>('/agents/enrollment-tokens');
    return data;
  },

  /** Register a device for a specific agent (ownership enforced server-side) */
  async registerDeviceForAgent(
    agentId: string,
    input: {
      deviceName: string;
      hostname: string;
      macAddress?: string;
      osType?: string;
      osVersion?: string;
      clientVersion?: string;
      notes?: string;
    },
  ): Promise<{ deviceId: string; deviceToken: string; status: string }> {
    const { data } = await apiClient.post(`/agents/${agentId}/devices`, input);
    return data;
  },
};

// ── Devices ───────────────────────────────────────────────────────────────────

export const devicesApi = {
  async list(): Promise<{ devices: Device[] }> {
    const { data } = await apiClient.get<{ devices: Device[] }>('/devices');
    return data;
  },

  async register(input: {
    agentUserId: string;
    deviceName: string;
    hostname: string;
    macAddress?: string;
    osType?: string;
    osVersion?: string;
    clientVersion?: string;
    notes?: string;
  }): Promise<{
    deviceId: string;
    deviceSecret: string;
    registrationToken: string;
    deviceToken: string;
    status: string;
  }> {
    const { data } = await apiClient.post('/devices/register', input);
    return data;
  },
};

// ── Sessions ──────────────────────────────────────────────────────────────────

export const sessionsApi = {
  async list(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<{ sessions: Session[]; total: number }> {
    const { data } = await apiClient.get<{ sessions: Session[]; total: number }>('/sessions', {
      params,
    });
    return data;
  },

  async getById(id: string): Promise<Session | null> {
    try {
      const { data } = await apiClient.get<Session>(`/sessions/${id}`);
      return data;
    } catch (err) {
      if ((err as AxiosError).response?.status === 404) return null;
      throw err;
    }
  },

  async get(id: string): Promise<Session & { webrtcToken?: string }> {
    const { data } = await apiClient.get<Session & { webrtcToken?: string }>(`/sessions/${id}`);
    return data;
  },

  async start(agentId: string, deviceId: string): Promise<Session & { webrtcToken?: string }> {
    const { data } = await apiClient.post<Session & { webrtcToken?: string }>('/sessions', { agentId, deviceId });
    return data;
  },

  async stop(id: string, reason = 'MANAGER_REQUEST'): Promise<void> {
    await apiClient.delete(`/sessions/${id}`, { data: { reason } });
  },
};

// ── Users ─────────────────────────────────────────────────────────────────────

export const usersApi = {
  async list(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{ users: User[]; total: number }> {
    const { data } = await apiClient.get<{ users: User[]; total: number }>('/users', {
      params,
    });
    return data;
  },

  async getById(id: string): Promise<User> {
    const { data } = await apiClient.get<User>(`/users/${id}`);
    return data;
  },

  async getProfile(): Promise<User & { role: string; permissions: string[] }> {
    const { data } = await apiClient.get('/users/me/profile');
    return data;
  },

  async create(input: {
    email: string;
    displayName: string;
    password: string;
    roleId: string;
    departmentId?: string;
    employeeId?: string;
  }): Promise<User> {
    const { data } = await apiClient.post<User>('/users', input);
    return data;
  },

  async update(
    id: string,
    input: {
      displayName?: string;
      roleId?: string;
      isActive?: boolean;
    },
  ): Promise<User> {
    const { data } = await apiClient.patch<User>(`/users/${id}`, input);
    return data;
  },
};

// ── Audit ─────────────────────────────────────────────────────────────────────

export const auditApi = {
  async list(params?: {
    page?: number;
    limit?: number;
  }): Promise<{ data: AuditLog[]; page: number; limit: number }> {
    const { data } = await apiClient.get('/audit', { params });
    return data;
  },
};

// ── Security Events ───────────────────────────────────────────────────────────

export const securityApi = {
  async listEvents(params?: {
    page?: number;
    limit?: number;
    severity?: string;
  }): Promise<{ events: SecurityEvent[]; total: number }> {
    const { data } = await apiClient.get<{ events: SecurityEvent[]; total: number }>(
      '/users/security-events',
      { params },
    );
    return data;
  },
};

// ── Roles ─────────────────────────────────────────────────────────────────────

export const rolesApi = {
  async list(): Promise<Array<{ id: string; name: string; displayName: string; description?: string }>> {
    try {
      const { data } = await apiClient.get('/roles');
      return data.roles ?? data ?? [];
    } catch {
      return [];
    }
  },
};

// ── Error helpers ─────────────────────────────────────────────────────────────

export function getErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const msg = err.response?.data?.error ?? err.response?.data?.message ?? err.message;
    return typeof msg === 'string' ? msg : 'An error occurred. Please try again.';
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred.';
}
