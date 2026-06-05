import fs from 'fs/promises';
import path from 'path';

import type { AppLogger } from '../../utils/logger.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';

export async function moveFile(
  source: string,
  destDir: string,
  logger: AppLogger,
): Promise<Result<string, Error>> {
  try {
    await fs.mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, path.basename(source));
    await fs.rename(source, dest);
    logger.info({ action: 'file:move', source, dest });
    return ok(dest);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function copyFile(
  source: string,
  destDir: string,
  destName?: string,
): Promise<Result<string, Error>> {
  try {
    await fs.mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, destName ?? path.basename(source));
    await fs.copyFile(source, dest);
    return ok(dest);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function writeJson(filePath: string, data: unknown): Promise<Result<void, Error>> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function writeText(filePath: string, content: string): Promise<Result<void, Error>> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}
