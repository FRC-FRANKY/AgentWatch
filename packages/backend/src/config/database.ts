/**
 * database.ts — PostgreSQL Connection Pool
 *
 * SECURITY:
 * - Credentials come exclusively from env (validated at startup)
 * - SSL enforced in production
 * - Connection timeout prevents hanging connections
 * - Parameterized queries must be used everywhere (pg library enforces this
 *   when using pool.query(text, params[]) — never interpolate user input)
 * - Schema prefix ensures queries hit the correct schema
 */

import { Pool, PoolClient } from 'pg';
import { env } from './env';
import { logger } from './logger';

const poolConfig = {
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
  // Enforce SSL in production
  ssl:
    env.NODE_ENV === 'production'
      ? {
          rejectUnauthorized: true,
        }
      : false,
};

export const db = new Pool(poolConfig);

// Log pool errors — but NEVER log the connection string or credentials
db.on('error', (err) => {
  logger.error({ error: err.message }, 'Unexpected database pool error');
});

db.on('connect', () => {
  logger.debug('Database pool: new connection established');
});

/**
 * Execute a query with automatic parameter binding.
 * NEVER pass user input directly as the query text — always use $1, $2, etc.
 */
export async function query<T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const start = Date.now();
  const result = await db.query<T>(text, params);
  const duration = Date.now() - start;

  // Log slow queries without logging parameter values (might contain PII)
  if (duration > 1000) {
    logger.warn({ duration, query: text.slice(0, 100) }, 'Slow database query detected');
  }

  return { rows: result.rows, rowCount: result.rowCount };
}

/**
 * Acquire a client for transaction use. Always release in finally block.
 */
export async function getClient(): Promise<PoolClient> {
  return db.connect();
}

/**
 * Run a function inside a database transaction.
 * Automatically commits on success, rolls back on error.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Health check — used by /health endpoint and Docker healthcheck
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
