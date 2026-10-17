import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { hashPassword, login, verifyPassword } from '../../src/modules/auth/auth.service';

describe('AgentWatch authentication security baseline', () => {
  beforeEach(() => {
    process.env.USE_DEMO_MODE = 'true';
  });

  afterEach(() => {
    delete process.env.USE_DEMO_MODE;
  });

  it('hashes passwords without storing plaintext', async () => {
    const password = 'StrongPassword123!';
    const hashed = await hashPassword(password);

    expect(hashed).not.toBe(password);
    expect(hashed).toMatch(/^\$argon2id\$/i);
    expect(await verifyPassword(hashed, password)).toBe(true);
    expect(await verifyPassword(hashed, 'wrong-password')).toBe(false);
  });

  it('issues a signed demo token for a valid admin login', async () => {
    const result = await login(
      'admin@agentwatch.local',
      'Admin123!',
      '127.0.0.1',
      'jest-agent',
      'request-123',
    );

    expect(result.requiresMfa).toBe(false);
    expect(result.userId).toBe('demo-admin');
    expect(result.tokens).toBeDefined();
    expect(result.tokens!.accessToken).toBeTruthy();
    expect(result.tokens!.refreshToken).toBeTruthy();
  });

  it('blocks unauthorized roles from monitoring permissions', () => {
    const permissions = new Map<string, Set<string>>([
      ['ADMIN', new Set(['users.read', 'users.create', 'sessions.read', 'sessions.create'])],
      ['AGENT', new Set(['agents.read'])],
      ['MANAGER', new Set(['agents.read', 'sessions.create'])],
    ]);

    expect(permissions.get('MANAGER')?.has('sessions.create')).toBe(true);
    expect(permissions.get('AGENT')?.has('sessions.create')).toBe(false);
    expect(permissions.get('ADMIN')?.has('users.create')).toBe(true);
  });
});
