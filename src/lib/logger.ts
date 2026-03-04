/**
 * Structured logger utility.
 *
 * Usage:
 *   import { createLogger } from '@/lib/logger';
 *   const log = createLogger('Prices API');
 *   log.info('Fetched prices', { count: 5 });
 *   log.error('Failed to fetch', error);
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

const isServer = typeof window === 'undefined';
const isDev = process.env.NODE_ENV !== 'production';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = isDev ? 'debug' : 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatServer(level: LogLevel, context: string, message: string, data?: unknown): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ctx: context,
    msg: message,
  };
  if (data !== undefined) {
    if (data instanceof Error) {
      entry.error = { message: data.message, stack: data.stack };
    } else {
      entry.data = data;
    }
  }
  return JSON.stringify(entry);
}

function logClient(level: LogLevel, context: string, message: string, data?: unknown): void {
  const prefix = `[${context}]`;
  const method = level === 'debug' ? 'log' : level;
  if (data !== undefined) {
    console[method](prefix, message, data);
  } else {
    console[method](prefix, message);
  }
}

function logServer(level: LogLevel, context: string, message: string, data?: unknown): void {
  const formatted = formatServer(level, context, message, data);
  const method = level === 'debug' ? 'log' : level;
  console[method](formatted);
}

export function createLogger(context: string): Logger {
  const emit = isServer ? logServer : logClient;

  return {
    debug(message: string, data?: unknown) {
      if (shouldLog('debug')) emit('debug', context, message, data);
    },
    info(message: string, data?: unknown) {
      if (shouldLog('info')) emit('info', context, message, data);
    },
    warn(message: string, data?: unknown) {
      if (shouldLog('warn')) emit('warn', context, message, data);
    },
    error(message: string, data?: unknown) {
      if (shouldLog('error')) emit('error', context, message, data);
    },
  };
}
