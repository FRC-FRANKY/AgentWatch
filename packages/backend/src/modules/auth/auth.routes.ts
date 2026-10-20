/**
 * modules/auth/auth.routes.ts
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validateInput } from '../../middleware/validateInput';
import { loginSchema, mfaVerifySchema, setupMfaSchema } from '../../shared/schemas/auth.schemas';
import {
  handleLogin,
  handleMfaVerify,
  handleRefresh,
  handleLogout,
  handleMe,
  handleMfaSetupInitiate,
  handleMfaSetupConfirm,
  handleFirebaseToken,
} from './auth.controller';

export const authRoutes = Router();

// ── Public Routes ─────────────────────────────────────────────────────────────
// Rate limiting applied in app.ts

authRoutes.post('/login', validateInput(loginSchema), handleLogin);
authRoutes.post('/mfa/verify', validateInput(mfaVerifySchema), handleMfaVerify);
authRoutes.post('/refresh', handleRefresh);   // Token comes from httpOnly cookie

// ── Authenticated Routes ───────────────────────────────────────────────────────
authRoutes.get('/me', authenticate, handleMe);
authRoutes.post('/logout', authenticate, handleLogout);

// Firebase Custom Token — lets frontend sign in with manager's PostgreSQL user ID as UID
// so Firestore Security Rules (auth.uid == managerId) work correctly.
authRoutes.get('/firebase-token', authenticate, handleFirebaseToken);

// MFA Setup (requires authenticated user)
authRoutes.post('/mfa/setup', authenticate, handleMfaSetupInitiate);
authRoutes.post('/mfa/setup/confirm', authenticate, validateInput(setupMfaSchema), handleMfaSetupConfirm);
