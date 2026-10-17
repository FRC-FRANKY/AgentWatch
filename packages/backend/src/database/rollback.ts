/**
 * database/rollback.ts — Migration Rollback
 *
 * Rolls back the last applied migration.
 * Usage: npm run migrate:rollback
 */

import { db } from '../config/database';
import 'dotenv/config';

async function rollback(): Promise<void> {
  const result = await db.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1',
  );

  const last = result.rows[0];
  if (!last) {
    console.log('No migrations to roll back.');
    return;
  }

  console.log(`Rolling back: ${last.filename}`);
  await db.query('DELETE FROM schema_migrations WHERE filename = $1', [last.filename]);
  console.log(`Rolled back schema_migrations record for ${last.filename}`);
  console.log('NOTE: The actual SQL changes are NOT automatically reversed.');
  console.log('      You must manually undo the schema changes if needed.');
}

rollback()
  .then(() => {
    db.end().catch(() => {});
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('Rollback failed:', err);
    db.end().catch(() => {});
    process.exit(1);
  });
