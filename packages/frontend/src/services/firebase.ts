/**
 * services/firebase.ts — Firebase Client SDK (Read-Only)
 *
 * The frontend uses Firebase Realtime Database for real-time state only:
 *   - Device presence (ONLINE/OFFLINE)
 *   - Active monitoring session status
 *
 * SECURITY:
 * - Uses the PUBLIC Firebase client config (not admin credentials)
 * - Frontend has READ-ONLY access (security rules deny all client writes)
 * - Firebase Authentication is required for all reads
 * - Backend (Admin SDK) is the only writer
 *
 * Firebase client config keys are NOT secrets — they are designed to be
 * public. Access control is enforced by Firebase Security Rules on the server.
 *
 * If VITE_FIREBASE_* env vars are not set, Firebase is disabled gracefully
 * and the frontend falls back to polling.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  onValue,
  off,
  type Database,
  type Unsubscribe,
} from 'firebase/database';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  type Auth,
} from 'firebase/auth';

// ── Config ─────────────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            import.meta.env['VITE_FIREBASE_API_KEY'],
  authDomain:        import.meta.env['VITE_FIREBASE_AUTH_DOMAIN'],
  databaseURL:       import.meta.env['VITE_FIREBASE_DATABASE_URL'],
  projectId:         import.meta.env['VITE_FIREBASE_PROJECT_ID'],
  storageBucket:     import.meta.env['VITE_FIREBASE_STORAGE_BUCKET'],
  messagingSenderId: import.meta.env['VITE_FIREBASE_MESSAGING_SENDER_ID'],
  appId:             import.meta.env['VITE_FIREBASE_APP_ID'],
};

let app: FirebaseApp | null = null;
let database: Database | null = null;
let auth: Auth | null = null;
let firebaseEnabled = false;

/**
 * Initialize Firebase client SDK.
 * Called once at app startup. Degrades gracefully if config is missing.
 */
export async function initFirebaseClient(firebaseCustomToken?: string | null): Promise<void> {
  if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
    console.warn(
      '[Firebase] Client config not set. Real-time updates disabled. ' +
      'Set VITE_FIREBASE_* environment variables to enable.',
    );
    firebaseEnabled = false;
    return;
  }

  try {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    auth = getAuth(app);

    if (firebaseCustomToken) {
      // Sign in with the backend-issued custom token so that
      // auth.uid == PostgreSQL user ID — Firestore rules enforce per-manager access.
      await signInWithCustomToken(auth, firebaseCustomToken);
      console.info('[Firebase] Client initialized with custom token (per-manager Firestore access)');
    } else {
      // Fallback: anonymous auth — allows deviceStatus reads (rule: auth != null)
      // sessionStatus and dashboardStats reads will be denied until a custom token is provided.
      await signInAnonymously(auth);
      console.info('[Firebase] Client initialized with anonymous auth (limited Firestore access)');
    }

    firebaseEnabled = true;
  } catch (err) {
    console.warn('[Firebase] Client initialization failed — falling back to polling', err);
    firebaseEnabled = false;
  }
}

export function isFirebaseClientEnabled(): boolean {
  return firebaseEnabled;
}

// ── Device Presence ────────────────────────────────────────────────────────────

export interface DevicePresence {
  online: boolean;
  agentUserId: string;
  lastSeen: number;
  sessionId: string | null;
}

/**
 * Subscribe to real-time device presence updates.
 * Returns an unsubscribe function.
 */
export function subscribeToDevicePresence(
  deviceId: string,
  callback: (presence: DevicePresence | null) => void,
): Unsubscribe {
  if (!firebaseEnabled || !database) {
    return () => { /* no-op */ };
  }

  const presenceRef = ref(database, `presence/${deviceId}`);

  const listener = onValue(presenceRef, (snapshot) => {
    callback(snapshot.exists() ? (snapshot.val() as DevicePresence) : null);
  }, (err) => {
    console.warn(`[Firebase] Presence subscription error for ${deviceId}:`, err);
    callback(null);
  });

  return () => off(presenceRef, 'value', listener);
}

// ── Monitoring Sessions ───────────────────────────────────────────────────────

export type FirebaseSessionStatus =
  | 'PENDING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ENDED'
  | 'FAILED';

export interface FirebaseSessionState {
  status: FirebaseSessionStatus;
  managerId: string;
  agentId: string;
  deviceId: string;
  requestedAt: number;
  startedAt: number | null;
  lastHeartbeatAt: number | null;
  endedAt: number | null;
}

/**
 * Subscribe to real-time monitoring session state.
 * Returns an unsubscribe function.
 */
export function subscribeToSession(
  sessionId: string,
  callback: (state: FirebaseSessionState | null) => void,
): Unsubscribe {
  if (!firebaseEnabled || !database) {
    return () => { /* no-op */ };
  }

  const sessionRef = ref(database, `sessions/${sessionId}`);

  const listener = onValue(sessionRef, (snapshot) => {
    callback(snapshot.exists() ? (snapshot.val() as FirebaseSessionState) : null);
  }, (err) => {
    console.warn(`[Firebase] Session subscription error for ${sessionId}:`, err);
    callback(null);
  });

  return () => off(sessionRef, 'value', listener);
}
