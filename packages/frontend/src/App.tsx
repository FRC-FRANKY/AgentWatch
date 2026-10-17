import { Navigate, Route, Routes, useParams, useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AppLayout } from './components/AppLayout';
import { useAuthStore } from './app/store/authStore';
import { LoginPage } from './pages/LoginPage';
import {
  agentsApi,
  devicesApi,
  sessionsApi,
  usersApi,
  auditApi,
  securityApi,
  dashboardApi,
  getErrorMessage,
} from './services/api/index';
import type { Agent, Device, Session, AuditLog, SecurityEvent, DashboardStats, User } from './services/api/index';
import { useApi, usePolling } from './hooks/useApi';
import { formatDistanceToNow, format } from 'date-fns';

// ── Utilities ────────────────────────────────────────────────────────────────

function formatDuration(seconds?: number): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    return format(new Date(dateStr), 'yyyy-MM-dd HH:mm');
  } catch {
    return dateStr;
  }
}

function getAgentStatus(agent: Agent): string {
  if (agent.activeSession) return 'MONITORING';
  return agent.deviceStatus ?? 'OFFLINE';
}

// ── Shared UI Components ──────────────────────────────────────────────────────

function LoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
      <div className="auth-loading-spinner" style={{ margin: '0 auto 16px' }} />
      <p>{message}</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: '48px', textAlign: 'center' }}>
      <p style={{ color: 'var(--red, #dc2626)', marginBottom: '16px' }}>{message}</p>
      <button className="primary-btn" onClick={onRetry}>Retry</button>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <tr>
      <td colSpan={20} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
        {message}
      </td>
    </tr>
  );
}

// ── Route Guards ──────────────────────────────────────────────────────────────

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isHydrated = useAuthStore((state) => state.isHydrated);

  if (!isHydrated) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function RoleGate({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) {
  const session = useAuthStore((state) => state.session);
  const role = session?.role ?? 'MANAGER';

  if (!allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

const roleLabels: Record<string, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  TEAM_LEADER: 'Team Leader',
  IT_SUPPORT: 'IT Support',
  AGENT: 'Agent',
};

// ── Agents Page ───────────────────────────────────────────────────────────────

function AgentsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, loading, error, refetch } = useApi(
    () => agentsApi.list({ search: debouncedSearch || undefined, status: statusFilter !== 'all' ? statusFilter : undefined }),
    [debouncedSearch, statusFilter],
  );
  usePolling(refetch, 30000);

  const agents = data?.agents ?? [];

  return (
    <section className="table-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">Authorized workforce</p>
          <h2>Agents</h2>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search agent name or device"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All status</option>
          <option value="ONLINE">Online</option>
          <option value="OFFLINE">Offline</option>
          <option value="MONITORING">Monitoring</option>
        </select>
      </div>

      <div className="table-wrap">
        {loading && <LoadingState message="Loading agents..." />}
        {error && <ErrorState message={`Unable to load agents. ${error}`} onRetry={refetch} />}
        {!loading && !error && (
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Department</th>
                <th>Device</th>
                <th>Status</th>
                <th>Last Seen</th>
                <th>Monitoring</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 ? (
                <EmptyState message="No agents found." />
              ) : (
                agents.map((agent) => {
                  const status = getAgentStatus(agent);
                  return (
                    <tr key={agent.id}>
                      <td>
                        <div className="entity-name">{agent.displayName}</div>
                        <div className="muted" style={{ fontSize: '0.75rem' }}>{agent.email}</div>
                      </td>
                      <td>{agent.departmentName ?? '—'}</td>
                      <td>{agent.deviceName ?? '—'}</td>
                      <td>
                        <span className={`status-pill ${status.toLowerCase()}`}>{status}</span>
                      </td>
                      <td>{formatRelativeTime(agent.lastHeartbeatAt)}</td>
                      <td>{agent.activeSession ? 'Active' : 'Not Monitoring'}</td>
                      <td>
                        <Link className="link-btn" to={`/agents/${agent.id}`}>View</Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── Agent Detail Page ─────────────────────────────────────────────────────────

function AgentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApi(
    () => agentsApi.list({ page: 1, limit: 100 }),
    [id],
  );

  const agent = data?.agents.find((a) => a.id === id);

  const [startingSession, setStartingSession] = useState(false);
  const [sessionError, setSessionError] = useState('');

  const handleStartMonitoring = async () => {
    if (!agent?.deviceId) {
      setSessionError('No device registered for this agent.');
      return;
    }
    setStartingSession(true);
    setSessionError('');
    try {
      const session = await sessionsApi.start(agent.id, agent.deviceId);
      navigate(`/monitor/${session.id}`);
    } catch (err) {
      setSessionError(getErrorMessage(err));
    } finally {
      setStartingSession(false);
    }
  };

  if (loading) return <LoadingState message="Loading agent profile..." />;
  if (error) return <ErrorState message={`Unable to load agent. ${error}`} onRetry={refetch} />;
  if (!agent) return <ErrorState message="Agent not found." onRetry={refetch} />;

  const status = getAgentStatus(agent);

  return (
    <section className="detail-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">Agent profile</p>
          <h2>{agent.displayName}</h2>
        </div>
        {!agent.activeSession && agent.deviceStatus === 'ONLINE' && (
          <button
            className="primary-btn"
            onClick={handleStartMonitoring}
            disabled={startingSession}
          >
            {startingSession ? 'Starting...' : 'Start Monitoring'}
          </button>
        )}
        {agent.activeSession && (
          <span className="status-pill monitoring">Monitoring Active</span>
        )}
      </div>

      {sessionError && (
        <div className="notice" style={{ color: 'var(--red, #dc2626)', marginBottom: '16px' }}>
          {sessionError}
        </div>
      )}

      <div className="info-grid">
        <div className="info-box"><span>Email</span><strong>{agent.email}</strong></div>
        <div className="info-box"><span>Department</span><strong>{agent.departmentName ?? '—'}</strong></div>
        <div className="info-box"><span>Workstation</span><strong>{agent.deviceName ?? 'No device registered'}</strong></div>
        <div className="info-box"><span>Device status</span><strong>{agent.deviceStatus ?? '—'}</strong></div>
        <div className="info-box"><span>Last heartbeat</span><strong>{formatRelativeTime(agent.lastHeartbeatAt)}</strong></div>
        <div className="info-box"><span>Monitoring status</span>
          <strong><span className={`status-pill ${status.toLowerCase()}`}>{status}</span></strong>
        </div>
      </div>
    </section>
  );
}

// ── Devices Page ──────────────────────────────────────────────────────────────

function DevicesPage() {
  const { data, loading, error, refetch } = useApi(() => devicesApi.list(), []);
  usePolling(refetch, 30000);

  const devices = data?.devices ?? [];

  return (
    <section className="table-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">Infrastructure</p>
          <h2>Devices</h2>
        </div>
      </div>

      <div className="table-wrap">
        {loading && <LoadingState message="Loading devices..." />}
        {error && <ErrorState message={`Unable to load devices. ${error}`} onRetry={refetch} />}
        {!loading && !error && (
          <table>
            <thead>
              <tr>
                <th>Device Name</th>
                <th>Hostname</th>
                <th>OS</th>
                <th>Status</th>
                <th>Last Heartbeat</th>
                <th>Client Version</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <EmptyState message="No devices registered." />
              ) : (
                devices.map((device) => (
                  <tr key={device.id}>
                    <td>{device.deviceName}</td>
                    <td>{device.hostname}</td>
                    <td>{[device.osType, device.osVersion].filter(Boolean).join(' ') || '—'}</td>
                    <td>
                      <span className={`status-pill ${device.status.toLowerCase()}`}>
                        {device.status}
                      </span>
                    </td>
                    <td>{formatRelativeTime(device.lastHeartbeatAt)}</td>
                    <td>{device.clientVersion ?? '—'}</td>
                    <td className="action-group">
                      <Link to={`/devices/${device.id}`} className="link-btn">View</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── Device Detail Page ────────────────────────────────────────────────────────

function DeviceDetailPage() {
  const { id } = useParams();
  const { data, loading, error, refetch } = useApi(() => devicesApi.list(), []);

  const device: Device | undefined = data?.devices.find((d) => d.id === id);

  if (loading) return <LoadingState message="Loading device details..." />;
  if (error) return <ErrorState message={`Unable to load device. ${error}`} onRetry={refetch} />;
  if (!device) return <ErrorState message="Device not found." onRetry={refetch} />;

  return (
    <section className="detail-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">Device details</p>
          <h2>{device.deviceName}</h2>
        </div>
        <span className={`status-pill ${device.status.toLowerCase()}`}>{device.status}</span>
      </div>

      <div className="info-grid">
        <div className="info-box"><span>Device ID</span><strong style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{device.id}</strong></div>
        <div className="info-box"><span>Hostname</span><strong>{device.hostname}</strong></div>
        <div className="info-box"><span>OS Type</span><strong>{device.osType ?? '—'}</strong></div>
        <div className="info-box"><span>OS Version</span><strong>{device.osVersion ?? '—'}</strong></div>
        <div className="info-box"><span>Client version</span><strong>{device.clientVersion ?? '—'}</strong></div>
        <div className="info-box"><span>Registration date</span><strong>{formatDateTime(device.registeredAt)}</strong></div>
        <div className="info-box"><span>Last heartbeat</span><strong>{formatRelativeTime(device.lastHeartbeatAt)}</strong></div>
        <div className="info-box"><span>Last seen IP</span><strong>{device.lastSeenIp ?? '—'}</strong></div>
        <div className="info-box"><span>MAC Address</span><strong>{device.macAddress ?? '—'}</strong></div>
        <div className="info-box"><span>Active</span><strong>{device.isActive ? 'Yes' : 'No'}</strong></div>
      </div>
    </section>
  );
}

// ── Sessions Page ─────────────────────────────────────────────────────────────

function SessionsPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const { data, loading, error, refetch } = useApi(
    () => sessionsApi.list({ status: statusFilter !== 'all' ? statusFilter : undefined }),
    [statusFilter],
  );
  usePolling(refetch, 30000);

  const sessions = data?.sessions ?? [];

  const handleStop = async (id: string) => {
    if (!confirm('Stop this monitoring session?')) return;
    try {
      await sessionsApi.stop(id);
      refetch();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  return (
    <section className="table-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">Monitoring activity</p>
          <h2>Sessions</h2>
        </div>
      </div>

      <div className="toolbar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All status</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING">Pending</option>
          <option value="ENDED">Ended</option>
          <option value="TERMINATED">Terminated</option>
        </select>
      </div>

      <div className="table-wrap">
        {loading && <LoadingState message="Loading sessions..." />}
        {error && <ErrorState message={`Unable to load sessions. ${error}`} onRetry={refetch} />}
        {!loading && !error && (
          <table>
            <thead>
              <tr>
                <th>Session ID</th>
                <th>Manager</th>
                <th>Agent</th>
                <th>Device</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <EmptyState message="No monitoring sessions found." />
              ) : (
                sessions.map((session) => {
                  const isActive = ['PENDING', 'ACTIVE'].includes(session.status);
                  // Calculate live duration for active sessions
                  const duration = isActive && session.startedAt
                    ? Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000)
                    : session.sessionDurationSeconds;

                  return (
                    <tr key={session.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {session.id.slice(0, 8)}...
                      </td>
                      <td>{(session as Session & { managerName?: string }).managerName ?? session.managerEmail ?? '—'}</td>
                      <td>{(session as Session & { agentName?: string }).agentName ?? session.agentEmail ?? '—'}</td>
                      <td>{session.deviceName ?? '—'}</td>
                      <td>{formatDateTime(session.startedAt ?? session.requestedAt)}</td>
                      <td>{formatDuration(duration)}</td>
                      <td>
                        <span className={`status-pill ${session.status.toLowerCase()}`}>
                          {session.status}
                        </span>
                      </td>
                      <td className="action-group">
                        {isActive ? (
                          <>
                            <Link className="link-btn" to={`/monitor/${session.id}`}>View</Link>
                            <button className="danger-link" onClick={() => handleStop(session.id)}>Stop</button>
                          </>
                        ) : (
                          <Link className="link-btn" to={`/sessions/${session.id}`}>Details</Link>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── Monitoring Page ───────────────────────────────────────────────────────────

function MonitoringPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [stopping, setStopping] = useState(false);

  const { data: session, loading, error, refetch } = useApi(
    () => sessionId ? sessionsApi.getById(sessionId) : Promise.resolve(null),
    [sessionId],
  );
  usePolling(refetch, 15000, !!session && ['PENDING', 'ACTIVE'].includes(session.status));

  const handleStop = async () => {
    if (!sessionId) return;
    if (!confirm('Stop this monitoring session?')) return;
    setStopping(true);
    try {
      await sessionsApi.stop(sessionId);
      navigate('/sessions');
    } catch (err) {
      alert(getErrorMessage(err));
      setStopping(false);
    }
  };

  if (!sessionId || sessionId === 'active') {
    return (
      <section className="monitor-panel">
        <div className="monitor-header">
          <div>
            <p className="eyebrow">Remote monitoring</p>
            <h2>Live Monitoring</h2>
          </div>
        </div>
        <div className="screen-frame">
          <div className="screen-placeholder">
            <div className="screen-badge">No active monitoring session.</div>
            <div style={{ marginTop: '12px' }}>
              <Link className="primary-btn" to="/agents">Select an Agent to Monitor</Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (loading) return <LoadingState message="Loading monitoring session..." />;
  if (error) return <ErrorState message={`Unable to load session. ${error}`} onRetry={refetch} />;

  const isActive = session && ['PENDING', 'ACTIVE'].includes(session.status);

  return (
    <section className="monitor-panel">
      <div className="monitor-header">
        <div>
          <p className="eyebrow">Remote monitoring</p>
          <h2>Session {sessionId?.slice(0, 8)}...</h2>
        </div>
        <div className="monitor-actions">
          {isActive && (
            <button
              className="danger-btn"
              onClick={handleStop}
              disabled={stopping}
            >
              {stopping ? 'Stopping...' : 'Stop Monitoring'}
            </button>
          )}
        </div>
      </div>

      {session && (
        <div className="info-grid" style={{ marginBottom: '20px' }}>
          <div className="info-box"><span>Agent</span><strong>{(session as Session & { agentName?: string }).agentName ?? session.agentEmail ?? '—'}</strong></div>
          <div className="info-box"><span>Device</span><strong>{session.deviceName ?? session.deviceId}</strong></div>
          <div className="info-box"><span>Status</span><strong><span className={`status-pill ${session.status.toLowerCase()}`}>{session.status}</span></strong></div>
          <div className="info-box"><span>Started</span><strong>{formatDateTime(session.startedAt)}</strong></div>
          {session.sessionDurationSeconds !== undefined && (
            <div className="info-box"><span>Duration</span><strong>{formatDuration(session.sessionDurationSeconds)}</strong></div>
          )}
        </div>
      )}

      <div className="screen-frame">
        <div className="screen-placeholder">
          {isActive ? (
            <>
              <div className="screen-badge">MONITORING ACTIVE — Authorized monitoring session in progress.</div>
              <div style={{ color: 'var(--text-muted)', marginTop: '12px', fontSize: '0.875rem' }}>
                WebRTC screen sharing requires the agent-client application to be running on the monitored workstation.
              </div>
            </>
          ) : (
            <div className="screen-badge">Session {session?.status ?? 'not found'}.</div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Audit Logs Page ───────────────────────────────────────────────────────────

function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const { data, loading, error, refetch } = useApi(
    () => auditApi.list({ page, limit: 50 }),
    [page],
  );

  const logs: AuditLog[] = data?.data ?? [];

  return (
    <section className="table-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">Security operations</p>
          <h2>Audit Logs</h2>
        </div>
      </div>

      <div className="table-wrap">
        {loading && <LoadingState message="Loading audit logs..." />}
        {error && <ErrorState message={`Unable to load audit logs. ${error}`} onRetry={refetch} />}
        {!loading && !error && (
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Target</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <EmptyState message="No audit logs found." />
              ) : (
                logs.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td>{entry.actorEmail ?? '—'}</td>
                    <td>{entry.actorRole ?? '—'}</td>
                    <td>
                      <span className="status-pill info" style={{ fontSize: '0.7rem' }}>
                        {entry.action}
                      </span>
                    </td>
                    <td>{entry.targetId ? `${entry.targetType ?? ''}:${entry.targetId.slice(0, 8)}` : '—'}</td>
                    <td>{entry.sourceIp ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
      {logs.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', padding: '12px', justifyContent: 'center' }}>
          <button className="ghost-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Previous</button>
          <span style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>Page {page}</span>
          <button className="ghost-btn" disabled={logs.length < 50} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </section>
  );
}

// ── Security Page ─────────────────────────────────────────────────────────────

function SecurityPage() {
  const [severityFilter, setSeverityFilter] = useState('all');
  const { data, loading, error, refetch } = useApi(
    () => securityApi.listEvents({ severity: severityFilter !== 'all' ? severityFilter : undefined }),
    [severityFilter],
  );
  usePolling(refetch, 60000);

  const events: SecurityEvent[] = data?.events ?? [];

  const severityToTone: Record<string, string> = {
    LOW: 'info',
    MEDIUM: 'warning',
    HIGH: 'alert',
    CRITICAL: 'critical',
  };

  return (
    <section className="details-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Overview</p>
          <h2>Security</h2>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: '20px' }}>
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="all">All severity</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
      </div>

      <div className="table-card">
        <h3>Security events</h3>
        {loading && <LoadingState message="Loading security events..." />}
        {error && <ErrorState message={`Unable to load security events. ${error}`} onRetry={refetch} />}
        {!loading && !error && (
          <ul className="event-list">
            {events.length === 0 ? (
              <li className="event-item" style={{ justifyContent: 'center', color: 'var(--text-muted)' }}>
                No security events found.
              </li>
            ) : (
              events.map((event) => (
                <li key={event.id} className="event-item">
                  <div>
                    <strong>{event.eventType.replace(/_/g, ' ')}</strong>
                    <div className="muted">{formatRelativeTime(event.createdAt)}</div>
                    {event.actorEmail && <div className="muted" style={{ fontSize: '0.75rem' }}>{event.actorEmail}</div>}
                  </div>
                  <span className={`status-pill ${severityToTone[event.severity] ?? 'warning'}`}>
                    {event.severity}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Users Page ────────────────────────────────────────────────────────────────

function UsersPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, loading, error, refetch } = useApi(
    () => usersApi.list({ search: debouncedSearch || undefined }),
    [debouncedSearch],
  );

  const users: User[] = data?.users ?? [];

  const handleDisable = async (id: string, currentlyActive: boolean) => {
    const action = currentlyActive ? 'disable' : 're-enable';
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this user?`)) return;
    try {
      await usersApi.update(id, { isActive: !currentlyActive });
      refetch();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  return (
    <section className="table-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Users</h2>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        {loading && <LoadingState message="Loading users..." />}
        {error && <ErrorState message={`Unable to load users. ${error}`} onRetry={refetch} />}
        {!loading && !error && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Department</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <EmptyState message="No users found." />
              ) : (
                users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.displayName}</td>
                    <td>{user.email}</td>
                    <td>{roleLabels[user.roleName] ?? user.roleName}</td>
                    <td>{user.departmentName ?? '—'}</td>
                    <td>
                      <span className={`status-pill ${user.isActive ? 'online' : 'offline'}`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : 'Never'}</td>
                    <td className="action-group">
                      <button
                        className={user.isActive ? 'danger-link' : 'ghost-btn'}
                        onClick={() => handleDisable(user.id, user.isActive)}
                      >
                        {user.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── Settings Page ─────────────────────────────────────────────────────────────

function SettingsPage() {
  const session = useAuthStore((state) => state.session);

  return (
    <section className="detail-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">System configuration</p>
          <h2>Settings</h2>
        </div>
      </div>

      <div className="info-grid">
        <div className="info-box"><span>Application</span><strong>AgentWatch v1.0.0</strong></div>
        <div className="info-box"><span>Environment</span><strong>{import.meta.env.DEV ? 'Development / Demo Mode' : 'Production'}</strong></div>
        <div className="info-box"><span>Your role</span><strong>{session?.role ?? '—'}</strong></div>
        <div className="info-box"><span>API endpoint</span><strong>{import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api'}</strong></div>
      </div>

      <div className="table-card" style={{ marginTop: '24px' }}>
        <h3>System Information</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '8px' }}>
          AgentWatch is running in demo mode. Configuration management is available for ADMIN users when connected to a live database.
        </p>
      </div>
    </section>
  );
}

// ── Profile Page ──────────────────────────────────────────────────────────────

function ProfilePage() {
  const session = useAuthStore((state) => state.session);
  const { data, loading } = useApi(() => usersApi.getProfile(), []);

  return (
    <section className="detail-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">Profile</p>
          <h2>{data?.displayName ?? session?.displayName ?? session?.email ?? 'User profile'}</h2>
        </div>
      </div>

      {loading ? (
        <LoadingState message="Loading profile..." />
      ) : (
        <div className="info-grid">
          <div className="info-box"><span>Display Name</span><strong>{data?.displayName ?? session?.displayName ?? '—'}</strong></div>
          <div className="info-box"><span>Email</span><strong>{data?.email ?? session?.email ?? '—'}</strong></div>
          <div className="info-box"><span>Role</span><strong>{data?.role ?? session?.role ?? '—'}</strong></div>
          <div className="info-box"><span>Department</span><strong>{data?.departmentName ?? '—'}</strong></div>
          <div className="info-box"><span>MFA</span><strong>{data?.isMfaEnabled ? 'Enabled' : 'Not configured'}</strong></div>
          <div className="info-box"><span>Last login</span><strong>{data?.lastLoginAt ? formatRelativeTime(data.lastLoginAt) : '—'}</strong></div>
        </div>
      )}
    </section>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────────────────

function DashboardPage() {
  const { data: stats, loading: statsLoading, refetch: refetchStats } = useApi<DashboardStats>(
    () => dashboardApi.getStats(),
    [],
  );
  const { data: sessionsData, loading: sessionsLoading, refetch: refetchSessions } = useApi(
    () => sessionsApi.list({ limit: 5 }),
    [],
  );
  const { data: eventsData, loading: eventsLoading, refetch: refetchEvents } = useApi(
    () => securityApi.listEvents({ limit: 5 }),
    [],
  );
  const { data: agentsData, loading: agentsLoading, refetch: refetchAgents } = useApi(
    () => agentsApi.list({ limit: 8 }),
    [],
  );

  usePolling(() => {
    void refetchStats();
    void refetchSessions();
    void refetchEvents();
    void refetchAgents();
  }, 30000);

  const sessions = sessionsData?.sessions ?? [];
  const events = eventsData?.events ?? [];
  const agents = agentsData?.agents ?? [];

  const displayStats = stats ?? {
    onlineAgents: 0,
    offlineAgents: 0,
    activeMonitoring: 0,
    securityEvents: 0,
  };

  const statCards = [
    { label: 'Online Agents', value: statsLoading ? '—' : String(displayStats.onlineAgents), tone: 'success' },
    { label: 'Offline Agents', value: statsLoading ? '—' : String(displayStats.offlineAgents), tone: 'neutral' },
    { label: 'Active Monitoring', value: statsLoading ? '—' : String(displayStats.activeMonitoring), tone: 'info' },
    { label: 'Security Events (24h)', value: statsLoading ? '—' : String(displayStats.securityEvents), tone: 'warning' },
  ];

  return (
    <>
      <section className="stats-grid">
        {statCards.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="stat-label">{stat.label}</div>
            <div className={`stat-value ${stat.tone}`}>{stat.value}</div>
          </div>
        ))}
      </section>

      <div className="content-grid">
        <div className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Workforce</p>
              <h2>Recent monitoring sessions</h2>
            </div>
          </div>

          <div className="table-wrap mini-table">
            {sessionsLoading ? (
              <LoadingState message="Loading sessions..." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Device</th>
                    <th>Manager</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <EmptyState message="No monitoring sessions." />
                  ) : (
                    sessions.map((session) => {
                      const isActive = ['PENDING', 'ACTIVE'].includes(session.status);
                      const duration = isActive && session.startedAt
                        ? Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000)
                        : session.sessionDurationSeconds;
                      return (
                        <tr key={session.id}>
                          <td>{(session as Session & { agentName?: string }).agentName ?? session.agentEmail ?? '—'}</td>
                          <td>{session.deviceName ?? '—'}</td>
                          <td>{(session as Session & { managerName?: string }).managerName ?? session.managerEmail ?? '—'}</td>
                          <td>{formatDateTime(session.startedAt ?? session.requestedAt)}</td>
                          <td>{formatDuration(duration)}</td>
                          <td><span className={`status-pill ${session.status.toLowerCase()}`}>{session.status}</span></td>
                          <td>
                            <Link className="link-btn" to={isActive ? `/monitor/${session.id}` : `/sessions/${session.id}`}>
                              View
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <aside className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Threat watch</p>
              <h2>Recent security events</h2>
            </div>
          </div>

          <div className="activity-list">
            {eventsLoading ? (
              <LoadingState message="Loading..." />
            ) : events.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No recent security events.
              </div>
            ) : (
              events.map((event) => (
                <div key={event.id} className="activity-item">
                  <div>
                    <strong>{event.eventType.replace(/_/g, ' ')}</strong>
                    <div className="muted">{formatRelativeTime(event.createdAt)}</div>
                  </div>
                  <span className={`status-pill ${event.severity === 'CRITICAL' ? 'critical' : event.severity === 'HIGH' ? 'alert' : 'warning'}`}>
                    {event.severity}
                  </span>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      <section className="panel margin-top">
        <div className="section-head">
          <div>
            <p className="eyebrow">Authorized agents</p>
            <h2>Live agent roster</h2>
          </div>
          <Link className="ghost-btn" to="/agents">View all</Link>
        </div>

        <div className="agent-list">
          {agentsLoading ? (
            <LoadingState message="Loading agents..." />
          ) : agents.length === 0 ? (
            <div style={{ padding: '24px', color: 'var(--text-muted)' }}>No agents found.</div>
          ) : (
            agents.map((agent) => {
              const status = getAgentStatus(agent);
              return (
                <div className="agent-card" key={agent.id}>
                  <div className="agent-top">
                    <strong>{agent.displayName}</strong>
                    <span className={`status-pill ${status.toLowerCase()}`}>{status}</span>
                  </div>
                  <div className="agent-details">
                    <div>Dept: {agent.departmentName ?? '—'}</div>
                    <div>PC: {agent.deviceName ?? 'No device'}</div>
                    <div>Last seen: {formatRelativeTime(agent.lastHeartbeatAt)}</div>
                  </div>
                  <div className="card-actions">
                    <Link className="primary-btn small-btn" to={`/agents/${agent.id}`}>View</Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </>
  );
}

// ── Session Detail Page ───────────────────────────────────────────────────────

function SessionDetailPage() {
  const { id } = useParams();
  const { data: session, loading, error, refetch } = useApi(
    () => id ? sessionsApi.getById(id) : Promise.resolve(null),
    [id],
  );

  if (loading) return <LoadingState message="Loading session details..." />;
  if (error) return <ErrorState message={`Unable to load session. ${error}`} onRetry={refetch} />;
  if (!session) return <ErrorState message="Session not found." onRetry={refetch} />;

  return (
    <section className="detail-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">Session details</p>
          <h2>Session {session.id.slice(0, 8)}...</h2>
        </div>
        <span className={`status-pill ${session.status.toLowerCase()}`}>{session.status}</span>
      </div>
      <div className="info-grid">
        <div className="info-box"><span>Agent</span><strong>{(session as Session & { agentName?: string }).agentName ?? session.agentEmail ?? '—'}</strong></div>
        <div className="info-box"><span>Device</span><strong>{session.deviceName ?? session.deviceId}</strong></div>
        <div className="info-box"><span>Manager</span><strong>{(session as Session & { managerName?: string }).managerName ?? session.managerEmail ?? '—'}</strong></div>
        <div className="info-box"><span>Status</span><strong>{session.status}</strong></div>
        <div className="info-box"><span>Requested at</span><strong>{formatDateTime(session.requestedAt)}</strong></div>
        <div className="info-box"><span>Started at</span><strong>{formatDateTime(session.startedAt)}</strong></div>
        <div className="info-box"><span>Ended at</span><strong>{formatDateTime(session.endedAt)}</strong></div>
        <div className="info-box"><span>Duration</span><strong>{formatDuration(session.sessionDurationSeconds)}</strong></div>
      </div>
    </section>
  );
}

// ── App Shell ─────────────────────────────────────────────────────────────────

function AppShell() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:id" element={<AgentDetailPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/devices/:id" element={<DeviceDetailPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
        <Route path="/monitor/:sessionId" element={<MonitoringPage />} />
        <Route path="/monitor/active" element={<MonitoringPage />} />
        <Route path="/audit-logs" element={<AuditLogsPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/users" element={<RoleGate allowedRoles={['ADMIN']}><UsersPage /></RoleGate>} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isHydrated = useAuthStore((state) => state.isHydrated);

  if (!isHydrated) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
      <Route path="/*" element={<ProtectedRoute><AppShell /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}

export default App;
