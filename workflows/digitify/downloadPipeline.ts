import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import type { WorkflowContext } from '../../types/workflow.js';
import { BrowserManager } from '../../services/browser/browserManager.js';
import { SessionManager } from '../../services/browser/sessionManager.js';
import type { BrowserSession } from '../../modules/digitify/types.js';
import { ScreenshotService } from '../../services/browser/screenshotService.js';
import { DigitifyClient } from '../../modules/digitify/digitifyClient.js';
import { makeDownloadCompletedEvent, makeDownloadFailedEvent } from '../../types/events.js';

import { sessionStage } from './stages/session.js';
import { navigateStage } from './stages/navigate.js';
import { downloadStage } from './stages/download.js';

export interface DigitifyDownloadResult {
  localPath: string;
  originalFilename: string;
  sizeBytes: number;
}

export async function runDigitifyDownloadPipeline(
  ctx: WorkflowContext,
): Promise<Result<DigitifyDownloadResult, Error>> {
  const { logger, runId, config } = ctx;

  logger.info({ action: 'digitify-pipeline:start', runId });

  const browserManager = new BrowserManager(
    config.browser,
    logger,
    config.digitify.accountEmail,
  );
  const screenshotService = new ScreenshotService(
    `${config.browser.debugPath}/${runId}`,
    { screenshots: config.browser.screenshotsEnabled, traces: config.browser.tracesEnabled },
    logger,
  );

  let client: DigitifyClient | null = null;

  const sessionManager = new SessionManager(config.browser.sessionPath, logger);
  let savedSession: BrowserSession | undefined;
  const chromeProfile = config.browser.chromeProfile?.trim();
  const cdpUrl = config.browser.cdpUrl?.trim();
  if (!chromeProfile && !cdpUrl && (await sessionManager.exists())) {
    const loaded = await sessionManager.load();
    if (loaded.ok) savedSession = loaded.value;
  }

  const contextResult = await browserManager.acquire(
    savedSession ? { session: savedSession } : {},
  );
  if (!contextResult.ok) {
    return err(new Error(`Failed to launch browser: ${contextResult.error.message}`));
  }

  const browserContext = contextResult.value;
  await screenshotService.startTrace(browserContext, runId);

  try {
    client = new DigitifyClient(browserContext, config, runId, logger);

    // Stage 1: Authenticate
    const sessionResult = await sessionStage(client, ctx);
    if (!sessionResult.ok) {
      await screenshotService.saveTrace(browserContext, runId);
      return err(sessionResult.error);
    }

    // Stage 2: Navigate + filter
    const navResult = await navigateStage(client, ctx);
    if (!navResult.ok) {
      await screenshotService.saveTrace(browserContext, runId);
      return err(navResult.error);
    }

    // Stage 3: Download Excel
    const downloadResult = await downloadStage(client, ctx);
    if (!downloadResult.ok) {
      await screenshotService.saveTrace(browserContext, runId);
      await ctx.eventBus.publish(makeDownloadFailedEvent(runId, downloadResult.error.message)).catch(() => undefined);
      return err(downloadResult.error);
    }

    const { localPath, originalFilename } = downloadResult.value;
    const { size: sizeBytes } = await import('fs/promises')
      .then((fs) => fs.stat(localPath))
      .catch(() => ({ size: 0 }));

    await ctx.eventBus.publish(makeDownloadCompletedEvent(runId, originalFilename, sizeBytes)).catch(() => undefined);

    logger.info({ action: 'digitify-pipeline:complete', runId, localPath, originalFilename, sizeBytes });

    return ok({ localPath, originalFilename, sizeBytes });
  } finally {
    await client?.close();
    await browserManager.release();
  }
}
