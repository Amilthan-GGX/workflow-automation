import type { BrowserContext, Page } from 'playwright';

import type { IDigitifyClient, DigitifyAuthStatus, DigitifyDownloadOptions, DigitifyDownloadResult } from '../../contracts/services/IDigitifyClient.js';
import type { AppConfig } from '../../config/schema.js';
import type { AppLogger } from '../../utils/logger.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { SessionManager } from '../../services/browser/sessionManager.js';
import { ScreenshotService } from '../../services/browser/screenshotService.js';
import { validateSession } from './auth/sessionValidator.js';
import { performLogin } from './auth/loginFlow.js';
import { waitForManualLogin } from './auth/manualLogin.js';
import {
  navigateToAdvanceSection,
  applyDateFilters,
  resolvePaymentUrl,
  waitForTripsTable,
  dismissPaymentLandingGate,
} from './navigation/advanceNavigation.js';
import { isLoginUrl } from './auth/manualLogin.js';
import { triggerAndCaptureDownload } from './downloads/downloadManager.js';
import { withRetry } from '../../utils/retry.js';
import { RetryStrategy } from '../../types/enums.js';
import { usesRealChromeSession } from '../../services/browser/chromeProfile.js';

export class DigitifyClient implements IDigitifyClient {
  private readonly config: AppConfig;
  private readonly logger: AppLogger;
  private readonly sessionManager: SessionManager;
  private readonly screenshotService: ScreenshotService;
  private readonly context: BrowserContext;
  private page: Page | null = null;
  private readonly runId: string;

  constructor(
    context: BrowserContext,
    config: AppConfig,
    runId: string,
    logger: AppLogger,
  ) {
    this.context = context;
    this.config = config;
    this.runId = runId;
    this.logger = logger;
    this.sessionManager = new SessionManager(config.browser.sessionPath, logger);
    this.screenshotService = new ScreenshotService(
      `${config.browser.debugPath}/${runId}`,
      { screenshots: config.browser.screenshotsEnabled, traces: config.browser.tracesEnabled },
      logger,
    );
  }

  private async getPage(): Promise<Page> {
    const paymentPath = new URL(this.config.digitify.baseUrl).pathname;
    const onPayment = this.context.pages().filter(
      (p) => !p.isClosed() && p.url().includes(paymentPath),
    );

    if (onPayment.length > 0) {
      this.page = onPayment[onPayment.length - 1]!;
      await this.page.bringToFront().catch(() => undefined);
      await dismissPaymentLandingGate(this.page, this.logger);
      return this.page;
    }

    if (!this.page || this.page.isClosed()) {
      const existing = this.context.pages().filter((p) => !p.isClosed());
      if (existing.length > 0) {
        this.page = existing[existing.length - 1]!;
      } else {
        this.page = await this.context.newPage();
        const paymentUrl = resolvePaymentUrl(this.config.digitify.baseUrl);
        await this.page.goto(paymentUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await this.page.waitForLoadState('networkidle').catch(() => undefined);
      }
    }
    return this.page;
  }

  async login(): Promise<Result<DigitifyAuthStatus, Error>> {
    const page = await this.getPage();
    const { baseUrl, email, password } = this.config.digitify;

    if (usesRealChromeSession(this.config.browser.chromeProfile, this.config.browser.cdpUrl)) {
      const nav = await navigateToAdvanceSection(page, baseUrl, this.logger);
      if (!nav.ok) {
        const paymentUrl = resolvePaymentUrl(baseUrl);
        if (isLoginUrl(page.url(), this.config.digitify.loginUrlPaths)) {
          return err(
            new Error(
              `Not logged in. Open ${paymentUrl} in the CDP Chrome window, sign in, wait for the trips table, then rerun.`,
            ),
          );
        }
        return err(
          new Error(
            `${nav.error.message} Log in at ${paymentUrl} and wait for the table, then rerun.`,
          ),
        );
      }

      try {
        await waitForTripsTable(page, 15_000);
      } catch (e) {
        return err(
          new Error(
            `Trips table not visible after navigation. Log in at ${resolvePaymentUrl(baseUrl)} in CDP Chrome, then rerun.`,
          ),
        );
      }

      return ok({
        authenticated: true,
        email: this.config.digitify.accountEmail ?? this.config.digitify.email ?? 'chrome-profile',
        sessionLoadedFrom: 'chrome',
      });
    }

    // Try existing session first
    if (await this.sessionManager.exists()) {
      const sessionResult = await this.sessionManager.load();
      if (sessionResult.ok) {
        const validationResult = await validateSession(
          page,
          baseUrl,
          this.config.digitify.loginUrlPaths,
          this.logger,
        );
        if (validationResult.valid) {
          return ok({ authenticated: true, email: sessionResult.value.email, sessionLoadedFrom: 'storage' });
        }
        this.logger.warn({ action: 'login:session-invalid', reason: validationResult.reason });
        await this.sessionManager.delete();
      }
    }

    // Manual login in visible browser (no credentials in .env)
    if (!email || !password) {
      if (!this.config.browser.headless) {
        const manualResult = await waitForManualLogin(
          page,
          baseUrl,
          this.config.digitify.loginUrlPaths,
          this.logger,
          this.config.browser.manualLoginTimeoutMs,
        );
        if (!manualResult.ok) {
          return err(manualResult.error);
        }
        const manualEmail =
          this.config.digitify.accountEmail ?? this.config.digitify.email ?? 'manual-login';
        const saveResult = await this.sessionManager.save(this.context, manualEmail);
        if (!saveResult.ok) {
          this.logger.warn({ action: 'login:session-save-failed', err: saveResult.error.message });
        }
        return ok({ authenticated: true, email: manualEmail, sessionLoadedFrom: 'fresh' });
      }
      return err(
        new Error(
          'No valid session found and DIGITIFY_EMAIL / DIGITIFY_PASSWORD not set in .env. ' +
            'Run npm run digitify:uat-download (headed) once to save a session.',
        ),
      );
    }

    const loginResult = await performLogin(page, baseUrl, { email, password }, this.logger);
    if (!loginResult.ok) {
      await this.screenshotService.captureScreenshot(page, 'login-failed', this.runId);
      return err(loginResult.error);
    }

    const saveResult = await this.sessionManager.save(this.context, email);
    if (!saveResult.ok) {
      this.logger.warn({ action: 'login:session-save-failed', err: saveResult.error.message });
    }

    return ok({ authenticated: true, email, sessionLoadedFrom: 'fresh' });
  }

  async navigateToAdvance(): Promise<Result<void, Error>> {
    const page = await this.getPage();
    try {
      return await withRetry(
        () => navigateToAdvanceSection(page, this.config.digitify.baseUrl, this.logger),
        { max: this.config.browser.retryMax, strategy: RetryStrategy.Exponential, baseMs: this.config.browser.retryBaseMs, label: 'navigateToAdvance' },
        this.logger,
      );
    } catch (e) {
      await this.screenshotService.captureScreenshot(page, 'navigate-failed', this.runId);
      await this.screenshotService.captureHtmlSnapshot(page, 'navigate-failed', this.runId);
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async applyFilters(options: DigitifyDownloadOptions): Promise<Result<void, Error>> {
    const page = await this.getPage();
    try {
      return await withRetry(
        () => applyDateFilters(page, options.dateRangeDays, this.logger),
        { max: this.config.browser.retryMax, strategy: RetryStrategy.Fixed, baseMs: this.config.browser.retryBaseMs, label: 'applyFilters' },
        this.logger,
      );
    } catch (e) {
      await this.screenshotService.captureScreenshot(page, 'filters-failed', this.runId);
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async downloadTrips(options: DigitifyDownloadOptions): Promise<Result<DigitifyDownloadResult, Error>> {
    const page = await this.getPage();
    return withRetry(
      () => triggerAndCaptureDownload(
        page,
        {
          tempDir: this.config.storage.tempPath,
          downloadTimeoutMs: this.config.browser.downloadTimeout,
          config: this.config,
        },
        this.logger,
      ),
      { max: 2, strategy: RetryStrategy.Fixed, baseMs: 3000, label: 'downloadTrips' },
      this.logger,
    ).then((result) => {
      if (!result.ok) return result;
      return ok({
        localPath: result.value.localPath,
        originalFilename: result.value.originalFilename,
        downloadedAt: result.value.downloadedAt,
        sizeBytes: result.value.sizeBytes,
      });
    }).catch(async (e: Error) => {
      await this.screenshotService.captureScreenshot(page, 'download-failed', this.runId);
      await this.screenshotService.captureHtmlSnapshot(page, 'download-failed', this.runId);
      await this.screenshotService.saveTrace(this.context, this.runId);
      return err(e);
    });
  }

  // ── Phase 3+ stubs ────────────────────────────────────────────────────────

  /** Active payment-page tab for margin review / search. */
  async getPageForReview(): Promise<Page> {
    return this.getPage();
  }

  async searchTrip(tripId: string): Promise<Result<void, Error>> {
    const page = await this.getPage();
    const { searchTripById } = await import('./marginReview/idColumnSearch.js');
    return searchTripById(
      page,
      tripId,
      {
        idColumnTitle: this.config.digitify.idColumnTitle,
        idFilterTrigger: this.config.digitify.selectorIdFilterTrigger,
        idSearchInput: this.config.digitify.selectorIdSearchInput,
      },
      this.logger,
    );
  }

  async approveTrip(_tripId: string): Promise<Result<void, Error>> {
    return err(new Error('approveTrip not implemented — Phase 3'));
  }

  async rejectTrip(_tripId: string, _reason: string): Promise<Result<void, Error>> {
    return err(new Error('rejectTrip not implemented — Phase 3'));
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    this.page = null;
  }
}
