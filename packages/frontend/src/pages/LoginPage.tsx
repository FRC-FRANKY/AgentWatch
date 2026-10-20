import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, MoonStar, ShieldCheck, SunMedium } from 'lucide-react';
import { useAuthStore } from '../app/store/authStore';
import { login, verifyMfa } from '../services/api';
import { AgentWatchLogo } from '../components/brand';
import { initFirestore } from '../services/firestore';

export function LoginPage() {
  const navigate = useNavigate();
  const { setSession, isAuthenticated } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [pendingMfaToken, setPendingMfaToken] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('agentwatch-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  // Redirect already-authenticated users away from login
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('agentwatch-theme', theme);
  }, [theme]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (pendingMfaToken) {
        const result = await verifyMfa(pendingMfaToken, mfaCode.trim());
        // After MFA, fetch the actual role from /auth/me
        localStorage.setItem('agentwatch_access_token', result.accessToken);
        const { apiClient } = await import('../services/api/index');
        let role = 'MANAGER';
        let displayName = email;
        try {
          const { data } = await apiClient.get<{ role: string; displayName: string; email: string }>(
            '/auth/me',
          );
          role = data.role;
          displayName = data.displayName ?? data.email;
        } catch {
          // Non-critical — keep defaults
        }
        setSession({
          email,
          displayName,
          accessToken: result.accessToken,
          expiresIn: result.expiresIn,
          role,
        });
        // Re-init Firebase with a custom token so Firestore rules use the correct UID
        void (async () => {
          const { authApi } = await import('../services/api/index');
          const firebaseToken = await authApi.getFirebaseToken();
          void initFirestore(firebaseToken);
        })();
        navigate('/dashboard', { replace: true });
        return;
      }

      const result = await login(email, password);

      if (result.requiresMfa) {
        setPendingMfaToken(result.partialToken ?? null);
        setError('');
        return;
      }

      // Successful login — use role returned by the server
      const serverRole = result.role ?? 'MANAGER';
      const serverDisplayName = result.displayName ?? email;

      setSession({
        email,
        displayName: serverDisplayName,
        accessToken: result.accessToken!,
        expiresIn: result.expiresIn,
        role: serverRole,
      });
      // Re-init Firebase with a custom token so Firestore rules use the correct UID
      void (async () => {
        const { authApi } = await import('../services/api/index');
        const firebaseToken = await authApi.getFirebaseToken();
        void initFirestore(firebaseToken);
      })();
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      // Provide a helpful message when the backend server is unreachable.
      const isNetworkError =
        err instanceof Error &&
        (err.message.includes('ERR_CONNECTION_REFUSED') ||
          err.message.includes('Network Error') ||
          err.message.includes('ECONNREFUSED') ||
          (err as { code?: string }).code === 'ERR_NETWORK');

      if (isNetworkError) {
        setError(
          'Cannot reach the AgentWatch server. Make sure the backend is running on http://localhost:4000.',
        );
      } else {
        const message = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell" style={{ position: 'relative' }}>
      <div className="login-theme-toggle">
        <button
          type="button"
          className="icon-button"
          aria-label="Toggle theme"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? <SunMedium size={18} /> : <MoonStar size={18} />}
        </button>
      </div>

      <div className="login-card">
        <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center' }}>
          <AgentWatchLogo size="lg" showTagline variant="auto" glow />
        </div>
        <h1>Secure sign in</h1>
        <p className="notice">
          Transparent, role-based workstation monitoring for authorized company use only.
        </p>

        <form className="form-grid" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              disabled={!!pendingMfaToken}
              autoComplete="username"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                disabled={!!pendingMfaToken}
                autoComplete="current-password"
                style={{ paddingRight: '42px' }}
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((current) => !current)}
                disabled={!!pendingMfaToken}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted, #6b7280)',
                  cursor: !!pendingMfaToken ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {pendingMfaToken && (
            <div className="field">
              <label htmlFor="mfaCode">MFA code</label>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                Enter the 6-digit code from your authenticator app.
              </p>
              <input
                id="mfaCode"
                type="text"
                inputMode="numeric"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                autoComplete="one-time-code"
                autoFocus
              />
            </div>
          )}

          {error && <div className="notice" style={{ color: 'var(--red, #b91c1c)' }}>{error}</div>}

          <button type="submit" className="primary-btn" disabled={loading}>
            {loading
              ? 'Signing in...'
              : pendingMfaToken
                ? 'Verify MFA'
                : 'Sign in'}
          </button>

          {pendingMfaToken && (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                setPendingMfaToken(null);
                setMfaCode('');
                setError('');
              }}
            >
              ← Back to password
            </button>
          )}
        </form>

        <div className="login-trust-badges">
          <span className="trust-badge-item"><ShieldCheck size={14} /> Secure</span>
          <span className="trust-dot">•</span>
          <span className="trust-badge-item">Reliable</span>
          <span className="trust-dot">•</span>
          <span className="trust-badge-item">Enterprise Ready</span>
        </div>
      </div>
    </div>
  );
}
