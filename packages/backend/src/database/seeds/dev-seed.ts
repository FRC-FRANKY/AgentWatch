import { hashPassword } from '../../modules/auth/auth.service';
import { query } from '../../config/database';

const seededUsers = [
  {
    email: 'admin@agentwatch.local',
    displayName: 'System Administrator',
    password: 'Admin123!',
    role: 'ADMIN',
  },
  {
    email: 'manager@agentwatch.local',
    displayName: 'Operations Manager',
    password: 'Manager123!',
    role: 'MANAGER',
  },
  {
    email: 'support@agentwatch.local',
    displayName: 'IT Support Engineer',
    password: 'Support123!',
    role: 'IT_SUPPORT',
  },
  {
    email: 'agent@agentwatch.local',
    displayName: 'Remote Agent',
    password: 'Agent123!',
    role: 'AGENT',
  },
] as const;

async function ensureSeedUsers(): Promise<void> {
  for (const user of seededUsers) {
    const roleResult = await query<{ id: string }>(
      'SELECT id FROM roles WHERE name = $1',
      [user.role],
    );

    const roleId = roleResult.rows[0]?.id;
    if (!roleId) {
      throw new Error(`Role not found for seeded user: ${user.role}`);
    }

    const passwordHash = await hashPassword(user.password);

    await query(
      `INSERT INTO users (
        email,
        display_name,
        employee_id,
        password_hash,
        role_id,
        is_active,
        is_mfa_enabled,
        monitoring_notice_acknowledged,
        must_change_password,
        created_by
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        TRUE,
        FALSE,
        TRUE,
        FALSE,
        NULL
      )
      ON CONFLICT (email) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        password_hash = EXCLUDED.password_hash,
        role_id = EXCLUDED.role_id,
        is_active = TRUE,
        is_mfa_enabled = FALSE,
        monitoring_notice_acknowledged = TRUE,
        must_change_password = FALSE,
        updated_at = NOW()`,
      [
        user.email,
        user.displayName,
        `${user.role.toLowerCase()}-${user.email.split('@')[0]}`,
        passwordHash,
        roleId,
      ],
    );

    console.log(`Seeded user: ${user.email} (${user.role})`);
  }
}

async function main(): Promise<void> {
  await ensureSeedUsers();
  console.log('Development seed completed.');
}

main().catch((error: unknown) => {
  console.error('Failed to seed development users:', error);
  process.exit(1);
});
