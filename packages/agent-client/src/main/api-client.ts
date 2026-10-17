/**
 * Agent Client — Backend API Client
 *
 * All backend communication flows through this module.
 * Uses axios for HTTP requests. The device JWT is used for heartbeat endpoints.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from './logger';

export interface EnrollInput {
  enrollmentToken: string;
  hostname: string;
  deviceName: string;
  macAddress?: string;
  osType?: string;
  osVersion?: string;
  clientVersion?: string;
}

export interface EnrollResult {
  deviceId: string;
  deviceToken: string;
  agentUserId: string;
  managerId: string;
  message: string;
}

export interface HeartbeatInput {
  hostname?: string;
  osType?: string;
  osVersion?: string;
  clientVersion?: string;
}

export interface HeartbeatResult {
  deviceId: string;
  status: 'ONLINE';
  lastHeartbeatAt: string;
  nextHeartbeatSeconds: number;
}

export class AgentApiClient {
  private readonly http: AxiosInstance;

  constructor(backendUrl: string) {
    this.http = axios.create({
      baseURL: backendUrl,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Enrolls the agent using a one-time enrollment token.
   * Called only once (or when device token is missing/revoked).
   */
  async enroll(input: EnrollInput): Promise<EnrollResult> {
    try {
      const response = await this.http.post<EnrollResult>('/agents/enroll', {
        enrollmentToken: input.enrollmentToken,
        hostname: input.hostname,
        deviceName: input.deviceName,
        macAddress: input.macAddress,
        osType: input.osType,
        osVersion: input.osVersion,
        clientVersion: input.clientVersion,
      });
      return response.data;
    } catch (err) {
      const msg = extractErrorMessage(err);
      logger.error({ err: msg }, 'Enrollment request failed');
      throw new Error(msg);
    }
  }

  /**
   * Sends a heartbeat to maintain ONLINE status.
   * Uses the device JWT for authentication (not the user JWT).
   */
  async heartbeat(deviceToken: string, input: HeartbeatInput): Promise<HeartbeatResult> {
    try {
      const response = await this.http.post<HeartbeatResult>(
        '/devices/heartbeat',
        {
          hostname: input.hostname,
          osType: input.osType,
          osVersion: input.osVersion,
          clientVersion: input.clientVersion,
        },
        {
          headers: { Authorization: `Bearer ${deviceToken}` },
        },
      );
      return response.data;
    } catch (err) {
      const msg = extractErrorMessage(err);
      throw new Error(msg);
    }
  }
  /**
   * Checks whether the backend has a pending monitoring session for this device.
   * The agent polls this periodically to detect monitoring requests.
   */
  async getPendingSession(deviceToken: string): Promise<PendingSessionResult | null> {
    try {
      const response = await this.http.get<PendingSessionResult | null>(
        '/devices/session',
        { headers: { Authorization: `Bearer ${deviceToken}` } },
      );
      return response.data;
    } catch (err) {
      // 404 = no pending session — normal case
      if (err instanceof AxiosError && err.response?.status === 404) return null;
      logger.warn({ err: extractErrorMessage(err) }, 'getPendingSession error');
      return null;
    }
  }

  /**
   * Accepts a monitoring session (agent side).
   * Returns the WebRTC session token and TURN config needed for signaling.
   */
  async acceptSession(
    deviceToken: string,
    sessionId: string,
  ): Promise<AcceptSessionResult> {
    const response = await this.http.post<AcceptSessionResult>(
      `/devices/session/${sessionId}/accept`,
      {},
      { headers: { Authorization: `Bearer ${deviceToken}` } },
    );
    return response.data;
  }
}

export interface PendingSessionResult {
  sessionId: string;
  managerId: string;
  webrtcToken: string;
  iceServers: RTCIceServer[];
}

export interface AcceptSessionResult {
  sessionId: string;
  webrtcToken: string;
  iceServers: RTCIceServer[];
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as { error?: string; message?: string } | undefined;
    return data?.error ?? data?.message ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

