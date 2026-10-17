/**
 * config/firebase.ts — Firebase Admin SDK Integration
 *
 * ARCHITECTURE (Option B):
 * Backend uses Firebase Admin SDK to write real-time state:
 *   - Device presence (ONLINE/OFFLINE)
 *   - Monitoring session status (PENDING/CONNECTING/CONNECTED/ENDED)
 *
 * The frontend reads from Firebase RTDB directly using the client SDK
 * (read-only, restricted by security rules).
 *
 * SECURITY:
 * - Firebase credentials are loaded from environment variables ONLY
 * - Service account JSON is NEVER committed to the repository
 * - The agent client NEVER receives Firebase credentials
 * - Frontend uses read-only Firebase client config (not admin credentials)
 *
 * GRACEFUL DEGRADATION:
 * - If Firebase is not configured, all firebase.* calls are no-ops
 * - The system continues to work using PostgreSQL + polling
 * - A warning is logged at startup but the app does not crash
 */

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getDatabase, type Database, ServerValue } from 'firebase-admin/database';
import { logger } from './logger';

let firebaseApp: App | null = null;
let db: Database | null = null;
let firebaseEnabled = false;

/**
 * Initialize Firebase Admin SDK.
 * Called once at application startup.
 * If credentials are not configured, Firebase is disabled gracefully.
 */
export function initFirebase(): void {
  const projectId    = process.env['FIREBASE_PROJECT_ID'];
  const clientEmail  = process.env['FIREBASE_CLIENT_EMAIL'];
  const privateKey   = process.env['FIREBASE_PRIVATE_KEY']?.replace(/\\n/g, '\n');
  const databaseURL  = process.env['FIREBASE_DATABASE_URL'];

  if (!projectId || !clientEmail || !privateKey || !databaseURL) {
    logger.warn(
      'Firebase credentials not configured — real-time presence/session state disabled. ' +
      'Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL ' +
      'to enable Firebase integration.',
    );
    firebaseEnabled = false;
    return;
  }

  try {
    // Avoid double-initialization (e.g. hot reload)
    if (!getApps().length) {
      firebaseApp = initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
        databaseURL,
      });
    } else {
      firebaseApp = getApps()[0]!;
    }

    db = getDatabase(firebaseApp);
    firebaseEnabled = true;

    logger.info({ projectId, databaseURL }, 'Firebase Admin SDK initialized');
  } catch (err) {
    logger.error({ err }, 'Firebase initialization failed — running without real-time Firebase');
    firebaseEnabled = false;
  }
}

export function isFirebaseEnabled(): boolean {
  return firebaseEnabled;
}

// ── Presence ──────────────────────────────────────────────────────────────────

export interface DevicePresence {
  online: boolean;
  agentUserId: string;
  lastSeen: number | object;   // ServerValue.TIMESTAMP on write
  sessionId: string | null;
}

/**
 * Write device presence to Firebase RTDB.
 * Path: /presence/{deviceId}
 */
export async function setDevicePresence(
  deviceId: string,
  presence: Omit<DevicePresence, 'lastSeen'> & { lastSeen?: number },
): Promise<void> {
  if (!firebaseEnabled || !db) return;
  try {
    await db.ref(`presence/${deviceId}`).set({
      ...presence,
      lastSeen: ServerValue.TIMESTAMP,
    });
  } catch (err) {
    // Non-critical — log and continue. PostgreSQL remains the source of truth.
    logger.warn({ err, deviceId }, 'Firebase: failed to set device presence');
  }
}

/**
 * Mark a device as offline.
 */
export async function setDeviceOffline(deviceId: string): Promise<void> {
  if (!firebaseEnabled || !db) return;
  try {
    await db.ref(`presence/${deviceId}`).update({
      online: false,
      lastSeen: ServerValue.TIMESTAMP,
      sessionId: null,
    });
  } catch (err) {
    logger.warn({ err, deviceId }, 'Firebase: failed to mark device offline');
  }
}

// ── Monitoring Sessions ───────────────────────────────────────────────────────

export type FirebaseSessionStatus =
  | 'PENDING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ENDED'
  | 'FAILED';

export interface FirebaseSession {
  status: FirebaseSessionStatus;
  managerId: string;
  agentId: string;
  deviceId: string;
  requestedAt: number;
  startedAt: number | null;
  lastHeartbeatAt: number | object | null;
  endedAt: number | null;
}

/**
 * Create or update a monitoring session in Firebase RTDB.
 * Path: /sessions/{sessionId}
 */
export async function setSessionState(
  sessionId: string,
  state: Partial<FirebaseSession>,
): Promise<void> {
  if (!firebaseEnabled || !db) return;
  try {
    await db.ref(`sessions/${sessionId}`).update({
      ...state,
      lastHeartbeatAt: ServerValue.TIMESTAMP,
    });
  } catch (err) {
    logger.warn({ err, sessionId }, 'Firebase: failed to update session state');
  }
}

/**
 * Delete a session from Firebase RTDB when it ends.
 * Ended sessions remain in PostgreSQL; Firebase only holds active state.
 */
export async function deleteSessionState(sessionId: string): Promise<void> {
  if (!firebaseEnabled || !db) return;
  try {
    await db.ref(`sessions/${sessionId}`).remove();
  } catch (err) {
    logger.warn({ err, sessionId }, 'Firebase: failed to delete session state');
  }
}

export { db };
