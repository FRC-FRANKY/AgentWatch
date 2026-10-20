/**
 * hooks/useFirestoreSessionStatus.ts
 *
 * React hook that subscribes to live session lifecycle state from Firestore.
 * Used by the monitoring view to show real-time PENDING → CONNECTED → ENDED.
 */

import { useState, useEffect } from 'react';
import {
  subscribeToFirestoreSessionStatus,
  type FirestoreSessionStatus,
  type FirestoreSessionLifecycle,
} from '../services/firestore';

export interface UseFirestoreSessionStatusResult {
  status: FirestoreSessionLifecycle | null;
  startedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date | null;
  isLive: boolean;
}

/**
 * Subscribe to a monitoring session's live status from Firestore.
 *
 * @param sessionId - The PostgreSQL session UUID (or undefined if no active session)
 */
export function useFirestoreSessionStatus(
  sessionId: string | undefined,
): UseFirestoreSessionStatusResult {
  const [data, setData] = useState<FirestoreSessionStatus | null>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setData(null);
      setIsLive(false);
      return;
    }

    const unsub = subscribeToFirestoreSessionStatus(sessionId, (result) => {
      setData(result);
      setIsLive(true);
    });

    return unsub;
  }, [sessionId]);

  return {
    status: data?.status ?? null,
    startedAt: data?.startedAt ?? null,
    endedAt: data?.endedAt ?? null,
    updatedAt: data?.updatedAt ?? null,
    isLive,
  };
}
