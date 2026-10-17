/**
 * env.ts — Validated Environment Configuration
 *
 * All environment variables are parsed and validated at startup using Zod.
 * The application will refuse to start if any required variable is missing or malformed.
 * This prevents misconfiguration-based security vulnerabilities.
 *
 * SECURITY: No secrets are logged. Only the structure (keys) are validated here.
 */

import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  // Database
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().default(30000),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().default(2000),

  // Redis
  REDIS_URL: z.string().url(),
  REDIS_PASSWORD: z.string().optional(),

  // JWT — require sufficiently long secrets
  JWT_ACCESS_SECRET: z.string().min(64, 'JWT_ACCESS_SECRET must be at least 64 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(64, 'JWT_REFRESH_SECRET must be at least 64 characters'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  // F-09 FIX: Separate secret for partial (pre-MFA) tokens — cryptographically isolated
  JWT_PARTIAL_SECRET: z.string().min(64, 'JWT_PARTIAL_SECRET must be at least 64 characters'),

  // Device JWT
  DEVICE_JWT_SECRET: z.string().min(64, 'DEVICE_JWT_SECRET must be at least 64 characters'),
  DEVICE_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(300).default(30),
  DEVICE_OFFLINE_THRESHOLD_SECONDS: z.coerce.number().int().min(30).max(600).default(90),

  // F-04: MFA secret encryption key — 64 hex chars (32 bytes for AES-256-GCM)
  MFA_ENCRYPTION_KEY: z.string().regex(
    /^[0-9a-fA-F]{64}$/,
    'MFA_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256-GCM)',
  ),


  // MFA
  MFA_ISSUER: z.string().min(1).default('AgentWatch'),
  MFA_TOTP_STEP: z.coerce.number().int().default(30),
  MFA_TOTP_DIGITS: z.coerce.number().int().default(6),

  // TURN Server
  TURN_SERVER_URLS: z.string().min(1),
  // F-16 FIX: Raised minimum from 32 to 64 chars — matches JWT secret entropy requirement
  TURN_SECRET: z.string().min(64, 'TURN_SECRET must be at least 64 characters'),
  TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),

  // Frontend / CORS
  FRONTEND_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),

  // Rate Limiting
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().default(900000),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().default(10),
  RATE_LIMIT_API_WINDOW_MS: z.coerce.number().int().default(60000),
  RATE_LIMIT_API_MAX: z.coerce.number().int().default(200),

  // Cookies
  // F-19 FIX: Default to true — developers must explicitly opt-out in .env.development
  COOKIE_SECURE: z.coerce.boolean().default(true),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),

  // Session
  MAX_SESSION_DURATION_MINUTES: z.coerce.number().int().min(1).max(480).default(120),
  SESSION_INACTIVITY_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(120).default(30),

  // Retention
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(30).default(365),
  MONITORING_SESSION_RETENTION_DAYS: z.coerce.number().int().min(30).default(90),
  SECURITY_EVENT_RETENTION_DAYS: z.coerce.number().int().min(30).default(365),
  REFRESH_TOKEN_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),

  // Account Security
  MAX_LOGIN_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  ACCOUNT_LOCKOUT_DURATION_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
});

// Parse and validate — throws immediately on invalid config
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsedEnv.data;

export type Env = typeof env;

// Production-specific enforcements
if (env.NODE_ENV === 'production') {
  const prodChecks = [
    { condition: !env.COOKIE_SECURE, message: 'COOKIE_SECURE must be true in production' },
    {
      condition: env.LOG_FORMAT !== 'json',
      message: 'LOG_FORMAT must be json in production',
    },
  ];

  const failures = prodChecks.filter((c) => c.condition);
  if (failures.length > 0) {
    failures.forEach((f) => console.error(`❌ Production check failed: ${f.message}`));
    process.exit(1);
  }
}
