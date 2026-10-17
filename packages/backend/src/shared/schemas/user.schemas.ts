/**
 * shared/schemas/user.schemas.ts
 */
import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password too long')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Must contain at least one digit')
  .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character');

export const createUserSchema = z.object({
  email: z.string().email().max(255).transform((v) => v.toLowerCase().trim()),
  displayName: z.string().min(2).max(100).trim(),
  password: passwordSchema,
  roleId: z.string().uuid('Invalid role ID'),
  departmentId: z.string().uuid('Invalid department ID').optional(),
  employeeId: z.string().max(50).trim().optional(),
});

export const updateUserSchema = z.object({
  displayName: z.string().min(2).max(100).trim().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  employeeId: z.string().max(50).trim().nullable().optional(),
  mustChangePassword: z.boolean().optional(),
}).strict(); // Reject unknown fields

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  roleId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().max(100).trim().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
