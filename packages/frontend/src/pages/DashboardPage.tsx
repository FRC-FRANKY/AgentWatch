import { useEffect, useState, useCallback } from 'react';
import { AppLayout } from '../components/AppLayout';
import { dashboardApi, agentsApi, sessionsApi, type Agent, type Session, type DashboardStats } from '../services/api/index';
import { useAuthStore } from '../app/store/authStore';
import { useFirestoreDashboardStats } from '../hooks/useFirestoreDashboardStats';
import { useFirestoreDeviceStatus } from '../hooks/useFirestoreDeviceStatus';

// ── Live status badge with Firestore overlay ───────────────────────────────────

function DeviceBadge({
  deviceId,
  fallback,
}: {
  deviceId: string | undefined;
  fallback: string | undefined;
}) {
  const { status, isLive } = useFirestoreDeviceStatus(
    deviceId,
    (fallback?.toUpperCase() as 'ONLINE' | 'OFFLINE' | 'DISABLED') ?? 'UNKNOWN',
  );

  const label = status === 'UNKNOWN' ? (fallback ?? '—') : status;
  const liveIndicator = isLive ? ' ⬤' : '';

  return (
    <span
      className={`status-pill ${label.toLowerCase()}`}
      title={isLive ? 'Live status from Firestore' : 'Status from last API poll'}
    >
      {label}{liveIndicator}
    </span>
  );
}

// ── Dashboard Page ─────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { session } = useAuthStore();
  const managerId = session?.id;

  // ── Firestore live stats (updates in real time as devices heartbeat/sessions change)
  const firestoreStats = useFirestoreDashboardStats(managerId);

  // ── API-fetched data (initial load + periodic refresh fallback) ──────────────
  const [apiStats, setApiStats] = useState<DashboardStats | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, agentsRes, sessionsRes] = await Promise.all([
        dashboardApi.getStats(),
        agentsApi.list({ limit: 12 }),
        sessionsApi.list({ limit: 5 }),
      ]);
      setApiStats(statsRes);
      setAgents(agentsRes.agents);
      setRecentSessions(sessionsRes.sessions ?? []);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    // Fallback polling every 60s if Firestore is not live
    const interval = setInterval(() => void fetchData(), 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Merge: prefer live Firestore stats once they arrive ──────────────────────
  const onlineAgents  = firestoreStats.isLive ? firestoreStats.onlineAgents  : (apiStats?.onlineAgents  ?? 0);
  const offlineAgents = firestoreStats.isLive ? firestoreStats.offlineAgents : (apiStats?.offlineAgents ?? 0);
  const activeMonitoring = firestoreStats.isLive ? firestoreStats.activeMonitoring : (apiStats?.activeMonitoring ?? 0);
  const securityEvents = apiStats?.securityEvents ?? 0;

  const statCards = [
    { label: 'Online agents',     value: onlineAgents,     tone: 'success' },
    { label: 'Offline agents',    value: offlineAgents,    tone: 'warning' },
    { label: 'Active monitoring', value: activeMonitoring, tone: 'info' },
    { label: 'Security events',   value: securityEvents,   tone: securityEvents > 0 ? 'danger' : 'muted' },
  ];

  function formatDuration(seconds?: number): string {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function formatTime(iso?: string): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  }

  return (
    <AppLayout>
      {/* ── Stat cards ── */}
      <section className="stats-grid">
        {statCards.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="stat-label">
              {stat.label}
              {firestoreStats.isLive && (stat.label !== 'Security events') && (
                <span
                  className="live-badge"
                  title="Updates in real time via Firestore"
                  aria-label="Live"
                >
                  LIVE
                </span>
              )}
            </div>
            <div className={`stat-value ${stat.tone}`}>
              {loading && !firestoreStats.isLive ? '…' : stat.value}
            </div>
          </div>
        ))}
      </section>

      {error && (
        <div className="error-banner" role="alert">
          {error} — showing cached data.
        </div>
      )}

      <section className="content-grid">
        {/* ── Recent sessions ── */}
        <div className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Workforce</p>
              <h2>Recent monitoring sessions</h2>
            </div>
          </div>

          <div className="table-wrap mini-table">
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
                {loading && recentSessions.length === 0 ? (
                  <tr><td colSpan={7} className="muted">Loading…</td></tr>
                ) : recentSessions.length === 0 ? (
                  <tr><td colSpan={7} className="muted">No recent sessions</td></tr>
                ) : recentSessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.agentName ?? s.agentEmail ?? s.agentId}</td>
                    <td>{s.deviceName ?? s.deviceId}</td>
                    <td>{s.managerEmail ?? s.managerId}</td>
                    <td>{formatTime(s.startedAt ?? s.requestedAt)}</td>
                    <td>{formatDuration(s.sessionDurationSeconds)}</td>
                    <td>
                      <span className={`status-pill ${s.status.toLowerCase()}`}>
                        {s.status}
                      </span>
                    </td>
                    <td>
                      <a className="link-btn" href={`/monitor/${s.id}`}>View</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Security events sidebar ── */}
        <aside className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Threat watch</p>
              <h2>Recent security events</h2>
            </div>
          </div>

          <div className="activity-list">
            {securityEvents === 0 ? (
              <div className="muted" style={{ padding: '1rem' }}>
                No security events in the last 24 hours
              </div>
            ) : (
              <div className="muted" style={{ padding: '1rem' }}>
                {securityEvents} event{securityEvents !== 1 ? 's' : ''} in the last 24 hours
              </div>
            )}
          </div>
        </aside>
      </section>

      {/* ── Live agent roster ── */}
      <section className="panel margin-top">
        <div className="section-head">
          <div>
            <p className="eyebrow">Authorized agents</p>
            <h2>
              Live agent roster
              {firestoreStats.isLive && (
                <span className="live-badge" title="Device status updates in real time">
                  LIVE
                </span>
              )}
            </h2>
          </div>
        </div>

        <div className="agent-list">
          {loading && agents.length === 0 ? (
            <div className="muted">Loading agents…</div>
          ) : agents.length === 0 ? (
            <div className="muted">No agents assigned yet.</div>
          ) : agents.map((agent) => (
            <div className="agent-card" key={agent.id}>
              <div className="agent-top">
                <strong>{agent.displayName}</strong>
                <DeviceBadge
                  deviceId={agent.deviceId}
                  fallback={agent.deviceStatus}
                />
              </div>
              <div className="agent-details">
                <div>{agent.email}</div>
                {agent.departmentName && <div>Dept: {agent.departmentName}</div>}
                {agent.deviceName && <div>PC: {agent.deviceName}</div>}
                {agent.lastHeartbeatAt && (
                  <div>Last seen: {formatTime(agent.lastHeartbeatAt)}</div>
                )}
              </div>
              <div className="card-actions">
                <a className="primary-btn small-btn" href={`/agents/${agent.id}`}>View</a>
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppLayout>
  );
}
