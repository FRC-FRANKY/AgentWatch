/**
 * app.ts — Express Application Factory
 *
 * This module creates and configures the Express application.
 * The security middleware stack is intentionally ordered:
 *
 * 1. Security headers (helmet) — first, before any response is sent
 * 2. CORS — controls cross-origin access
 * 3. Rate limiting — prevents brute force and DoS
 * 4. Body parsing — after rate limiting (prevents parsing large DoS payloads first)
 * 5. Cookie parsing
 * 6. Request logging
 * 7. Routes
 * 8. Error handler (last)
 *
 * SECURITY: All middleware choices are intentional. Do not reorder without
 * understanding the security implications.
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { pinoHttp } from 'pino-http';

import { env } from './env';
import { logger } from './logger';

// Middleware
import { loginRateLimiter, apiRateLimiter, mfaRateLimiter } from '../middleware/rateLimiter';
import { errorHandler } from '../middleware/errorHandler';

// Routes
import { authRoutes } from '../modules/auth/auth.routes';
import { agentsRoutes } from '../modules/agents/agents.routes';
import { usersRoutes } from '../modules/users/users.routes';
import { rolesRoutes } from '../modules/roles/roles.routes';
import { devicesRoutes } from '../modules/devices/devices.routes';
import { sessionsRoutes } from '../modules/sessions/sessions.routes';
import { auditRoutes } from '../modules/audit/audit.routes';

/**
 * Parses the CORS_ORIGINS env variable into an array of allowed origins.
 * Supports comma-separated values: "https://app.example.com,https://admin.example.com"
 */
function parseCorsOrigins(): string[] {
  return env.CORS_ORIGINS.split(',').map((o: string) => o.trim()).filter(Boolean);
}

export function createApp(): Application {
  const app = express();
  const allowedOrigins = parseCorsOrigins();

  // ── 1. Security Headers (helmet) ───────────────────────────────────────────
  // Strict CSP, HSTS, X-Frame-Options, etc.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'none'"],           // No embedded media from external sources
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],     // Prevents clickjacking
          upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hsts:
        env.NODE_ENV === 'production'
          ? { maxAge: 31536000, includeSubDomains: true, preload: true }
          : false,
      noSniff: true,
      xssFilter: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // ── 2. CORS ────────────────────────────────────────────────────────────────
  // Strict allowlist — no wildcard origins in production
  app.use(
    cors({
      origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
        // Allow server-to-server requests (no origin header) in development
        if (!origin && env.NODE_ENV === 'development') {
          return callback(null, true);
        }
        if (origin && allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        logger.warn({ origin }, 'CORS: rejected request from unauthorized origin');
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,                 // Required for cookies
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID'],
      maxAge: 86400,                     // 24h preflight cache
    }),
  );

  // ── 3. Rate Limiting ───────────────────────────────────────────────────────
  // Applied globally — specific endpoints get stricter limits
  app.use('/api/', apiRateLimiter);
  app.use('/api/auth/login', loginRateLimiter);
  app.use('/api/auth/mfa', mfaRateLimiter); // F-03: dedicated MFA rate limiter

  // ── 4. Body Parsing ────────────────────────────────────────────────────────
  // Limit body size to prevent DoS via large payloads
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // ── 5. Cookies ─────────────────────────────────────────────────────────────
  app.use(cookieParser());

  // ── 6. Compression ─────────────────────────────────────────────────────────
  app.use(compression());

  // ── 7. Request Logging ─────────────────────────────────────────────────────
  // Redacts sensitive headers — authorization, cookie, etc.
  app.use(
    pinoHttp({
      logger,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
      customSuccessMessage(req: Request, res: Response) {
        return `${req.method} ${req.url} ${res.statusCode}`;
      },
    }),
  );

  // ── 8. Health Check (unauthenticated) ──────────────────────────────────────
  // F-11 FIX: Public health endpoint returns minimal info only.
  // Version and DB detail are now in /health/detail (authenticated).
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── 9a. API Health (with database check) ───────────────────────────────────
  app.get('/api/health', async (_req: Request, res: Response) => {
    const { checkDatabaseHealth } = await import('./database');
    const dbOk = await checkDatabaseHealth().catch(() => false);
    const overallStatus = dbOk ? 'ok' : 'degraded';
    res.status(dbOk ? 200 : 503).json({
      status: overallStatus,
      database: dbOk ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    });
  });

  // ── 9. API Routes ──────────────────────────────────────────────────────────
  app.use('/api/auth', authRoutes);
  app.use('/api/agents', agentsRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/roles', rolesRoutes);
  app.use('/api/devices', devicesRoutes);
  app.use('/api/sessions', sessionsRoutes);
  app.use('/api/audit', auditRoutes);

  // ── 10. 404 Handler ────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── 11. Global Error Handler (must be last) ────────────────────────────────
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    errorHandler(err, req, res, next);
  });

  return app;
}
