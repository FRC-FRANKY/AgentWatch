/**
 * middleware/rateLimiter.ts — Rate Limiting Configuration
 *
 * SECURITY (F-03 FIX):
 * - All limiters backed by Redis — safe across multiple backend instances.
 * - In-memory limiters are bypassed when multiple replicas run behind a load balancer.
 * - Login endpoint: 10 attempts / 15 min / IP
 * - MFA endpoint: 5 attempts / 5 min / IP
 * - API general: 200 req/min/IP
 * - Heartbeat: 10 req/min/device
 */

import rateLimit, { Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { getRedisClientSync } from '../config/redis';

const DEMO_MODE = process.env.USE_DEMO_MODE === 'true';

function makeRedisStore(prefix: string): RedisStore {
  return new RedisStore({
    sendCommand: (...args: string[]) => getRedisClientSync().sendCommand(args as never),
    prefix: `rl:${prefix}:`,
  });
}

function onLimitReached(req: Parameters<NonNullable<Options['handler']>>[0]): void {
  logger.warn(
    {
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
    },
    'Rate limit exceeded',
  );
}

/** Strict rate limiter for login endpoint */
export const loginRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
  max: env.RATE_LIMIT_LOGIN_MAX,
  store: DEMO_MODE ? undefined : makeRedisStore('login'),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler(req, res) {
    onLimitReached(req);
    res.status(429).json({
      error: 'Too many login attempts. Please try again later.',
      retryAfter: Math.ceil(env.RATE_LIMIT_LOGIN_WINDOW_MS / 1000),
    });
  },
  keyGenerator(req) {
    return req.ip ?? 'unknown';
  },
});

/** Strict rate limiter for MFA verification endpoint (F-25: per-IP MFA brute-force) */
export const mfaRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,                  // 10 attempts per 5 min per IP
  store: DEMO_MODE ? undefined : makeRedisStore('mfa'),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failures
  handler(req, res) {
    onLimitReached(req);
    res.status(429).json({
      error: 'Too many MFA attempts. Please try again later.',
      retryAfter: 300,
    });
  },
  keyGenerator(req) {
    return req.ip ?? 'unknown';
  },
});

/** General API rate limiter */
export const apiRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_API_WINDOW_MS,
  max: env.RATE_LIMIT_API_MAX,
  store: DEMO_MODE ? undefined : makeRedisStore('api'),
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    onLimitReached(req);
    res.status(429).json({
      error: 'Too many requests. Please slow down.',
      retryAfter: Math.ceil(env.RATE_LIMIT_API_WINDOW_MS / 1000),
    });
  },
  keyGenerator(req) {
    return req.ip ?? 'unknown';
  },
});

/** Device heartbeat rate limiter — keyed by device ID */
export const heartbeatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  store: DEMO_MODE ? undefined : makeRedisStore('heartbeat'),
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({ error: 'Heartbeat rate limit exceeded' });
  },
  keyGenerator(req) {
    return (req.headers['x-device-id'] as string) ?? req.ip ?? 'unknown';
  },
});
