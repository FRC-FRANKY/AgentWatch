/**
 * hooks/useFirestoreDeviceStatus.ts
 *
 * React hook that subscribes to live device status from Firestore.
 * Falls back gracefully when Firebase is not configured.
 */

import { useState, useEffect } from 'react';
import {
  subscribeToFirestoreDeviceStatus,
  type FirestoreDeviceStatus,
  type DeviceOnlineStatus,
} from '../services/firestore';

export interface UseFirestoreDeviceStatusResult {
  status: DeviceOnlineStatus;
  lastHeartbeatAt: Date | null;
  isLive: boolean;  // true when connected to Firestore; false when Firebase is disabled
}

/**
 * Subscribe to a device's live ONLINE/OFFLINE status from Firestore.
 *
 * @param deviceId - The PostgreSQL device UUID
 * @param fallbackStatus - Status to show before the first Firestore update arrives
 */
export function useFirestoreDeviceStatus(
  deviceId: string | undefined,
  fallbackStatus: DeviceOnlineStatus = 'UNKNOWN',
): UseFirestoreDeviceStatusResult {
  const [data, setData] = useState<FirestoreDeviceStatus | null>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!deviceId) return;

    const unsub = subscribeToFirestoreDeviceStatus(deviceId, (result) => {
      setData(result);
      setIsLive(true);
    });

    return unsub;
  }, [deviceId]);

  return {
    status: data?.status ?? fallbackStatus,
    lastHeartbeatAt: data?.lastHeartbeatAt ?? null,
    isLive,
  };
}
