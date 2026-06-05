import fs from 'fs/promises';

import type { AppLogger } from '../../../utils/logger.js';

const POLL_INTERVAL_MS = 500;
const STABLE_READS_REQUIRED = 2;

/**
 * Waits until a file's size stops changing for 2 consecutive reads.
 * Guards against incomplete downloads being processed prematurely.
 */
export async function waitForFileStable(
  filePath: string,
  timeoutMs: number,
  logger: AppLogger,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stableCount = 0;
  let lastSize = -1;

  while (Date.now() < deadline) {
    try {
      const stat = await fs.stat(filePath);
      const size = stat.size;

      if (size === lastSize && size > 0) {
        stableCount++;
        if (stableCount >= STABLE_READS_REQUIRED) {
          logger.info({ action: 'download:stable', filePath, sizeBytes: size });
          return;
        }
      } else {
        stableCount = 0;
        lastSize = size;
      }
    } catch {
      // file not yet visible — keep polling
      stableCount = 0;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`File did not stabilize within ${timeoutMs}ms: ${filePath}`);
}
