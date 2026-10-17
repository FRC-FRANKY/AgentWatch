/**
 * config/redis.ts — Shared Redis Client
 *
 * Used by:
 * - Rate limiters (distributed counters)
 * - TOTP replay prevention
 * - Session token blacklist
 * - Audit write retry queue
 *
 * SECURITY: Connection uses AUTH password from environment.
 * Client is singleton — shared across the app.
 */

import { createClient, type RedisClientType } from 'redis';
import { env } from './env';
import { logger } from './logger';

let _redis: RedisClientType | null = null;

const DEMO_MODE = process.env.USE_DEMO_MODE === 'true';

const demoRedisStub = {
  isOpen: true,
  on: () => undefined,
  sendCommand: async () => 'OK',
  quit: async () => undefined,
} as unknown as RedisClientType;

export async function getRedisClient(): Promise<RedisClientType> {
  if (DEMO_MODE) return demoRedisStub;
  if (_redis && _redis.isOpen) return _redis;

  _redis = createClient({
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
    socket: {
      reconnectStrategy(retries) {
        if (retries > 10) {
          logger.error('Redis: max reconnection attempts exceeded');
          return new Error('Max reconnect attempts exceeded');
        }
        return Math.min(retries * 100, 3000);
      },
    },
  }) as RedisClientType;

  _redis.on('error', (err: Error) => {
    // Never log connection string or password
    logger.error({ message: err.message }, 'Redis client error');
  });

  _redis.on('connect', () => logger.info('Redis client connected'));
  _redis.on('reconnecting', () => logger.warn('Redis client reconnecting'));

  await _redis.connect();
  return _redis;
}

export function getRedisClientSync(): RedisClientType {
  if (DEMO_MODE) return demoRedisStub;
  if (!_redis) throw new Error('Redis client not initialized. Call getRedisClient() first.');
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis?.isOpen) {
    await _redis.quit();
    _redis = null;
  }
}
