/**
 * shared/types/device.types.ts
 */

export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'DISABLED' | 'UNREGISTERED';

export interface DeviceSummary {
  id: string;
  deviceName: string;
  hostname: string;
  macAddress?: string | null;
  agentUserId: string;
  status: DeviceStatus;
  lastHeartbeatAt?: Date | null;
  lastSeenIp?: string | null;
  osType?: string | null;
  osVersion?: string | null;
  clientVersion?: string | null;
  isActive: boolean;
  registeredAt?: Date | null;
  updatedAt?: Date;
}

export interface RegisterDeviceInput {
  agentUserId: string;
  deviceName: string;
  hostname: string;
  macAddress?: string | null;
  osType?: string | null;
  osVersion?: string | null;
  clientVersion?: string | null;
  notes?: string | null;
}

export interface HeartbeatDeviceInput {
  hostname?: string | null;
  osType?: string | null;
  osVersion?: string | null;
  clientVersion?: string | null;
}

export interface RegisterDeviceResult {
  deviceId: string;
  deviceSecret: string;
  registrationToken: string;
  deviceToken: string;
  status: DeviceStatus;
}

export interface HeartbeatResult {
  deviceId: string;
  status: 'ONLINE';
  lastHeartbeatAt: string;
  nextHeartbeatSeconds: number;
}
