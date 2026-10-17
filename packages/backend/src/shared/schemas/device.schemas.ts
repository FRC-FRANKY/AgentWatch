/**
 * shared/schemas/device.schemas.ts
 */
import { z } from 'zod';

export const registerDeviceSchema = z.object({
  agentUserId: z.string().uuid('Invalid agent user ID'),
  deviceName: z.string().min(1).max(100).trim(),
  hostname: z.string().min(1).max(255).trim(),
  macAddress: z.string().max(17).trim().optional().nullable(),
  osType: z.string().max(50).trim().optional().nullable(),
  osVersion: z.string().max(100).trim().optional().nullable(),
  clientVersion: z.string().max(20).trim().optional().nullable(),
  notes: z.string().max(500).trim().optional().nullable(),
}).strict();

export const heartbeatDeviceSchema = z.object({
  hostname: z.string().min(1).max(255).trim().optional(),
  osType: z.string().max(50).trim().optional().nullable(),
  osVersion: z.string().max(100).trim().optional().nullable(),
  clientVersion: z.string().max(20).trim().optional().nullable(),
}).strict();

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type HeartbeatDeviceInput = z.infer<typeof heartbeatDeviceSchema>;
