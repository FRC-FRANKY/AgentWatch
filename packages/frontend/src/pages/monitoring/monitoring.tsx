/**
 * pages/monitoring/monitoring.tsx — Real WebRTC Monitoring View (Manager)
 *
 * This page establishes a real WebRTC connection to the agent client
 * and displays the actual agent screen stream.
 *
 * Connection flow:
 *  1. Load session data from backend (GET /api/sessions/:id)
 *  2. Connect WebSocket → AUTH
 *  3. Wait for agent offer → answer → ICE → connected
 *  4. Display remote MediaStream in <video> element
 *  5. Stop monitoring → END_SESSION signal → session ENDED in DB + Firebase
 *
 * STATES:
 *  idle → connecting → waiting_for_agent → negotiating → connected
 *  connected → disconnected / failed / ended
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '../../components/AppLayout';
import { useWebRTCMonitor, type ConnectionStatus } from '../../hooks/useWebRTCMonitor';
import { sessionsApi } from '../../services/api';
import type { Session } from '../../services/api';
import { useAuthStore } from '../../app/store/authStore';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return '—';
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { label: string; color: string }> = {
    idle:             { label: 'Idle',                color: '#6b7280' },
    connecting:       { label: 'Connecting…',         color: '#f59e0b' },
    waiting_for_agent:{ label: 'Waiting for Agent…',  color: '#3b82f6' },
    negotiating:      { label: 'Negotiating…',        color: '#8b5cf6' },
    connected:        { label: 'Connected',           color: '#10b981' },
    disconnected:     { label: 'Disconnected',        color: '#ef4444' },
    failed:           { label: 'Connection Failed',   color: '#dc2626' },
    ended:            { label: 'Session Ended',       color: '#6b7280' },
  };
  const { label, color } = config[status];

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 12px', borderRadius: '999px',
      background: `${color}22`, color,
      fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.02em',
    }}>
      {status === 'connected' && (
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color,
          animation: 'pulse 1.5s infinite',
        }} />
      )}
      {label}
    </span>
  );
}

// ── Extended Session type with WebRTC token ───────────────────────────────────

interface SessionWithToken extends Session {
  webrtcToken?: string;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function MonitoringPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { session: authSession } = useAuthStore();

  const [sessionData, setSessionData] = useState<SessionWithToken | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [duration, setDuration] = useState('—');

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Load session data from backend ────────────────────────────────────────

  useEffect(() => {
    if (!sessionId) return;
    sessionsApi.get(sessionId)
      .then((s) => setSessionData(s as SessionWithToken))
      .catch((err: Error) => setLoadError(err.message));
  }, [sessionId]);

  // ── Establish WebRTC connection ────────────────────────────────────────────

  const { status, remoteStream, connectionError, disconnect } = useWebRTCMonitor({
    sessionId: sessionId ?? '',
    webrtcToken: sessionData?.webrtcToken ?? '',
    userJwt: authSession?.accessToken ?? '',
  });

  // ── Attach remote stream to video element ─────────────────────────────────

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // ── Live duration ticker ──────────────────────────────────────────────────

  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => {
      setDuration(formatDuration(sessionData?.startedAt ?? new Date().toISOString()));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, sessionData?.startedAt]);

  // ── Stop monitoring ───────────────────────────────────────────────────────

  const handleStop = useCallback(async () => {
    if (!confirm('Stop this monitoring session?')) return;
    disconnect();
    if (sessionId) {
      try { await sessionsApi.stop(sessionId); } catch { /* best effort */ }
    }
    navigate('/sessions');
  }, [disconnect, sessionId, navigate]);

  // ── Fullscreen ────────────────────────────────────────────────────────────

  const handleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      await el.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <AppLayout>
        <section className="monitor-panel">
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p>Unable to load session: {loadError}</p>
            <button className="secondary-btn" onClick={() => navigate(-1)} style={{ marginTop: '1rem' }}>
              Go Back
            </button>
          </div>
        </section>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        .monitor-video::-webkit-media-controls { display: none; }
      `}</style>

      <section className="monitor-panel">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="monitor-header">
          <div>
            <p className="eyebrow">Remote monitoring</p>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {sessionData?.deviceName ?? 'Session ' + (sessionId?.slice(0, 8) ?? '')}
              <StatusBadge status={status} />
            </h2>
            {sessionData?.agentEmail && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                Agent: {sessionData.agentEmail}
              </p>
            )}
          </div>
          <div className="monitor-actions">
            <div style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              <div>Session: <code style={{ fontFamily: 'monospace' }}>{sessionId?.slice(0, 8)}…</code></div>
              <div>Duration: <strong>{duration}</strong></div>
            </div>
            <button className="secondary-btn" onClick={handleFullscreen}>
              {isFullscreen ? 'Exit Fullscreen' : 'Full Screen'}
            </button>
            <button
              className="danger-btn"
              onClick={() => void handleStop()}
              disabled={status === 'ended'}
            >
              Stop Monitoring
            </button>
          </div>
        </div>

        {/* ── Video Frame ──────────────────────────────────────────────── */}
        <div ref={containerRef} className="screen-frame" style={{ position: 'relative' }}>

          {/* Real WebRTC video — srcObject is set via ref, not a static src */}
          <video
            ref={videoRef}
            className="monitor-video"
            autoPlay
            playsInline
            muted={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              background: '#000',
              display: status === 'connected' ? 'block' : 'none',
            }}
          />

          {/* Status overlay — shown when not yet connected */}
          {status !== 'connected' && (
            <div className="screen-placeholder" style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              minHeight: '400px',
            }}>
              {status === 'idle' || status === 'connecting' ? (
                <>
                  <div className="screen-badge">Establishing secure connection…</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    Authenticating with signaling server
                  </p>
                </>
              ) : status === 'waiting_for_agent' ? (
                <>
                  <div className="screen-badge" style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>
                    Waiting for agent to respond…
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    The monitoring request has been sent. The agent client must accept.
                  </p>
                </>
              ) : status === 'negotiating' ? (
                <>
                  <div className="screen-badge" style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>
                    Negotiating WebRTC connection…
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    Exchanging OFFER / ANSWER / ICE candidates
                  </p>
                </>
              ) : status === 'disconnected' ? (
                <>
                  <div className="screen-badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                    Agent disconnected
                  </div>
                  {connectionError && (
                    <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{connectionError}</p>
                  )}
                </>
              ) : status === 'failed' ? (
                <>
                  <div className="screen-badge" style={{ background: 'rgba(220,38,38,0.15)', color: '#dc2626' }}>
                    Connection failed
                  </div>
                  {connectionError && (
                    <p style={{ color: '#dc2626', fontSize: '0.875rem', textAlign: 'center', maxWidth: '400px' }}>
                      {connectionError}
                    </p>
                  )}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    Check STUN/TURN configuration and agent connectivity.
                  </p>
                </>
              ) : status === 'ended' ? (
                <>
                  <div className="screen-badge" style={{ background: 'rgba(107,114,128,0.15)', color: '#6b7280' }}>
                    Session ended
                  </div>
                  <button className="secondary-btn" onClick={() => navigate('/sessions')}>
                    View Session History
                  </button>
                </>
              ) : null}
            </div>
          )}

          {/* Recording indicator — shown when actively connected */}
          {status === 'connected' && (
            <div style={{
              position: 'absolute', top: '1rem', right: '1rem',
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'rgba(0,0,0,0.6)', color: '#10b981',
              padding: '4px 10px', borderRadius: '6px',
              fontSize: '0.75rem', fontWeight: 600,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#10b981', animation: 'pulse 1.5s infinite',
              }} />
              LIVE
            </div>
          )}
        </div>

        {/* ── Session Info Bar ─────────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: '1.5rem', flexWrap: 'wrap',
          padding: '1rem 0', borderTop: '1px solid var(--border)',
          fontSize: '0.8rem', color: 'var(--text-muted)',
        }}>
          <span>Session started: <strong>{
            sessionData?.startedAt
              ? new Date(sessionData.startedAt).toLocaleTimeString()
              : '—'
          }</strong></span>
          <span>Manager: <strong>{sessionData?.managerEmail ?? '—'}</strong></span>
          <span>Device: <strong>{sessionData?.deviceName ?? '—'}</strong></span>
          {connectionError && status !== 'connected' && (
            <span style={{ color: '#ef4444', marginLeft: 'auto' }}>
              ⚠ {connectionError}
            </span>
          )}
        </div>
      </section>
    </AppLayout>
  );
}
