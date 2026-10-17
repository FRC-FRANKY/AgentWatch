/**
 * Agent Client — Simple Logger
 *
 * Uses console with structured JSON output (like pino-lite).
 * Keeps the agent client dependency-light.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL: LogLevel = (process.env['LOG_LEVEL'] as LogLevel) ?? 'info';
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function log(level: LogLevel, data: Record<string, unknown> | string, msg?: string): void {
  if (!shouldLog(level)) return;

  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    name: 'agent-client',
  };

  if (typeof data === 'string') {
    entry['msg'] = data;
  } else {
    Object.assign(entry, data);
    if (msg) entry['msg'] = msg;
  }

  const output = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

export const logger = {
  debug: (data: Record<string, unknown> | string, msg?: string) => log('debug', data, msg),
  info: (data: Record<string, unknown> | string, msg?: string) => log('info', data, msg),
  warn: (data: Record<string, unknown> | string, msg?: string) => log('warn', data, msg),
  error: (data: Record<string, unknown> | string, msg?: string) => log('error', data, msg),
};
