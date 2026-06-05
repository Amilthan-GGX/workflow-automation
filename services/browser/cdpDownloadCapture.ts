import fs from 'fs/promises';
import path from 'path';

import type { BrowserContext } from 'playwright';

import { waitForFileStable } from '../../modules/digitify/downloads/fileStabilityWatcher.js';
import type { AppLogger } from '../../utils/logger.js';

/** Enable CDP download events + save path (required when connectOverCDP uses noDefaults). */
export async function configureCdpDownloads(
  context: BrowserContext,
  downloadPath: string,
  logger: AppLogger,
): Promise<void> {
  const page = context.pages()[0];
  if (!page) return;

  const resolved = path.resolve(downloadPath);
  await fs.mkdir(resolved, { recursive: true });

  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: resolved,
      eventsEnabled: true,
    });
    logger.info({ action: 'download:cdp-behavior-set', downloadPath: resolved });
  } catch (e) {
    logger.warn({
      action: 'download:cdp-behavior-failed',
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

async function listExcelPaths(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => []);
  const out: string[] = [];
  for (const name of entries) {
    if (!/\.xlsx?$/i.test(name) || name.endsWith('.crdownload')) continue;
    out.push(path.join(dir, name));
  }
  return out;
}

/** Poll dirs for a new Excel file (CDP fallback when Playwright download event does not fire). */
export async function waitForNewDownloadFile(
  dirs: string[],
  excludePaths: ReadonlySet<string>,
  timeoutMs: number,
  logger: AppLogger,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const dir of dirs) {
      for (const full of await listExcelPaths(dir)) {
        if (excludePaths.has(full)) continue;
        try {
          const stat = await fs.stat(full);
          if (stat.size === 0) continue;
          await waitForFileStable(full, 15_000, logger);
          logger.info({ action: 'download:filesystem-captured', path: full, sizeBytes: stat.size });
          return full;
        } catch {
          // still writing
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return null;
}

export async function snapshotExcelPaths(dirs: string[]): Promise<Set<string>> {
  const paths = new Set<string>();
  for (const dir of dirs) {
    for (const p of await listExcelPaths(dir)) {
      paths.add(p);
    }
  }
  return paths;
}
