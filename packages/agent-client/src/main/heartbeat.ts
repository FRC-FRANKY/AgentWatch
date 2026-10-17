/**
 * Agent Client — Heartbeat Scheduler
 *
 * Sends periodic heartbeats to keep the device status ONLINE.
 * Handles transient network failures gracefully (retries on next interval).
 * On consecutive failures (>3), logs a warning but keeps trying.
 * On permanent failure (401/device disabled), stops and signals for re-enrollment.
 */

import { AgentApiClient, HeartbeatInput } from './api-client';
import { logger } from './logger';

export class HeartbeatScheduler {
  private readonly apiClient: AgentApiClient;
  private readonly deviceToken: string;
  private readonly intervalSeconds: number;
  private readonly getSystemInfo: () => HeartbeatInput;

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;

  constructor(
    apiClient: AgentApiClient,
    deviceToken: string,
    intervalSeconds: number,
    getSystemInfo: () => HeartbeatInput,
  ) {
    this.apiClient = apiClient;
    this.deviceToken = deviceToken;
    this.intervalSeconds = intervalSeconds;
    this.getSystemInfo = getSystemInfo;
  }

  start(): void {
    if (this.intervalHandle) return; // Already started

    const intervalMs = this.intervalSeconds * 1000;

    this.intervalHandle = setInterval(() => {
      void this.sendHeartbeat();
    }, intervalMs);

    logger.info(
      { intervalSeconds: this.intervalSeconds },
      'Heartbeat scheduler started',
    );
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    logger.info('Heartbeat scheduler stopped');
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const info = this.getSystemInfo();
      const result = await this.apiClient.heartbeat(this.deviceToken, info);

      this.consecutiveFailures = 0; // Reset on success

      logger.debug(
        {
          deviceId: result.deviceId,
          status: result.status,
          lastHeartbeatAt: result.lastHeartbeatAt,
          nextHeartbeatSeconds: result.nextHeartbeatSeconds,
        },
        'Heartbeat sent successfully',
      );
    } catch (err) {
      this.consecutiveFailures++;
      const msg = (err as Error).message;

      // Permanent failure: device token rejected (401/device disabled)
      if (
        msg.includes('401') ||
        msg.includes('not found') ||
        msg.includes('disabled') ||
        msg.includes('inactive')
      ) {
        logger.error(
          { consecutiveFailures: this.consecutiveFailures },
          'Device token rejected by backend — stopping heartbeat. Re-enrollment may be required.',
        );
        await this.stop();
        return;
      }

      // Transient failure: log and retry next interval
      if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        logger.warn(
          { consecutiveFailures: this.consecutiveFailures, err: msg },
          'Multiple consecutive heartbeat failures — device may appear OFFLINE to managers',
        );
      } else {
        logger.warn({ consecutiveFailures: this.consecutiveFailures, err: msg }, 'Heartbeat failed');
      }
    }
  }
}
