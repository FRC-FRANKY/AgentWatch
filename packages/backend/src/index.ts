/**
 * index.ts — Application Entry Point
 *
 * Starts the HTTP server and WebSocket signaling server.
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */

import http from 'http';
import { createApp } from './config/app';
import { env } from './config/env';
import { logger } from './config/logger';
import { db } from './config/database';
import { createSignalingGateway } from './modules/signaling/signaling.gateway';
import { initFirebase } from './config/firebase';

async function main(): Promise<void> {
  // Initialize Firebase (gracefully degraded if not configured)
  initFirebase();

  const app = createApp();
  const server = http.createServer(app);


  // Attach WebSocket signaling server to the HTTP server
  // (shares the same port — no separate port to expose)
  createSignalingGateway(server);

  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      'AgentWatch backend server started',
    );
  });

  // ── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received — shutting down gracefully');

    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        await db.end();
        logger.info('Database pool closed');
      } catch (err) {
        logger.error({ err }, 'Error closing database pool');
      }

      logger.info('Graceful shutdown complete');
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Graceful shutdown timeout — forcing exit');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // ── Unhandled Errors ───────────────────────────────────────────────────────
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
    // Do not exit — log and continue, but alert monitoring
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
