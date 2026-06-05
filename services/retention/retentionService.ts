import fs from 'fs/promises';
import path from 'path';

import type { AppLogger } from '../../utils/logger.js';

export interface RetentionPolicy {
  /** Directory to clean */
  dir: string;
  /** Maximum age in days */
  maxAgeDays: number;
  /** File extensions to include, e.g. ['.png', '.zip', '.html'] */
  extensions: string[];
  /** Label for logging */
  label: string;
}

export interface RetentionResult {
  label: string;
  deleted: number;
  freed: number;
  errors: number;
}

async function getFilesOlderThan(dir: string, maxAgeDays: number, extensions: string[]): Promise<string[]> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const files: string[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (extensions.length > 0 && !extensions.includes(ext)) continue;

    const fullPath = path.join(dir, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        files.push(fullPath);
      }
    } catch { /* skip */ }
  }

  return files;
}

export async function applyRetentionPolicy(
  policy: RetentionPolicy,
  logger: AppLogger,
): Promise<RetentionResult> {
  const result: RetentionResult = { label: policy.label, deleted: 0, freed: 0, errors: 0 };

  const stale = await getFilesOlderThan(policy.dir, policy.maxAgeDays, policy.extensions);

  for (const filePath of stale) {
    try {
      const stat = await fs.stat(filePath);
      await fs.unlink(filePath);
      result.deleted++;
      result.freed += stat.size;
    } catch {
      result.errors++;
    }
  }

  if (result.deleted > 0) {
    logger.info({
      action: 'retention:cleaned',
      label: policy.label,
      deleted: result.deleted,
      freedMb: (result.freed / 1024 / 1024).toFixed(2),
    });
  }

  return result;
}

export async function runAllRetentionPolicies(
  policies: RetentionPolicy[],
  logger: AppLogger,
): Promise<RetentionResult[]> {
  return Promise.all(policies.map((p) => applyRetentionPolicy(p, logger)));
}
