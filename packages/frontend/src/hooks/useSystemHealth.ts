/**
 * hooks/useSystemHealth.ts — Backend connectivity monitor
 *
 * Polls /api/health every 30 seconds and exposes the status.
 * Used by AppLayout to show SYSTEM ONLINE / DEGRADED / OFFLINE.
 */

import { useState, useEffect, useRef } from 'react';
import { healthApi } from '../services/api/index';
import type { HealthStatus } from '../services/api/index';

export type SystemStatus = 'online' | 'degraded' | 'offline' | 'checking';

export function useSystemHealth(pollIntervalMs = 30000): {
  status: SystemStatus;
  lastChecked: Date | null;
} {
  const [status, setStatus] = useState<SystemStatus>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const check = async () => {
    try {
      const result: HealthStatus = await healthApi.check();
      if (!mountedRef.current) return;

      if (result.status === 'ok') setStatus('online');
      else if (result.status === 'degraded') setStatus('degraded');
      else setStatus('offline');

      setLastChecked(new Date());
    } catch {
      if (mountedRef.current) {
        setStatus('offline');
        setLastChecked(new Date());
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void check();
    const interval = setInterval(() => void check(), pollIntervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [pollIntervalMs]);

  return { status, lastChecked };
}
