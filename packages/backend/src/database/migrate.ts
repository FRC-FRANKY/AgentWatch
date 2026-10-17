/**
 * database/migrate.ts — Migration Runner
 *
 * Runs all SQL migration files in order. Tracks executed migrations in a
 * schema_migrations table so each migration only runs once.
 *
 * Usage: npm run migrate
 */

import fs from 'fs';
import path from 'path';
import { db } from '../config/database';
import 'dotenv/config';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id           SERIAL PRIMARY KEY,
      filename     VARCHAR(255) NOT NULL UNIQUE,
      executed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations(): Promise<Set<string>> {
  const result = await db.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY id');
  return new Set(result.rows.map((r) => r.filename));
}

async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (executed.has(file)) {
      console.log(`  ✓ ${file} (already executed)`);
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  ↑ ${file} — migrated`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file} — FAILED:`, (err as Error).message);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`\nMigration complete. ${count} new migration(s) applied.`);
}

runMigrations()
  .then(() => {
    db.end().catch(() => {});
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('Migration failed:', err);
    db.end().catch(() => {});
    process.exit(1);
  });
