import type { Page } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import { resolveSelector } from '../selectors/advancePage.js';

export function isLoginUrl(url: string, loginPathFragments: readonly string[]): boolean {
  return loginPathFragments.some((fragment) => url.includes(fragment));
}

/**
 * Opens the payment page and waits for the operator to log in manually
 * (headless=false). Succeeds when the trips table is visible.
 */
export async function waitForManualLogin(
  page: Page,
  paymentUrl: string,
  loginUrlPaths: readonly string[],
  logger: AppLogger,
  timeoutMs: number,
): Promise<Result<void, Error>> {
  logger.info({ action: 'login:manual-wait', paymentUrl, timeoutMs });

  await page.goto(paymentUrl, { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (!isLoginUrl(url, loginUrlPaths)) {
      try {
        await resolveSelector(page, 'resultsTable', 5000);
        logger.info({ action: 'login:manual-success', url });
        return ok(undefined);
      } catch {
        // Payment UI not ready yet
      }
    }
    if (page.isClosed()) {
      return err(new Error('Browser window was closed during manual login.'));
    }
    await page.waitForTimeout(2000);
  }

  return err(
    new Error(
      `Manual login timed out after ${timeoutMs / 1000}s. ` +
        'Log in via the Playwright browser window on the payment page, then retry.',
    ),
  );
}
