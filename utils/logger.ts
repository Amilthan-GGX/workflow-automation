import pino from 'pino';

import { getConfig } from '../config/index.js';

const config = getConfig();

const transport =
  config.nodeEnv === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined;

const rootLogger = pino(
  {
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    base: {
      service: 'advance-payment-orchestrator',
      version: config.appVersion,
    },
  },
  transport
    ? pino.transport(transport)
    : pino.destination({
        dest: `./logs/app.log`,
        sync: false,
      }),
);

export type AppLogger = pino.Logger;

export function createLogger(module: string): AppLogger {
  return rootLogger.child({ module });
}

export function createRunLogger(module: string, runId: string): AppLogger {
  return rootLogger.child({ module, runId });
}

export { rootLogger };
