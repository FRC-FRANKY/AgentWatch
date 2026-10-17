/**
 * modules/devices/devices.service.ts — Device registration and heartbeat
 *
 * SECURITY:
 * - Device secret is hashed with Argon2id before storage.
 * - Device JWT is issued with a dedicated DEVICE_JWT_SECRET.
 * - Heartbeat updates are rate-limited and tied to the authenticated device ID.
 * - Registering a device requires an explicit IT_SUPPORT or ADMIN action.
 * - No raw screen data or keystrokes are collected or logged.
 */

import crypto from 'crypto';
import jwt, { type Secret } from 'jsonwebtoken';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AuditService } from '../audit/audit.service';
import { setDevicePresence, setDeviceOffline } from '../../config/firebase';
import type { DeviceJwtPayload } from '../../shared/types/auth.types';
import type {
  DeviceSummary,
  HeartbeatDeviceInput,
  HeartbeatResult,
  RegisterDeviceInput,
  RegisterDeviceResult,
} from '../../shared/types/device.types';

const DEVICE_SECRET_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

type DeviceRow = DeviceSummary & Record<string, unknown>;

function issueDeviceToken(deviceId: string, agentUserId: string, hostname: string): string {
  return jwt.sign(
    {
      device_id: deviceId,
      agent_user_id: agentUserId,
      hostname,
    } satisfies DeviceJwtPayload,
    env.DEVICE_JWT_SECRET as Secret,
    {
      expiresIn: '24h',
      issuer: 'agentwatch',
      audience: 'agentwatch-device',
    },
  );
}

export function verifyDeviceToken(token: string): DeviceJwtPayload {
  return jwt.verify(token, env.DEVICE_JWT_SECRET as Secret, {
    issuer: 'agentwatch',
    audience: 'agentwatch-device',
  }) as DeviceJwtPayload;
}

export async function listDevicesForView(userRole: string, userId: string): Promise<DeviceSummary[]> {
  if (userRole === 'ADMIN') {
    const result = await query<DeviceRow>(
      `SELECT id, device_name AS "deviceName", hostname, mac_address AS "macAddress",
              agent_user_id AS "agentUserId", status, last_heartbeat_at AS "lastHeartbeatAt",
              last_seen_ip AS "lastSeenIp", os_type AS "osType", os_version AS "osVersion",
              client_version AS "clientVersion", is_active AS "isActive",
              registered_at AS "registeredAt", updated_at AS "updatedAt"
       FROM devices
       WHERE is_active = TRUE
       ORDER BY last_heartbeat_at DESC NULLS LAST, created_at DESC`,
      [],
    );
    return result.rows;
  }

  if (userRole === 'IT_SUPPORT') {
    const result = await query<DeviceRow>(
      `SELECT id, device_name AS "deviceName", hostname, mac_address AS "macAddress",
              agent_user_id AS "agentUserId", status, last_heartbeat_at AS "lastHeartbeatAt",
              last_seen_ip AS "lastSeenIp", os_type AS "osType", os_version AS "osVersion",
              client_version AS "clientVersion", is_active AS "isActive",
              registered_at AS "registeredAt", updated_at AS "updatedAt"
       FROM devices
       WHERE is_active = TRUE
       ORDER BY last_heartbeat_at DESC NULLS LAST, created_at DESC`,
      [],
    );
    return result.rows;
  }

  const result = await query<DeviceRow>(
    `SELECT id, device_name AS "deviceName", hostname, mac_address AS "macAddress",
            agent_user_id AS "agentUserId", status, last_heartbeat_at AS "lastHeartbeatAt",
            last_seen_ip AS "lastSeenIp", os_type AS "osType", os_version AS "osVersion",
            client_version AS "clientVersion", is_active AS "isActive",
            registered_at AS "registeredAt", updated_at AS "updatedAt"
     FROM devices
     WHERE agent_user_id = $1 AND is_active = TRUE
     ORDER BY updated_at DESC`,
    [userId],
  );

  return result.rows;
}

export async function registerDevice(
  input: RegisterDeviceInput,
  registeredById: string,
  registeredByEmail: string,
  registeredByRole: string,
  sourceIp: string,
  userAgent: string,
  requestId: string,
): Promise<RegisterDeviceResult> {
  const agentResult = await query<{ id: string; role_name: string; is_active: boolean }>(
    `SELECT u.id, r.name AS role_name, u.is_active
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [input.agentUserId],
  );

  const agent = agentResult.rows[0];
  if (!agent || !agent.is_active) {
    throw new Error('Invalid agent user');
  }
  if (agent.role_name !== 'AGENT') {
    throw new Error('Only AGENT users may be assigned a device');
  }

  const existing = await query<{ id: string }>(
    `SELECT id FROM devices WHERE agent_user_id = $1 AND is_active = TRUE`,
    [input.agentUserId],
  );

  if (existing.rows.length > 0) {
    throw new Error('This agent already has an active registered device');
  }

  const deviceId = uuidv4();
  const deviceSecret = crypto.randomBytes(32).toString('hex');
  const registrationToken = crypto.randomBytes(32).toString('hex');
  const deviceSecretHash = await argon2.hash(deviceSecret, DEVICE_SECRET_OPTIONS);
  const deviceToken = issueDeviceToken(deviceId, input.agentUserId, input.hostname);

  await query(
    `INSERT INTO devices (
      id, device_name, hostname, mac_address, agent_user_id, registration_token,
      device_secret_hash, status, last_heartbeat_ip, os_type, os_version,
      client_version, is_active, notes, registered_at, registered_by,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, 'OFFLINE', $8, $9, $10, $11, TRUE,
      $12, NOW(), $13, NOW(), NOW()
    )`,
    [
      deviceId,
      input.deviceName,
      input.hostname,
      input.macAddress ?? null,
      input.agentUserId,
      registrationToken,
      deviceSecretHash,
      sourceIp,
      input.osType ?? null,
      input.osVersion ?? null,
      input.clientVersion ?? null,
      input.notes ?? null,
      registeredById,
    ],
  );

  await AuditService.getInstance().log({
    action: 'DEVICE_REGISTERED',
    actorId: registeredById,
    actorEmail: registeredByEmail,
    actorRole: registeredByRole,
    targetId: deviceId,
    targetType: 'DEVICE',
    details: {
      agentUserId: input.agentUserId,
      hostname: input.hostname,
      deviceName: input.deviceName,
    },
    sourceIp,
    userAgent,
    requestId,
  });

  logger.info({ deviceId, agentUserId: input.agentUserId }, 'Device registered');

  return {
    deviceId,
    deviceSecret,
    registrationToken,
    deviceToken,
    status: 'OFFLINE',
  };
}

export async function heartbeatDevice(
  deviceToken: string,
  sourceIp: string,
  dto: HeartbeatDeviceInput,
): Promise<HeartbeatResult> {
  const payload = verifyDeviceToken(deviceToken);

  const result = await query<{ id: string; status: string; hostname: string; is_active: boolean }>(
    `SELECT id, status, hostname, is_active
     FROM devices
     WHERE id = $1 AND agent_user_id = $2 AND is_active = TRUE`,
    [payload.device_id, payload.agent_user_id],
  );

  const device = result.rows[0];
  if (!device) {
    throw new Error('Device not found or inactive');
  }

  if (device.status === 'DISABLED') {
    throw new Error('Device is disabled');
  }

  const heartbeatAt = new Date();

  await query(
    `UPDATE devices
     SET status = 'ONLINE',
         last_heartbeat_at = $2,
         last_heartbeat_ip = $3,
         last_seen_ip = $3,
         hostname = COALESCE($4, hostname),
         os_type = COALESCE($5, os_type),
         os_version = COALESCE($6, os_version),
         client_version = COALESCE($7, client_version),
         updated_at = NOW()
     WHERE id = $1`,
    [
      device.id,
      heartbeatAt,
      sourceIp,
      dto.hostname ?? payload.hostname,
      dto.osType ?? null,
      dto.osVersion ?? null,
      dto.clientVersion ?? null,
    ],
  );

  logger.info({ deviceId: device.id, agentUserId: payload.agent_user_id }, 'Device heartbeat received');

  // Write real-time presence to Firebase (fire-and-forget — non-critical)
  void setDevicePresence(device.id, {
    online: true,
    agentUserId: payload.agent_user_id,
    lastSeen: heartbeatAt.getTime(),
    sessionId: null,  // Updated when a monitoring session starts
  });

  return {
    deviceId: device.id,
    status: 'ONLINE',
    lastHeartbeatAt: heartbeatAt.toISOString(),
    nextHeartbeatSeconds: env.DEVICE_HEARTBEAT_INTERVAL_SECONDS,
  };
}

/**
 * Mark a device as OFFLINE in both PostgreSQL and Firebase.
 * Called by the stale-device scheduler.
 */
export async function markDeviceOffline(deviceId: string): Promise<void> {
  await query(
    `UPDATE devices SET status = 'OFFLINE', updated_at = NOW() WHERE id = $1`,
    [deviceId],
  );
  void setDeviceOffline(deviceId);
  logger.info({ deviceId }, 'Device marked OFFLINE');
}
