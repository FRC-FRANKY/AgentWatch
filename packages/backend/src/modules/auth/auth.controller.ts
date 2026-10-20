/**
 * modules/auth/auth.controller.ts
 */

import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import * as mfaService from './mfa.service';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { getFirebaseCustomToken } from '../../config/firebase';

const REFRESH_COOKIE_NAME = 'agentwatch_rt';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAME_SITE as 'strict' | 'lax' | 'none',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/api/auth/refresh',        // Scope refresh token cookie to refresh endpoint only
};

export async function handleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const result = await authService.login(
      email, password,
      req.ip ?? 'unknown',
      req.headers['user-agent'] ?? 'unknown',
      req.requestId,
    );

    if (result.requiresMfa) {
      res.status(200).json({
        requiresMfa: true,
        partialToken: result.partialToken,
      });
      return;
    }

    // Set refresh token in httpOnly cookie
    res.cookie(REFRESH_COOKIE_NAME, result.tokens!.refreshToken, COOKIE_OPTIONS);

    res.status(200).json({
      accessToken: result.tokens!.accessToken,
      expiresIn: result.tokens!.expiresIn,
      displayName: result.displayName,
      role: result.role,
    });
  } catch (err) {
    next(new AppError(401, (err as Error).message, 'AUTH_FAILED'));
  }
}

export async function handleMfaVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { partialToken, code } = req.body as { partialToken: string; code: string };
    const result = await authService.verifyMfa(
      partialToken, code,
      req.ip ?? 'unknown',
      req.headers['user-agent'] ?? 'unknown',
      req.requestId,
    );

    res.cookie(REFRESH_COOKIE_NAME, result.tokens.refreshToken, COOKIE_OPTIONS);

    res.status(200).json({
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    });
  } catch (err) {
    next(new AppError(401, (err as Error).message, 'MFA_FAILED'));
  }
}

export async function handleRefresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refreshToken = req.cookies[REFRESH_COOKIE_NAME] as string | undefined;
    if (!refreshToken) {
      res.status(401).json({ error: 'No refresh token provided' });
      return;
    }

    const result = await authService.refreshTokens(
      refreshToken,
      req.ip ?? 'unknown',
      req.headers['user-agent'] ?? 'unknown',
      req.requestId,
    );

    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, COOKIE_OPTIONS);

    res.status(200).json({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    });
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth/refresh' });
    next(new AppError(401, (err as Error).message, 'REFRESH_FAILED'));
  }
}

export async function handleLogout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user) {
      await authService.logout(
        req.user.id,
        req.user.email,
        req.user.role,
        req.ip ?? 'unknown',
        req.headers['user-agent'] ?? 'unknown',
        req.requestId,
      );
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth/refresh' });
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

export async function handleMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // In demo mode, derive display name from DEMO_USERS map
    const DEMO_DISPLAY_NAMES: Record<string, string> = {
      'demo-admin': 'System Administrator',
      'demo-manager': 'Operations Manager',
      'demo-support': 'IT Support Engineer',
      'demo-agent': 'Remote Agent',
    };

    const displayName = process.env.USE_DEMO_MODE === 'true'
      ? (DEMO_DISPLAY_NAMES[req.user.id] ?? req.user.email)
      : req.user.email; // In production, would query DB for display_name

    res.status(200).json({
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      displayName,
      mfaVerified: req.user.mfaVerified,
      permissions: Array.from(req.user.permissions),
    });
  } catch (err) {
    next(err);
  }
}

export async function handleMfaSetupInitiate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { secret, otpauthUrl, backupCodes } = await mfaService.initiateMfaSetup(
      req.user!.id,
      req.user!.email,
    );
    // Return QR data and plaintext backup codes (shown once — user must save)
    res.status(200).json({ secret, otpauthUrl, backupCodes });
  } catch (err) {
    next(err);
  }
}

export async function handleMfaSetupConfirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.body as { code: string };
    const activated = await mfaService.confirmMfaSetup(req.user!.id, code);
    if (!activated) {
      res.status(400).json({ error: 'Invalid TOTP code — MFA not activated' });
      return;
    }
    res.status(200).json({ message: 'MFA activated successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /auth/firebase-token
 *
 * Issues a short-lived Firebase Custom Token for the authenticated manager.
 * The token's Firebase UID equals the manager's PostgreSQL user ID, enabling
 * Firestore Security Rules to enforce per-manager document access.
 *
 * SECURITY:
 * - Requires a valid JWT access token (authenticate middleware)
 * - Token is issued only after successful backend authentication
 * - Custom token expires in 1 hour (Firebase limit)
 * - Only grants Firestore read permissions as defined in firestore.rules
 */
export async function handleFirebaseToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const token = await getFirebaseCustomToken(req.user.id, req.user.role);

    if (!token) {
      // Firebase is not configured — return a sentinel so the frontend
      // falls back to anonymous auth gracefully.
      res.status(200).json({ firebaseToken: null, reason: 'firebase_disabled' });
      return;
    }

    res.status(200).json({ firebaseToken: token });
  } catch (err) {
    next(err);
  }
}
