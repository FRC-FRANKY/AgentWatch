/**
 * middleware/errorHandler.ts — Global Error Handler
 *
 * SECURITY:
 * - Never expose stack traces to clients in production
 * - Never expose internal error messages (database errors, etc.)
 * - Log full error details server-side
 * - Return generic error messages to clients
 * - Log request ID for correlation
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { env } from '../config/env';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? 'unknown';

  // Log the full error server-side (with stack trace)
  logger.error(
    {
      requestId,
      err: {
        name: err.name,
        message: err.message,
        stack: env.NODE_ENV === 'development' ? err.stack : undefined,
      },
      path: req.path,
      method: req.method,
      userId: req.user?.id,
    },
    'Request error',
  );

  // Handle known application errors (safe to surface message)
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      requestId,
    });
    return;
  }

  // JWT errors (from auth middleware — re-thrown as generic)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({ error: 'Invalid or expired token', requestId });
    return;
  }

  // PostgreSQL unique violation
  if ((err as NodeJS.ErrnoException).code === '23505') {
    res.status(409).json({ error: 'Resource already exists', requestId });
    return;
  }

  // PostgreSQL foreign key violation
  if ((err as NodeJS.ErrnoException).code === '23503') {
    res.status(409).json({ error: 'Referenced resource not found', requestId });
    return;
  }

  // CORS errors
  if (err.message === 'Not allowed by CORS') {
    res.status(403).json({ error: 'CORS policy violation', requestId });
    return;
  }

  // Generic fallback — never expose internal details in production
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  res.status(statusCode).json({
    error:
      env.NODE_ENV === 'development'
        ? err.message
        : 'An internal error occurred. Please contact support.',
    requestId,
  });
}
