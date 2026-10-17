/**
 * shared/types/user.types.ts
 */

export interface User {
  id: string;
  email: string;
  displayName: string;
  employeeId?: string;
  roleId: string;
  roleName: string;
  departmentId?: string;
  isActive: boolean;
  isMfaEnabled: boolean;
  failedLoginAttempts: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  lastLoginIp?: string;
  passwordChangedAt: Date;
  mustChangePassword: boolean;
  monitoringNoticeAcknowledged: boolean;
  monitoringNoticeAcknowledgedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Safe user — no password_hash, no mfa_secret
export type SafeUser = Omit<User, never> & {
  passwordHash?: never;
  mfaSecret?: never;
};

export interface UserWithPermissions extends User {
  permissions: string[];
}

export interface CreateUserDto {
  email: string;
  displayName: string;
  password: string;
  roleId: string;
  departmentId?: string;
  employeeId?: string;
}

export interface UpdateUserDto {
  displayName?: string;
  departmentId?: string;
  employeeId?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
}
