import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

import type { Page } from 'playwright';

import type { AppConfig } from '../../../config/schema.js';
import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import { usesCdp } from '../../../services/browser/chromeProfile.js';
import {
  configureCdpDownloads,
  snapshotExcelPaths,
  waitForNewDownloadFile,
} from '../../../services/browser/cdpDownloadCapture.js';
import { resolveSelector } from '../selectors/advancePage.js';
import { applyStatusFilter } from '../navigation/statusFilter.js';
import { waitForPaymentTableSettled } from '../navigation/tableSettle.js';
import { clickDataIcon } from './clickDataIcon.js';
import { waitForFileStable } from './fileStabilityWatcher.js';

export interface DownloadManagerOptions {
  tempDir: string;
  downloadTimeoutMs: number;
  config: AppConfig;
}

export interface DownloadedFile {
  localPath: string;
  originalFilename: string;
  sizeBytes: number;
  downloadedAt: string;
}

export async function triggerAndCaptureDownload(
  page: Page,
  options: DownloadManagerOptions,
  logger: AppLogger,
): Promise<Result<DownloadedFile, Error>> {
  logger.info({ action: 'download:start', tempDir: options.tempDir });

  const tempDir = path.resolve(options.tempDir);
  await fs.mkdir(tempDir, { recursive: true });

  const { digitify, browser } = options.config;
  const watchDirs = [tempDir];
  if (usesCdp(browser.cdpUrl)) {
    await configureCdpDownloads(page.context(), tempDir, logger);
  }
  const existingFiles = await snapshotExcelPaths(watchDirs);

  try {
    const filterOptions: Parameters<typeof applyStatusFilter>[1] = {
      labels: digitify.statusFilterLabels,
      columnTitle: digitify.statusColumnTitle,
    };
    if (digitify.selectorStatusFilterTrigger) {
      filterOptions.statusFilterTriggerSelector = digitify.selectorStatusFilterTrigger;
    }
    const filterResult = await applyStatusFilter(page, filterOptions, logger);
    if (!filterResult.ok) {
      return err(new Error(`Status filter failed: ${filterResult.error.message}`));
    }

    await page.keyboard.press('Escape').catch(() => undefined);
    await waitForPaymentTableSettled(page, logger);

    // Step 1: toolbar file-pdf — opens export dialog
    const toolbarPdf = page
      .locator('svg[data-icon="file-pdf"]')
      .filter({ hasNot: page.locator('.ant-modal') });
    const pdfOnPage =
      (await toolbarPdf.count()) > 0
        ? toolbarPdf.first()
        : page.locator(digitify.selectorExportButton).first();

    await pdfOnPage.scrollIntoViewIfNeeded().catch(() => undefined);
    if (await pdfOnPage.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pdfOnPage.click();
    } else {
      await clickDataIcon(page, 'file-pdf', digitify.selectorExportButton, 'exportButton');
    }
    logger.info({ action: 'download:export-dialog-opened' });

    // Step 2: wait for dialog, then download icon inside it
    const dialog = page.locator(digitify.selectorExportDialog).last();
    await dialog.waitFor({ state: 'visible', timeout: 20_000 });

    const downloadPromise = page.context().waitForEvent('download', {
      timeout: options.downloadTimeoutMs,
    });

    const fsWaitPromise = waitForNewDownloadFile(
      watchDirs,
      existingFiles,
      options.downloadTimeoutMs,
      logger,
    );

    await clickDataIcon(
      page,
      'download',
      digitify.selectorDownloadMenuButton,
      'downloadMenuButton',
      dialog,
    );
    logger.info({ action: 'download:dialog-download-clicked' });

    try {
      const confirmBtn = dialog
        .locator('button.ant-btn-primary')
        .filter({ hasText: /^OK$|^Download$|^Export$/i })
        .first();
      if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await confirmBtn.click();
        logger.info({ action: 'download:confirmed' });
      }
    } catch {
      // optional confirm
    }

    type CaptureResult =
      | { source: 'playwright'; download: Awaited<typeof downloadPromise> }
      | { source: 'filesystem'; path: string };

    const captured = await Promise.race([
      downloadPromise.then((download) => ({ source: 'playwright' as const, download })),
      fsWaitPromise.then((fsPath) =>
        fsPath ? { source: 'filesystem' as const, path: fsPath } : new Promise<CaptureResult>(() => {}),
      ),
    ]).catch(() => null);

    let finalPath: string;
    let originalFilename: string;

    if (captured?.source === 'playwright') {
      const download = captured.download;
      originalFilename = download.suggestedFilename();
      logger.info({ action: 'download:intercepted', originalFilename });

      const uniqueName = `${crypto.randomUUID()}_${originalFilename}`;
      const partPath = path.join(tempDir, `${uniqueName}.part`);
      finalPath = path.join(tempDir, uniqueName);

      await download.saveAs(partPath);
      await waitForFileStable(partPath, 10_000, logger);
      await fs.rename(partPath, finalPath);
    } else if (captured?.source === 'filesystem') {
      originalFilename = path.basename(captured.path);
      const uniqueName = `${crypto.randomUUID()}_${originalFilename}`;
      finalPath = path.join(tempDir, uniqueName);
      await fs.rename(captured.path, finalPath);
      logger.info({ action: 'download:filesystem-fallback', originalFilename, finalPath });
    } else {
      return err(
        new Error(
          `Download timed out after ${options.downloadTimeoutMs}ms — no Playwright download event and no .xlsx in ${tempDir}`,
        ),
      );
    }

    const stat = await fs.stat(finalPath);

    if (stat.size === 0) {
      await fs.unlink(finalPath).catch(() => undefined);
      return err(new Error('Downloaded file is empty — download may have failed silently'));
    }

    const downloadedAt = new Date().toISOString();
    logger.info({ action: 'download:complete', finalPath, sizeBytes: stat.size, originalFilename });

    return ok({
      localPath: finalPath,
      originalFilename,
      sizeBytes: stat.size,
      downloadedAt,
    });
  } catch (e) {
    const partFiles = (await fs.readdir(tempDir).catch(() => [])).filter((f) => f.endsWith('.part'));
    await Promise.all(partFiles.map((f) => fs.unlink(path.join(tempDir, f)).catch(() => undefined)));

    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
