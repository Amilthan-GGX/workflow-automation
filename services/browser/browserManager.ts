import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright';

import type { AppConfig } from '../../config/schema.js';
import type { AppLogger } from '../../utils/logger.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import type { BrowserSession } from '../../modules/digitify/types.js';
import {
  assertAllowedChromeProfile,
  resolveChromeUserDataDir,
  usesChromeProfile,
  usesCdp,
} from './chromeProfile.js';

export interface BrowserAcquireOptions {
  /** Ignored when using Chrome profile / CDP — cookies come from the real browser. */
  session?: BrowserSession;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private persistentContext = false;
  private cdpConnected = false;
  private readonly config: AppConfig['browser'];
  private readonly digitifyAccountEmail?: string | undefined;
  private readonly logger: AppLogger;

  constructor(
    config: AppConfig['browser'],
    logger: AppLogger,
    digitifyAccountEmail?: string,
  ) {
    this.config = config;
    this.digitifyAccountEmail = digitifyAccountEmail;
    this.logger = logger;
  }

  async acquire(options: BrowserAcquireOptions = {}): Promise<Result<BrowserContext, Error>> {
    try {
      if (usesCdp(this.config.cdpUrl)) {
        return await this.acquireCdp(options);
      }

      if (usesChromeProfile(this.config.chromeProfile)) {
        return await this.acquireChromeProfile();
      }

      return await this.acquireEphemeral(options);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('already in use') || message.includes('existing browser session')) {
        return err(
          new Error(
            `${message}\n\n` +
              'Chrome is already open. Either:\n' +
              '  1. Quit Chrome, run: npm run chrome:cdp\n' +
              '     Then set BROWSER_CDP_URL=http://127.0.0.1:9222 in .env and rerun, or\n' +
              '  2. Quit Chrome completely and rerun (profile launch mode).',
          ),
        );
      }
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async acquireCdp(_options: BrowserAcquireOptions): Promise<Result<BrowserContext, Error>> {
    const cdpUrl = this.config.cdpUrl!.trim();

    this.logger.info({
      action: 'browser:connect-cdp',
      cdpUrl,
      profileDirectory: this.config.chromeProfile,
      accountEmail: this.digitifyAccountEmail ?? '(not set)',
    });

    // noDefaults: skip setDownloadBehavior — fails on user CDP Chrome reconnect
    this.browser = await chromium.connectOverCDP(cdpUrl, { isLocal: true, noDefaults: true });
    this.cdpConnected = true;

    const contexts = this.browser.contexts();
    if (contexts.length === 0) {
      return err(
        new Error(
          'CDP Chrome has no browser context. Open Digitify in the CDP window, then retry.',
        ),
      );
    }
    this.context = contexts[0]!;

    this.context.setDefaultTimeout(this.config.timeout);
    this.context.setDefaultNavigationTimeout(this.config.timeout);

    this.logger.info({
      action: 'browser:ready',
      mode: 'cdp',
      contextCount: contexts.length,
      pageCount: this.context.pages().length,
    });

    return ok(this.context);
  }

  private async acquireChromeProfile(): Promise<Result<BrowserContext, Error>> {
    const profileDirectory = this.config.chromeProfile!.trim();
    assertAllowedChromeProfile(profileDirectory, this.config.chromeProfileAllowlist);

    const userDataDir = resolveChromeUserDataDir(this.config.chromeUserDataDir);

    this.logger.info({
      action: 'browser:launch-chrome-profile',
      profileDirectory,
      accountEmail: this.digitifyAccountEmail ?? '(not set)',
      userDataDir,
      allowlist: this.config.chromeProfileAllowlist,
      note: 'Quit Google Chrome completely before running (profile lock).',
    });

    this.context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: false,
      slowMo: this.config.slowMo,
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
      args: [
        `--profile-directory=${profileDirectory}`,
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    this.persistentContext = true;
    this.context.setDefaultTimeout(this.config.timeout);
    this.context.setDefaultNavigationTimeout(this.config.timeout);

    this.logger.info({
      action: 'browser:ready',
      mode: 'chrome-profile',
      profileDirectory,
    });

    return ok(this.context);
  }

  private async acquireEphemeral(
    options: BrowserAcquireOptions,
  ): Promise<Result<BrowserContext, Error>> {
    this.logger.info({
      action: 'browser:launch',
      headless: this.config.headless,
      slowMo: this.config.slowMo,
    });

    this.browser = await chromium.launch({
      headless: this.config.headless,
      slowMo: this.config.slowMo,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const storageState = options.session?.storageState as BrowserContextOptions['storageState'];

    this.context = await this.browser.newContext({
      ...(storageState ? { storageState } : {}),
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      acceptDownloads: true,
    });

    this.context.setDefaultTimeout(this.config.timeout);
    this.context.setDefaultNavigationTimeout(this.config.timeout);

    this.logger.info({ action: 'browser:ready', sessionLoaded: !!options.session });
    return ok(this.context);
  }

  async release(): Promise<void> {
    try {
      if (this.cdpConnected) {
        // Drop refs only — do not browser.close(); it can confuse CDP tab attachment on reconnect.
        this.browser = null;
        this.context = null;
        this.cdpConnected = false;
        this.logger.info({ action: 'browser:cdp-disconnected' });
        return;
      }

      await this.context?.close();
      if (!this.persistentContext) {
        await this.browser?.close();
      }
      this.context = null;
      this.browser = null;
      this.persistentContext = false;
      this.logger.info({ action: 'browser:closed' });
    } catch (e) {
      this.logger.warn({ action: 'browser:close-error', err: String(e) });
    }
  }

  getContext(): BrowserContext | null {
    return this.context;
  }
}
