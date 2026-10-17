/**
 * shared/types/auth.types.ts — Authentication & Authorization Types
 */

export interface JwtAccessPayload {
  sub: string;           // user ID
  email: string;
  role: string;
  roleId: string;
  managerId?: string | null;
  mfa_verified: boolean; // MFA step completed
  iat?: number;
  exp?: number;
  jti?: string;          // JWT ID for revocation tracking
}

export interface JwtRefreshPayload {
  sub: string;           // user ID
  family: string;        // Refresh token family ID
  jti: string;           // Token ID (matches refresh_tokens.id)
  iat?: number;
  exp?: number;
}

export interface DeviceJwtPayload {
  device_id: string;
  agent_user_id: string;
  hostname: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Express.Request {
  user: {
    id: string;
    email: string;
    role: string;
    roleId: string;
    managerId?: string | null;
    mfaVerified: boolean;
    permissions: Set<string>;
  };
  requestId: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResult {
  requiresMfa: boolean;
  mfaRequired?: boolean;
  tokens?: TokenPair;
  userId: string;
  displayName?: string;   // User's display name (returned from login)
  role?: string;          // User's role (returned from login)
  partialToken?: string;  // Short-lived token valid only for MFA step
}

export interface MfaVerifyResult {
  tokens: TokenPair;
  userId: string;
}
