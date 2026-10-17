/**
 * hooks/useApi.ts — Generic API data-fetching hook
 *
 * Provides loading, error, data states with retry support.
 * Use this instead of scattering useEffect + useState pairs everywhere.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getErrorMessage } from '../services/api/index';

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(getErrorMessage(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    void fetch();
    return () => {
      mountedRef.current = false;
    };
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

/**
 * usePolling — calls refetch on an interval (for realtime-like updates)
 */
export function usePolling(refetch: () => void, intervalMs: number, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(refetch, intervalMs);
    return () => clearInterval(interval);
  }, [refetch, intervalMs, enabled]);
}
