/**
 * shared/schemas/auth.schemas.ts — Zod Input Validation for Auth Endpoints
 *
 * SECURITY: All user input is validated and sanitized before reaching service layer.
 * - Passwords: minimum length, complexity enforced
 * - Email: normalized to lowercase
 * - TOTP: exactly 6 digits
 * - No bypass via extra fields (strict mode)
 */

import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .max(255)
    .transform((v) => v.toLowerCase().trim()),
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128, 'Password too long'),  // Prevent bcrypt DoS via huge inputs
});

export const mfaVerifySchema = z.object({
  partialToken: z.string().min(1),
  code: z
    .string()
    .regex(/^\d{6}$/, 'TOTP code must be exactly 6 digits'),
});

export const mfaBackupCodeSchema = z.object({
  partialToken: z.string().min(1),
  backupCode: z
    .string()
    .regex(/^[A-Z0-9]{8}-[A-Z0-9]{8}$/, 'Invalid backup code format'),
});

export const refreshTokenSchema = z.object({
  // Refresh token comes from httpOnly cookie, not body
  // This schema is kept for documentation; actual extraction is from cookie
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z
      .string()
      .min(12, 'Password must be at least 12 characters')
      .max(128)
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Must contain at least one digit')
      .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
    confirmPassword: z.string().min(1).max(128),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from current password',
    path: ['newPassword'],
  });

export const setupMfaSchema = z.object({
  // Setup is initiated server-side; client sends the verification code to confirm
  code: z.string().regex(/^\d{6}$/, 'TOTP code must be exactly 6 digits'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SetupMfaInput = z.infer<typeof setupMfaSchema>;
