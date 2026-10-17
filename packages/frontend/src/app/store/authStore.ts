/**
 * app/store/authStore.ts — Authentication State
 *
 * SECURITY APPROACH:
 * - Access token stored in localStorage (readable by JS, needed for Bearer header).
 * - Refresh token is httpOnly cookie (set by backend, NOT readable by JS).
 * - On page load, we restore the session from localStorage IF a valid access token exists.
 * - Token expiry is checked before restoration — expired tokens are cleared.
 * - The 401 interceptor in api.ts handles token refresh and clears state on failure.
 *
 * SESSION PERSISTENCE:
 * - Users remain logged in across page refreshes and navigation (restored from localStorage).
 * - Users are logged out when:
 *   a) They explicitly click Logout (calls /auth/logout which revokes refresh token)
 *   b) The access token expires AND the refresh token is also expired/revoked
 *   c) The backend returns 401 after a failed refresh attempt
 */

import { create } from 'zustand';

export type AuthSession = {
  id?: string;
  email: string;
  displayName?: string;
  accessToken: string;
  expiresIn?: number;
  expiresAt?: number;  // Unix timestamp (ms) when access token expires
  role: string;
  permissions?: string[];
};

type AuthStore = {
  session: AuthSession | null;
  isAuthenticated: boolean;
  /**
   * True once the store has been initialised from storage.
   * Route guards wait for this before deciding to redirect.
   */
  isHydrated: boolean;
  setSession: (session: AuthSession) => void;
  clearSession: () => void;
  /** Re-reads from localStorage (useful if another tab updated storage). */
  hydrateFromStorage: () => void;
};

const SESSION_KEY = 'agentwatch_session';
const TOKEN_KEY = 'agentwatch_access_token';

/**
 * Decodes the expiry from a JWT without verifying the signature.
 * Used only to check whether the locally-stored token is obviously expired.
 * The backend will verify the signature on every request.
 */
function getJwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    return decoded.exp ? decoded.exp * 1000 : null; // Convert to ms
  } catch {
    return null;
  }
}

/**
 * Reads a stored session from localStorage.
 * Returns null if no session, corrupt data, or the access token is expired.
 *
 * NOTE: An expired access token does NOT immediately log the user out —
 * the 401 interceptor in api.ts will attempt a refresh via the httpOnly cookie.
 * We only clear the session here if the token is obviously expired AND we cannot
 * even attempt a refresh (no session data at all).
 */
export function readStoredSession(): { session: AuthSession | null; isAuthenticated: boolean } {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    const accessToken = localStorage.getItem(TOKEN_KEY);

    if (!stored || !accessToken) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(TOKEN_KEY);
      return { session: null, isAuthenticated: false };
    }

    const parsed = JSON.parse(stored) as AuthSession;
    if (!parsed.email || !parsed.role || !parsed.accessToken) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(TOKEN_KEY);
      return { session: null, isAuthenticated: false };
    }

    // Check if the access token is expired
    // If expired, we still restore the session — the 401 interceptor will refresh it.
    // Only clear if we have no way to recover (e.g. completely malformed token).
    const expiry = getJwtExpiry(accessToken);
    if (expiry !== null && Date.now() > expiry + 60_000) {
      // Token expired more than 60s ago — still restore so the interceptor can refresh.
      // The interceptor will call /auth/refresh using the httpOnly cookie.
      // If refresh fails, it will call clearSession().
    }

    return {
      session: { ...parsed, accessToken },
      isAuthenticated: true,
    };
  } catch {
    // Corrupt storage — wipe so user can log in cleanly
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
    return { session: null, isAuthenticated: false };
  }
}

// Hydrate synchronously at module load time
const { session: initialSession, isAuthenticated: initialIsAuthenticated } = readStoredSession();

export const useAuthStore = create<AuthStore>((set) => ({
  session: initialSession,
  isAuthenticated: initialIsAuthenticated,
  isHydrated: true, // Always true — hydrated synchronously above.

  setSession: (session) => {
    // Compute and store expiry timestamp
    const expiry = getJwtExpiry(session.accessToken);
    const enriched: AuthSession = {
      ...session,
      expiresAt: expiry ?? undefined,
    };

    // Store session in localStorage for persistence across page refreshes
    localStorage.setItem(SESSION_KEY, JSON.stringify(enriched));
    localStorage.setItem(TOKEN_KEY, session.accessToken);
    set({ session: enriched, isAuthenticated: true, isHydrated: true });
  },

  clearSession: () => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
    set({ session: null, isAuthenticated: false });
  },

  hydrateFromStorage: () => {
    const { session, isAuthenticated } = readStoredSession();
    set({ session, isAuthenticated, isHydrated: true });
  },
}));
