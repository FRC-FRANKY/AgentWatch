/**
 * services/firestore.ts — Firestore Client SDK (Real-time subscriptions)
 *
 * This module provides typed Firestore subscriptions for three live features:
 *   1. Device status badges (ONLINE/OFFLINE)
 *   2. Session lifecycle state (PENDING → CONNECTED → ENDED)
 *   3. Dashboard stats (online agents, active monitoring)
 *
 * SECURITY:
 * - Uses the same public Firebase client config as firebase.ts (not admin credentials)
 * - Firestore Security Rules restrict reads to authenticated users only
 * - If VITE_FIREBASE_* env vars are not set, all subscriptions are no-ops
 *   and the frontend falls back to the existing polling behaviour
 *
 * INITIALIZATION:
 * - Reuses the FirebaseApp instance from firebase.ts (avoids duplicate-app error)
 * - Firestore is initialized lazily on first subscription
 */

import {
  getFirestore,
  doc,
  onSnapshot,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { getApp, getApps } from 'firebase/app';
import { initFirebaseClient, isFirebaseClientEnabled } from './firebase';

// ── Singleton ──────────────────────────────────────────────────────────────────

let _firestore: Firestore | null = null;

function getFirestoreInstance(): Firestore | null {
  if (!isFirebaseClientEnabled()) return null;
  if (_firestore) return _firestore;

  try {
    if (getApps().length === 0) return null;
    _firestore = getFirestore(getApp());
    return _firestore;
  } catch {
    return null;
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

let _initialized = false;

/**
 * Initialize Firebase (including Firestore) from the app entry-point.
 * Safe to call multiple times — idempotent.
 *
 * @param firebaseCustomToken  Backend-issued custom token (UID = PostgreSQL user ID).
 *   Pass this after login so Firestore security rules enforce per-manager access.
 *   If omitted, falls back to anonymous auth (deviceStatus reads only).
 */
export async function initFirestore(firebaseCustomToken?: string | null): Promise<void> {
  if (_initialized) {
    // If re-initializing with a custom token (post-login), we need to re-auth.
    // Reset the flag so re-authentication can occur.
    if (firebaseCustomToken) {
      _initialized = false;
    } else {
      return;
    }
  }
  _initialized = true;
  await initFirebaseClient(firebaseCustomToken);
}

// ── Device Status ──────────────────────────────────────────────────────────────

export type DeviceOnlineStatus = 'ONLINE' | 'OFFLINE' | 'DISABLED' | 'UNKNOWN';

export interface FirestoreDeviceStatus {
  deviceId: string;
  agentUserId: string;
  status: DeviceOnlineStatus;
  hostname: string;
  lastHeartbeatAt: Date | null;
  lastSeenIp: string | null;
  updatedAt: Date | null;
}

/**
 * Subscribe to live device status from Firestore.
 * Returns an unsubscribe function.
 *
 * Collection: deviceStatus/{deviceId}
 */
export function subscribeToFirestoreDeviceStatus(
  deviceId: string,
  callback: (status: FirestoreDeviceStatus | null) => void,
): Unsubscribe {
  const db = getFirestoreInstance();
  if (!db) return () => { /* no-op: Firebase not configured */ };

  const ref = doc(db, 'deviceStatus', deviceId);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      const data = snap.data();
      callback({
        deviceId: data['deviceId'] as string,
        agentUserId: data['agentUserId'] as string,
        status: (data['status'] as DeviceOnlineStatus) ?? 'UNKNOWN',
        hostname: (data['hostname'] as string) ?? '',
        lastHeartbeatAt: data['lastHeartbeatAt']?.toDate?.() ?? null,
        lastSeenIp: (data['lastSeenIp'] as string | null) ?? null,
        updatedAt: data['updatedAt']?.toDate?.() ?? null,
      });
    },
    (err) => {
      console.warn(`[Firestore] deviceStatus/${deviceId} error:`, err);
      callback(null);
    },
  );
}

// ── Session Status ─────────────────────────────────────────────────────────────

export type FirestoreSessionLifecycle =
  | 'PENDING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ENDED'
  | 'FAILED';

export interface FirestoreSessionStatus {
  sessionId: string;
  managerId: string;
  agentId: string;
  deviceId: string;
  status: FirestoreSessionLifecycle;
  requestedAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date | null;
}

/**
 * Subscribe to live session status from Firestore.
 * Returns an unsubscribe function.
 *
 * Collection: sessionStatus/{sessionId}
 */
export function subscribeToFirestoreSessionStatus(
  sessionId: string,
  callback: (status: FirestoreSessionStatus | null) => void,
): Unsubscribe {
  const db = getFirestoreInstance();
  if (!db) return () => { /* no-op */ };

  const ref = doc(db, 'sessionStatus', sessionId);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      const data = snap.data();
      callback({
        sessionId: data['sessionId'] as string,
        managerId: data['managerId'] as string,
        agentId: data['agentId'] as string,
        deviceId: data['deviceId'] as string,
        status: (data['status'] as FirestoreSessionLifecycle) ?? 'PENDING',
        requestedAt: data['requestedAt']?.toDate?.() ?? null,
        startedAt: data['startedAt']?.toDate?.() ?? null,
        endedAt: data['endedAt']?.toDate?.() ?? null,
        updatedAt: data['updatedAt']?.toDate?.() ?? null,
      });
    },
    (err) => {
      console.warn(`[Firestore] sessionStatus/${sessionId} error:`, err);
      callback(null);
    },
  );
}

// ── Dashboard Stats ────────────────────────────────────────────────────────────

export interface FirestoreDashboardStats {
  managerId: string;
  onlineAgents: number;
  offlineAgents: number;
  activeMonitoring: number;
  updatedAt: Date | null;
}

/**
 * Subscribe to live dashboard stats for a manager from Firestore.
 * Returns an unsubscribe function.
 *
 * Collection: dashboardStats/{managerId}
 */
export function subscribeToFirestoreDashboardStats(
  managerId: string,
  callback: (stats: FirestoreDashboardStats | null) => void,
): Unsubscribe {
  const db = getFirestoreInstance();
  if (!db) return () => { /* no-op */ };

  const ref = doc(db, 'dashboardStats', managerId);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      const data = snap.data();
      callback({
        managerId: data['managerId'] as string,
        onlineAgents: (data['onlineAgents'] as number) ?? 0,
        offlineAgents: (data['offlineAgents'] as number) ?? 0,
        activeMonitoring: (data['activeMonitoring'] as number) ?? 0,
        updatedAt: data['updatedAt']?.toDate?.() ?? null,
      });
    },
    (err) => {
      console.warn(`[Firestore] dashboardStats/${managerId} error:`, err);
      callback(null);
    },
  );
}
