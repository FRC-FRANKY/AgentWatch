/**
 * shared/schemas/session.schemas.ts
 */
import { z } from 'zod';

export const requestSessionSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID'),
  deviceId: z.string().uuid('Invalid device ID'),
});

export const endSessionSchema = z.object({
  reason: z.enum(['MANAGER_REQUEST', 'AGENT_TERMINATE', 'ADMIN_TERMINATE', 'TIMEOUT', 'ERROR']),
});

export const listSessionsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'ACTIVE', 'ENDED', 'TERMINATED', 'EXPIRED', 'FAILED']).optional(),
  agentId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export type RequestSessionInput = z.infer<typeof requestSessionSchema>;
export type EndSessionInput = z.infer<typeof endSessionSchema>;
export type ListSessionsInput = z.infer<typeof listSessionsSchema>;
