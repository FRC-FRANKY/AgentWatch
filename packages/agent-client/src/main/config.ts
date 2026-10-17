/**
 * Agent Client — Configuration Management
 *
 * Configuration is loaded from (in order of priority):
 * 1. Environment variables
 * 2. Config file (~/.agentwatch/agent-config.json)
 * 3. Defaults
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AgentConfig {
  /** Backend API base URL. Example: http://localhost:4000/api */
  backendUrl: string;

  /** One-time enrollment token (from manager). Cleared after use. */
  enrollmentToken?: string;

  /** Device JWT issued by backend after enrollment. Persisted. */
  deviceToken?: string;

  /** Device UUID (from backend). Persisted after enrollment. */
  deviceId?: string;

  /** Agent user UUID (from backend). Persisted after enrollment. */
  agentUserId?: string;

  /** Manager UUID who owns this agent. Persisted after enrollment. */
  managerId?: string;
}

/**
 * Loads configuration from env vars and/or the config file.
 * Environment variables take precedence over the config file.
 */
export function loadConfig(configPath: string): AgentConfig {
  let fileConfig: Partial<AgentConfig> = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(raw) as Partial<AgentConfig>;
    } catch {
      // Corrupt config — ignore and use env only
      fileConfig = {};
    }
  }

  // Env vars override file values
  const config: AgentConfig = {
    backendUrl:
      process.env['AGENT_BACKEND_URL'] ??
      fileConfig.backendUrl ??
      'http://localhost:4000/api',

    enrollmentToken:
      process.env['AGENT_ENROLLMENT_TOKEN'] ??
      fileConfig.enrollmentToken,

    deviceToken:
      process.env['AGENT_DEVICE_TOKEN'] ??
      fileConfig.deviceToken,

    deviceId: fileConfig.deviceId,
    agentUserId: fileConfig.agentUserId,
    managerId: fileConfig.managerId,
  };

  return config;
}

/**
 * Saves configuration to disk.
 * Creates the directory if it does not exist.
 * Writes atomically via a temp file to prevent corruption.
 */
export function saveConfig(configPath: string, config: AgentConfig): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = `${configPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmp, configPath);
}
