/**
 * Structured logger (#93).
 *
 * Wraps pino with a small indirection so call sites import from
 * `adapters/observability` rather than pino directly. Use this everywhere
 * in the main process instead of console.log.
 */

import pino, { type Logger } from 'pino';

const baseLogger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { app: 'pluribus' },
  redact: {
    paths: ['*.apiKey', '*.password', '*.authorization', 'credentials.*'],
    censor: '[REDACTED]',
  },
});

export const logger = baseLogger;

export function childLogger(bindings: Record<string, unknown>): Logger {
  return baseLogger.child(bindings);
}
