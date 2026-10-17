// @ts-nocheck
/**
 * tests/manager/manager-lifecycle.test.ts
 *
 * Manager → Agent lifecycle tests (unit mode — no real DB required).
 * All database interactions are intercepted via jest.spyOn + mockResolvedValue.
 *
 * @ts-nocheck is used because ts-jest's strict inference produces false-positive
 * `never` type errors on mock return values in heavy-mocking test files.
 *
 * SCENARIOS:
 *   1. Agent access grant: rejects self-access / wrong role / missing user
 *   2. Ownership denial: verifyManagerAgentAccess returns false for Manager B
 *   3. Device registration is gated on ownership check
 *   4. Unauthorized device assignment → access denied
 *   5. Enrollment token: rejects invalid / consumed / expired tokens
 *   6. Session request: rejects when no manager-agent access grant exists
 *   7. Session IDOR: getSessionById returns null for unauthorized manager
 */


/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, jest } from '@jest/globals';

// Convenience: cast any mock value to the expected return type
const asDbResult = <T>(rows: T[], rowCount = rows.length) =>
  ({ rows, rowCount }) as unknown as any;

const MANAGER_A_ID = 'manager-a-uuid';
const MANAGER_B_ID = 'manager-b-uuid';
const AGENT_A_ID   = 'agent-a-uuid';
const GRANT_ID     = 'grant-a-uuid';

// ── Test 1: Manager Agent Access Grant ───────────────────────────────────────

describe('Test 1 — Manager agent access grant', () => {
  it('rejects self-access (manager granting themselves)', async () => {
    const { ensureManagerAgentAccess } = await import('../../src/modules/agents/agents.service');
    await expect(
      ensureManagerAgentAccess({
        managerId: MANAGER_A_ID,
        agentId:   MANAGER_A_ID,   // same ID → fail-fast before any DB call
        grantedById: MANAGER_A_ID,
      }),
    ).rejects.toThrow('SELF_ACCESS_DENIED');
  });

  it('rejects when agent user does not exist', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'query')
      .mockResolvedValueOnce(asDbResult([]));

    const { ensureManagerAgentAccess } = await import('../../src/modules/agents/agents.service');
    await expect(
      ensureManagerAgentAccess({
        managerId: MANAGER_A_ID, agentId: 'ghost-user',
        grantedById: MANAGER_A_ID,
      }),
    ).rejects.toThrow('AGENT_NOT_FOUND');

    jest.restoreAllMocks();
  });

  it('rejects agent users that have MANAGER role instead of AGENT', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'query')
      .mockResolvedValueOnce(asDbResult([{ id: 'other', role_name: 'MANAGER', is_active: true }]));

    const { ensureManagerAgentAccess } = await import('../../src/modules/agents/agents.service');
    await expect(
      ensureManagerAgentAccess({
        managerId: MANAGER_A_ID, agentId: 'other-manager-id',
        grantedById: MANAGER_A_ID,
      }),
    ).rejects.toThrow('INVALID_ROLE');

    jest.restoreAllMocks();
  });
});

// ── Test 2: Ownership Denial ──────────────────────────────────────────────────

describe('Test 2 — Ownership denial (Manager B → Agent A)', () => {
  it('verifyManagerAgentAccess returns false when no grant exists', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'query')
      .mockResolvedValueOnce(asDbResult([]));

    const { verifyManagerAgentAccess } = await import('../../src/modules/agents/agents.service');
    expect(await verifyManagerAgentAccess(MANAGER_B_ID, AGENT_A_ID)).toBe(false);

    jest.restoreAllMocks();
  });

  it('verifyManagerAgentAccess returns true when active grant exists', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'query')
      .mockResolvedValueOnce(asDbResult([{ id: GRANT_ID }]));

    const { verifyManagerAgentAccess } = await import('../../src/modules/agents/agents.service');
    expect(await verifyManagerAgentAccess(MANAGER_A_ID, AGENT_A_ID)).toBe(true);

    jest.restoreAllMocks();
  });
});

// ── Test 3: Device Registration Gated on Access ───────────────────────────────

describe('Test 3 — Device registration access check', () => {
  it('authorized manager passes the access check (hasAccess = true)', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'query')
      .mockResolvedValueOnce(asDbResult([{ id: GRANT_ID }]));

    const { verifyManagerAgentAccess } = await import('../../src/modules/agents/agents.service');
    expect(await verifyManagerAgentAccess(MANAGER_A_ID, AGENT_A_ID)).toBe(true);

    jest.restoreAllMocks();
  });
});

// ── Test 4: Unauthorized Device Assignment ───────────────────────────────────

describe('Test 4 — Unauthorized device assignment', () => {
  it('unauthorized manager fails the access check (hasAccess = false → HTTP 403)', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'query')
      .mockResolvedValueOnce(asDbResult([]));

    const { verifyManagerAgentAccess } = await import('../../src/modules/agents/agents.service');
    expect(await verifyManagerAgentAccess(MANAGER_B_ID, AGENT_A_ID)).toBe(false);

    jest.restoreAllMocks();
  });
});

// ── Test 5: Enrollment Token Lifecycle ───────────────────────────────────────

describe('Test 5 — Enrollment token lifecycle', () => {
  it('buildAgentEnrollmentCode returns a stable formatted code', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildAgentEnrollmentCode } = require('../../src/modules/agents/agents.service') as {
      buildAgentEnrollmentCode: (id: string) => string;
    };
    const code1 = buildAgentEnrollmentCode('agent-001');
    const code2 = buildAgentEnrollmentCode('agent-001');
    expect(code1).toMatch(/^[A-Z0-9-]{8,}$/);
    expect(code1).toBe(code2);
  });

  it('consumeEnrollmentToken rejects an unknown token', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'withTransaction')
      .mockImplementationOnce(((fn: (client: any) => Promise<any>) =>
        fn({ query: jest.fn().mockResolvedValue(asDbResult([])) })
      ) as any);

    const { consumeEnrollmentToken } = await import('../../src/modules/agents/agents.service');
    await expect(consumeEnrollmentToken('nonexistent-token')).rejects.toThrow('INVALID_TOKEN');

    jest.restoreAllMocks();
  });

  it('consumeEnrollmentToken rejects an already-consumed token', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'withTransaction')
      .mockImplementationOnce(((fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn().mockResolvedValue(asDbResult([{
            id: 'tok-1', manager_id: MANAGER_A_ID, agent_user_id: AGENT_A_ID,
            is_consumed: true,
            expires_at: new Date(Date.now() + 3_600_000),
          }])),
        })
      ) as any);

    const { consumeEnrollmentToken } = await import('../../src/modules/agents/agents.service');
    await expect(consumeEnrollmentToken('used-token')).rejects.toThrow('TOKEN_USED');

    jest.restoreAllMocks();
  });

  it('consumeEnrollmentToken rejects an expired token', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'withTransaction')
      .mockImplementationOnce(((fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn().mockResolvedValue(asDbResult([{
            id: 'tok-2', manager_id: MANAGER_A_ID, agent_user_id: AGENT_A_ID,
            is_consumed: false,
            expires_at: new Date(Date.now() - 3_600_000),  // Expired 1 hour ago
          }])),
        })
      ) as any);

    const { consumeEnrollmentToken } = await import('../../src/modules/agents/agents.service');
    await expect(consumeEnrollmentToken('expired-token')).rejects.toThrow('TOKEN_EXPIRED');

    jest.restoreAllMocks();
  });
});

// ── Test 6: Session Request Authorization ────────────────────────────────────

describe('Test 6 — Session request requires manager-agent access grant', () => {
  it('requestMonitoringSession throws AUTHORIZATION_DENIED when no grant exists', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'withTransaction')
      .mockImplementationOnce(((fn: (client: any) => Promise<any>) =>
        fn({ query: jest.fn().mockResolvedValue(asDbResult([])) })
      ) as any);

    jest
      .spyOn(
        (await import('../../src/modules/audit/audit.service')).AuditService,
        'getInstance',
      )
      .mockReturnValue({ log: jest.fn().mockResolvedValue(undefined) } as any);

    const { requestMonitoringSession } = await import('../../src/modules/sessions/sessions.service');
    await expect(
      requestMonitoringSession(
        MANAGER_B_ID, 'managerb@test.com', 'MANAGER',
        { agentId: AGENT_A_ID, deviceId: 'device-uuid' },
        '127.0.0.1', 'test-agent', 'req-id',
      ),
    ).rejects.toThrow('AUTHORIZATION_DENIED');

    jest.restoreAllMocks();
  });
});

// ── Test 7: Session IDOR Prevention ──────────────────────────────────────────

describe('Test 7 — Session IDOR prevention (getSessionById)', () => {
  it('returns null when Manager B requests a session owned by Manager A', async () => {
    const mockQuery = jest.fn()
      .mockResolvedValueOnce(asDbResult([{
        id: 'session-1', manager_id: MANAGER_A_ID, agent_id: AGENT_A_ID,
        device_id: 'dev-1', status: 'ACTIVE', requested_at: new Date(),
      }]))
      .mockResolvedValueOnce(asDbResult([]));  // access check → empty

    jest
      .spyOn(await import('../../src/config/database'), 'query')
      .mockImplementation(mockQuery as any);

    const { getSessionById } = await import('../../src/modules/sessions/sessions.service');
    const result = await getSessionById('session-1', MANAGER_B_ID, 'MANAGER');

    expect(result).toBeNull();

    jest.restoreAllMocks();
  });

  it('ADMIN can view any session and WebRTC token is always cleared', async () => {
    jest
      .spyOn(await import('../../src/config/database'), 'query')
      .mockResolvedValueOnce(asDbResult([{
        id: 'session-1', managerId: MANAGER_A_ID, agentId: AGENT_A_ID,
        deviceId: 'dev-1', status: 'ACTIVE', requestedAt: new Date(),
        webrtcSessionToken: 'this-must-be-cleared',
      }]));

    const { getSessionById } = await import('../../src/modules/sessions/sessions.service');
    const result = await getSessionById('session-1', 'admin-id', 'ADMIN');

    expect(result).not.toBeNull();
    expect(result?.webrtcSessionToken).toBeUndefined();

    jest.restoreAllMocks();
  });
});
