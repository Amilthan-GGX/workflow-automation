import type { AppLogger } from '../../utils/logger.js';

type CleanupFn = () => Promise<void>;

const cleanupHandlers: CleanupFn[] = [];
let isShuttingDown = false;

export function registerCleanup(fn: CleanupFn): void {
  cleanupHandlers.push(fn);
}

async function runCleanup(signal: string, logger: AppLogger): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ action: 'shutdown:start', signal, handlers: cleanupHandlers.length });

  const results = await Promise.allSettled(cleanupHandlers.map((fn) => fn()));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

  if (failed.length > 0) {
    failed.forEach((r) => logger.error({ action: 'shutdown:cleanup-error', err: String(r.reason) }));
  }

  logger.info({ action: 'shutdown:complete', signal });
  process.exit(0);
}

export function installShutdownHandlers(logger: AppLogger): void {
  const handler = (signal: string) => (): void => {
    void runCleanup(signal, logger);
  };

  process.on('SIGINT', handler('SIGINT'));
  process.on('SIGTERM', handler('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ action: 'shutdown:uncaught', err: err.message, stack: err.stack });
    void runCleanup('uncaughtException', logger).finally(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ action: 'shutdown:unhandled-rejection', err: String(reason) });
    void runCleanup('unhandledRejection', logger).finally(() => process.exit(1));
  });
}
