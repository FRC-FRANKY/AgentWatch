/**
 * hooks/useFirestoreDashboardStats.ts
 *
 * React hook that subscribes to live dashboard stats from Firestore.
 * Used by DashboardPage to show live agent counts without page refresh.
 */

import { useState, useEffect } from 'react';
import {
  subscribeToFirestoreDashboardStats,
  type FirestoreDashboardStats,
} from '../services/firestore';

export interface UseDashboardStatsResult {
  onlineAgents: number;
  offlineAgents: number;
  activeMonitoring: number;
  updatedAt: Date | null;
  isLive: boolean;
}

/**
 * Subscribe to the manager's live dashboard stats from Firestore.
 *
 * @param managerId - The authenticated manager's user ID
 */
export function useFirestoreDashboardStats(
  managerId: string | undefined,
): UseDashboardStatsResult {
  const [data, setData] = useState<FirestoreDashboardStats | null>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!managerId) return;

    const unsub = subscribeToFirestoreDashboardStats(managerId, (result) => {
      setData(result);
      setIsLive(true);
    });

    return unsub;
  }, [managerId]);

  return {
    onlineAgents: data?.onlineAgents ?? 0,
    offlineAgents: data?.offlineAgents ?? 0,
    activeMonitoring: data?.activeMonitoring ?? 0,
    updatedAt: data?.updatedAt ?? null,
    isLive,
  };
}
