/**
 * middleware/validateInput.ts — Zod Input Validation Wrapper
 *
 * Validates request body, query, or params against a Zod schema.
 * Returns 422 with structured errors on validation failure.
 * Replaces req.body/query with the parsed (and transformed) values.
 *
 * SECURITY: Reject requests with unknown fields to prevent mass assignment.
 * Use z.object({...}).strict() in schemas to enforce this.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

type ValidateTarget = 'body' | 'query' | 'params';

export function validateInput(schema: ZodSchema, target: ValidateTarget = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      res.status(422).json({
        error: 'Validation failed',
        details: errors,
      });
      return;
    }

    // Replace with parsed (sanitized/transformed) values
    req[target] = result.data as typeof req[typeof target];
    next();
  };
}

function formatZodErrors(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.') || 'root';
    if (!formatted[field]) formatted[field] = [];
    formatted[field]!.push(issue.message);
  }
  return formatted;
}
