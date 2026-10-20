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
import { getFirestore, type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from './logger';

let firebaseApp: App | null = null;
let db: Database | null = null;
let firestore: Firestore | null = null;
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
    firestore = getFirestore(firebaseApp);
    firebaseEnabled = true;

    logger.info({ projectId, databaseURL }, 'Firebase Admin SDK initialized (RTDB + Firestore)');
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

// ── Firestore: Device Status ──────────────────────────────────────────────────

export interface FirestoreDeviceStatus {
  deviceId: string;
  agentUserId: string;
  status: 'ONLINE' | 'OFFLINE' | 'DISABLED';
  hostname: string;
  lastHeartbeatAt: FirebaseFirestore.Timestamp | null;
  lastSeenIp: string | null;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * Write live device status to Firestore.
 * Path: deviceStatus/{deviceId}
 * Frontend reads this collection for real-time ONLINE/OFFLINE badges.
 */
export async function setFirestoreDeviceStatus(
  deviceId: string,
  agentUserId: string,
  status: 'ONLINE' | 'OFFLINE' | 'DISABLED',
  hostname: string,
  lastSeenIp: string | null,
): Promise<void> {
  if (!firebaseEnabled || !firestore) return;
  try {
    await firestore.collection('deviceStatus').doc(deviceId).set(
      {
        deviceId,
        agentUserId,
        status,
        hostname,
        lastSeenIp,
        lastHeartbeatAt: status === 'ONLINE' ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    logger.warn({ err, deviceId }, 'Firestore: failed to set device status');
  }
}

/**
 * Mark a device OFFLINE in Firestore.
 */
export async function setFirestoreDeviceOffline(deviceId: string): Promise<void> {
  if (!firebaseEnabled || !firestore) return;
  try {
    await firestore.collection('deviceStatus').doc(deviceId).set(
      {
        status: 'OFFLINE' as const,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    logger.warn({ err, deviceId }, 'Firestore: failed to mark device offline');
  }
}

// ── Firestore: Session Status ─────────────────────────────────────────────────

export type FirestoreSessionStatus = 'PENDING' | 'CONNECTING' | 'CONNECTED' | 'ENDED' | 'FAILED';

export interface FirestoreSessionDoc {
  sessionId: string;
  managerId: string;
  agentId: string;
  deviceId: string;
  status: FirestoreSessionStatus;
  requestedAt: FirebaseFirestore.Timestamp;
  startedAt: FirebaseFirestore.Timestamp | null;
  endedAt: FirebaseFirestore.Timestamp | null;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * Create or update a session document in Firestore.
 * Path: sessionStatus/{sessionId}
 */
export async function setFirestoreSessionStatus(
  sessionId: string,
  data: {
    managerId: string;
    agentId: string;
    deviceId: string;
    status: FirestoreSessionStatus;
    requestedAt?: Date;
    startedAt?: Date | null;
    endedAt?: Date | null;
  },
): Promise<void> {
  if (!firebaseEnabled || !firestore) return;
  try {
    const payload: Record<string, unknown> = {
      sessionId,
      managerId: data.managerId,
      agentId: data.agentId,
      deviceId: data.deviceId,
      status: data.status,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data.requestedAt) payload['requestedAt'] = data.requestedAt;
    if (data.startedAt !== undefined) payload['startedAt'] = data.startedAt ?? null;
    if (data.endedAt !== undefined) payload['endedAt'] = data.endedAt ?? null;

    await firestore.collection('sessionStatus').doc(sessionId).set(payload, { merge: true });
  } catch (err) {
    logger.warn({ err, sessionId }, 'Firestore: failed to update session status');
  }
}

/**
 * Mark a session as ended in Firestore.
 */
export async function setFirestoreSessionEnded(
  sessionId: string,
  endedAt: Date,
): Promise<void> {
  if (!firebaseEnabled || !firestore) return;
  try {
    await firestore.collection('sessionStatus').doc(sessionId).set(
      { status: 'ENDED' as const, endedAt, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    logger.warn({ err, sessionId }, 'Firestore: failed to mark session ended');
  }
}

// ── Firestore: Dashboard Stats ────────────────────────────────────────────────

export interface FirestoreDashboardStats {
  managerId: string;
  onlineAgents: number;
  offlineAgents: number;
  activeMonitoring: number;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * Write dashboard stats for a specific manager to Firestore.
 * Path: dashboardStats/{managerId}
 *
 * Called after session start/end and device heartbeat events.
 * The frontend subscribes to this document for live stat updates.
 */
export async function setFirestoreDashboardStats(
  managerId: string,
  stats: { onlineAgents: number; offlineAgents: number; activeMonitoring: number },
): Promise<void> {
  if (!firebaseEnabled || !firestore) return;
  try {
    await firestore.collection('dashboardStats').doc(managerId).set(
      {
        managerId,
        ...stats,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    logger.warn({ err, managerId }, 'Firestore: failed to update dashboard stats');
  }
}

export { firestore };

// ── Firebase Custom Tokens ────────────────────────────────────────────────────

/**
 * Issue a Firebase Custom Token for an authenticated backend user.
 *
 * The token's UID is set to the user's PostgreSQL user ID so that
 * Firestore Security Rules can enforce per-manager document access via
 * `request.auth.uid == managerId`.
 *
 * SECURITY:
 * - Called only from an authenticated backend route (JWT verified first)
 * - Uses the Admin SDK — never exposed to unauthenticated callers
 * - Custom tokens expire after 1 hour (Firebase default, non-configurable)
 * - The token grants only Firestore read access as defined by security rules
 *
 * @param userId  The PostgreSQL user UUID (becomes the Firebase UID)
 * @param role    Included as a custom claim for potential future rule use
 * @returns       A signed Firebase custom token string, or null if Firebase is disabled
 */
export async function getFirebaseCustomToken(
  userId: string,
  role: string,
): Promise<string | null> {
  if (!firebaseEnabled || !firebaseApp) return null;
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const adminAuth = getAuth(firebaseApp);
    const token = await adminAuth.createCustomToken(userId, { role });
    return token;
  } catch (err) {
    logger.warn({ err, userId }, 'Firebase: failed to create custom token');
    return null;
  }
}

