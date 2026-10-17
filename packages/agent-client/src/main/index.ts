/**
 * AgentWatch Agent Client — Main Entry Point
 *
 * This daemon runs on the agent's workstation and:
 * 1. Loads configuration from environment / config file
 * 2. Enrolls with the backend using an enrollment token (first run)
 * 3. Authenticates the device using the stored device token
 * 4. Sends periodic heartbeats to maintain ONLINE status
 * 5. Handles graceful shutdown (marks device OFFLINE via session end)
 * 6. Reports real system information (hostname, OS, IP)
 *
 * This is NOT a mock — all communication goes to the real backend API.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import 'dotenv/config';
import { AgentConfig, loadConfig, saveConfig } from './config';
import { AgentApiClient } from './api-client';
import { HeartbeatScheduler } from './heartbeat';
import { AgentSignalingClient } from './signaling-client';
import { logger } from './logger';

// ── Paths ─────────────────────────────────────────────────────────────────────

const CONFIG_PATH = process.env['AGENT_CONFIG_PATH'] ??
  path.join(os.homedir(), '.agentwatch', 'agent-config.json');

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

let heartbeatScheduler: HeartbeatScheduler | null = null;
let signalingClient: AgentSignalingClient | null = null;
let isShuttingDown = false;
let sessionPollInterval: NodeJS.Timeout | null = null;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Agent client shutting down gracefully');

  if (sessionPollInterval) clearInterval(sessionPollInterval);
  if (signalingClient) signalingClient.disconnect();
  if (heartbeatScheduler) await heartbeatScheduler.stop();

  logger.info('Agent client stopped');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// ── Session Monitoring Loop ───────────────────────────────────────────────────

function startSessionPoller(
  apiClient: AgentApiClient,
  deviceToken: string,
  backendUrl: string,
): void {
  const POLL_INTERVAL_MS = 10_000; // Poll every 10 seconds

  sessionPollInterval = setInterval(async () => {
    if (isShuttingDown) return;
    if (signalingClient) return; // Already in a session

    try {
      const pending = await apiClient.getPendingSession(deviceToken);
      if (!pending) return;

      logger.info(
        { sessionId: pending.sessionId, managerId: pending.managerId },
        'Monitoring request received — connecting to signaling server',
      );

      // Accept the session (marks ACTIVE in DB)
      await apiClient.acceptSession(deviceToken, pending.sessionId);

      // Derive WebSocket URL from backend URL
      const wsUrl = backendUrl
        .replace(/^https?/, backendUrl.startsWith('https') ? 'wss' : 'ws')
        .replace(/\/api$/, '') + '/ws/signal';

      signalingClient = new AgentSignalingClient({
        wsUrl,
        sessionId: pending.sessionId,
        webrtcToken: pending.webrtcToken,
        deviceJwt: deviceToken,
        iceServers: pending.iceServers,
        onConnected: () => {
          logger.info({ sessionId: pending.sessionId }, 'WebRTC monitoring session CONNECTED');
        },
        onEnded: (reason) => {
          logger.info({ sessionId: pending.sessionId, reason }, 'Monitoring session ended');
          signalingClient = null;
        },
        onError: (err) => {
          logger.error({ err, sessionId: pending.sessionId }, 'Signaling error');
          signalingClient = null;
        },
      });

      await signalingClient.connect();
    } catch (err) {
      logger.warn({ err }, 'Session poll error');
    }
  }, POLL_INTERVAL_MS);

  logger.info({ pollIntervalSeconds: POLL_INTERVAL_MS / 1000 }, 'Session poller started');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('AgentWatch Agent Client starting…');

  // Step 1: Load or initialise configuration
  let config: AgentConfig = loadConfig(CONFIG_PATH);

  if (!config.backendUrl) {
    logger.error('AGENT_BACKEND_URL is required. Set it in the environment or config file.');
    process.exit(1);
  }

  const apiClient = new AgentApiClient(config.backendUrl);

  // Step 2: Enrollment — first run or missing device token
  if (!config.deviceToken) {
    logger.info('No device token found — starting enrollment…');

    const enrollmentToken = config.enrollmentToken ?? process.env['AGENT_ENROLLMENT_TOKEN'];
    if (!enrollmentToken) {
      logger.error(
        'No AGENT_ENROLLMENT_TOKEN found. ' +
        'Ask your manager to create an enrollment token and set it as AGENT_ENROLLMENT_TOKEN.',
      );
      process.exit(1);
    }

    const hostname = os.hostname();
    const deviceName = process.env['AGENT_DEVICE_NAME'] ?? hostname;
    const osInfo = getOsInfo();

    try {
      logger.info({ hostname, deviceName }, 'Enrolling with backend…');

      const enrollResult = await apiClient.enroll({
        enrollmentToken,
        hostname,
        deviceName,
        macAddress: getMacAddress(),
        osType: osInfo.type,
        osVersion: osInfo.version,
        clientVersion: '1.0.0',
      });

      // Persist the device token for subsequent runs
      config = {
        ...config,
        deviceToken: enrollResult.deviceToken,
        deviceId: enrollResult.deviceId,
        agentUserId: enrollResult.agentUserId,
        managerId: enrollResult.managerId,
        enrollmentToken: undefined, // Clear after use
      };
      saveConfig(CONFIG_PATH, config);

      logger.info(
        { deviceId: enrollResult.deviceId, agentUserId: enrollResult.agentUserId },
        'Enrollment successful',
      );
    } catch (err) {
      logger.error({ err }, 'Enrollment failed');
      process.exit(1);
    }
  }

  // Step 3: Verify device token is still valid via a test heartbeat
  logger.info({ deviceId: config.deviceId }, 'Sending initial heartbeat…');

  const osInfo = getOsInfo();

  try {
    const heartbeatResult = await apiClient.heartbeat(config.deviceToken!, {
      hostname: os.hostname(),
      osType: osInfo.type,
      osVersion: osInfo.version,
      clientVersion: '1.0.0',
    });

    logger.info(
      { deviceId: heartbeatResult.deviceId, status: heartbeatResult.status },
      'Device is now ONLINE',
    );
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    if (msg.includes('401') || msg.includes('not found') || msg.includes('inactive')) {
      logger.warn('Device token rejected — clearing token and re-enrolling on next start');
      config = { ...config, deviceToken: undefined };
      saveConfig(CONFIG_PATH, config);
    }
    logger.error({ err }, 'Initial heartbeat failed — retrying on next interval');
  }

  // Step 4: Start heartbeat scheduler
  const intervalSeconds = parseInt(process.env['AGENT_HEARTBEAT_INTERVAL_SECONDS'] ?? '30', 10);

  heartbeatScheduler = new HeartbeatScheduler(
    apiClient,
    config.deviceToken!,
    intervalSeconds,
    () => ({
      hostname: os.hostname(),
      osType: osInfo.type,
      osVersion: osInfo.version,
      clientVersion: '1.0.0',
    }),
  );

  heartbeatScheduler.start();

  // Step 5: Start monitoring session poller
  startSessionPoller(apiClient, config.deviceToken!, config.backendUrl);

  logger.info(
    { intervalSeconds, deviceId: config.deviceId },
    'AgentWatch Agent Client is running — heartbeat active, monitoring ready',
  );
}


// ── System Information Helpers ────────────────────────────────────────────────

function getOsInfo(): { type: string; version: string } {
  return {
    type: os.platform(),
    version: `${os.type()} ${os.release()}`,
  };
}

function getMacAddress(): string | undefined {
  try {
    const nets = os.networkInterfaces();
    for (const ifaces of Object.values(nets)) {
      if (!ifaces) continue;
      for (const iface of ifaces) {
        // Skip loopback and internal interfaces
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          return iface.mac;
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  logger.error({ err }, 'Agent client crashed');
  process.exit(1);
});
