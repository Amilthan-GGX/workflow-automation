import type { Page } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';
import { resolveSelector } from '../selectors/advancePage.js';
import { isLoginUrl } from './manualLogin.js';
import { waitForTripsTable } from '../navigation/advanceNavigation.js';

export interface SessionValidationResult {
  valid: boolean;
  reason?: string;
}

export async function validateSession(
  page: Page,
  baseUrl: string,
  loginUrlPaths: readonly string[],
  logger: AppLogger,
): Promise<SessionValidationResult> {
  logger.info({ action: 'session:validate', baseUrl });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const currentUrl = page.url();

    if (isLoginUrl(currentUrl, loginUrlPaths)) {
      logger.warn({ action: 'session:expired', redirectedTo: currentUrl });
      return { valid: false, reason: 'Redirected to login — session expired' };
    }

    const paymentPath = new URL(baseUrl).pathname;
    if (paymentPath && currentUrl.includes(paymentPath)) {
      try {
        await waitForTripsTable(page, 30_000);
        logger.info({ action: 'session:valid', currentUrl, signal: 'resultsTable' });
        return { valid: true };
      } catch {
        return { valid: false, reason: 'Payment page loaded but trips table not found' };
      }
    }

    try {
      await resolveSelector(page, 'userAvatarOrMenu', 3000);
      logger.info({ action: 'session:valid', currentUrl });
      return { valid: true };
    } catch {
      return { valid: false, reason: 'User menu not visible — session likely expired' };
    }
  } catch (e) {
    return { valid: false, reason: `Navigation failed: ${String(e)}` };
  }
}
