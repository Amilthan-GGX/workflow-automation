import fs from 'fs/promises';
import path from 'path';

import type { Page, BrowserContext } from 'playwright';

import type { AppLogger } from '../../utils/logger.js';

export class ScreenshotService {
  private readonly debugDir: string;
  private readonly screenshotsEnabled: boolean;
  private readonly tracesEnabled: boolean;
  private readonly logger: AppLogger;
  private traceStarted = false;

  constructor(debugDir: string, options: { screenshots: boolean; traces: boolean }, logger: AppLogger) {
    this.debugDir = debugDir;
    this.screenshotsEnabled = options.screenshots;
    this.tracesEnabled = options.traces;
    this.logger = logger;
  }

  async startTrace(context: BrowserContext, runId: string): Promise<void> {
    if (!this.tracesEnabled) return;
    await context.tracing.start({ screenshots: true, snapshots: true, title: runId });
    this.traceStarted = true;
    this.logger.debug({ action: 'trace:started', runId });
  }

  async saveTrace(context: BrowserContext, runId: string): Promise<string | null> {
    if (!this.tracesEnabled || !this.traceStarted) return null;
    await fs.mkdir(this.debugDir, { recursive: true });
    const tracePath = path.join(this.debugDir, `${runId}-trace.zip`);
    await context.tracing.stop({ path: tracePath });
    this.traceStarted = false;
    this.logger.info({ action: 'trace:saved', tracePath });
    return tracePath;
  }

  async captureScreenshot(page: Page, label: string, runId: string): Promise<string | null> {
    if (!this.screenshotsEnabled) return null;
    try {
      await fs.mkdir(this.debugDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = path.join(this.debugDir, `${runId}-${label}-${ts}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      this.logger.info({ action: 'screenshot:captured', label, screenshotPath });
      return screenshotPath;
    } catch (e) {
      this.logger.warn({ action: 'screenshot:failed', label, err: String(e) });
      return null;
    }
  }

  async captureHtmlSnapshot(page: Page, label: string, runId: string): Promise<string | null> {
    try {
      await fs.mkdir(this.debugDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotPath = path.join(this.debugDir, `${runId}-${label}-${ts}.html`);
      const html = await page.content();
      await fs.writeFile(snapshotPath, html, 'utf-8');
      this.logger.info({ action: 'snapshot:captured', label, snapshotPath });
      return snapshotPath;
    } catch (e) {
      this.logger.warn({ action: 'snapshot:failed', label, err: String(e) });
      return null;
    }
  }
}
