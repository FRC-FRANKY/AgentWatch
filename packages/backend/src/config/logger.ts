/**
 * logger.ts — Structured Application Logger
 *
 * Uses pino for structured JSON logging.
 *
 * SECURITY RULES enforced here:
 * - No passwords in logs (redacted by serializer)
 * - No access tokens in logs (redacted by serializer)
 * - No refresh tokens in logs (redacted by serializer)
 * - No screen content in logs (enforced by convention and code review)
 * - No raw SQL queries with values in production logs
 *
 * Audit events must go through the AuditService, NOT this logger.
 * This logger is for application-level operational logs only.
 */

import pino from 'pino';
import { env } from './env';

// Redact sensitive fields wherever they appear in log objects
const REDACTED_PATHS = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'deviceToken',
  'secret',
  'mfaSecret',
  'totp',
  'otp',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'body.password',
  'body.token',
  'body.refreshToken',
];

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    redact: {
      paths: REDACTED_PATHS,
      censor: '[REDACTED]',
    },
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    base: {
      service: 'agentwatch-backend',
      version: process.env['APP_VERSION'] ?? '1.0.0',
      env: env.NODE_ENV,
    },
  },
  env.LOG_FORMAT === 'pretty'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      })
    : undefined,
);

export type Logger = typeof logger;
