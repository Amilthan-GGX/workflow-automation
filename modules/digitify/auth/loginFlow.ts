import type { Page } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import { resolveSelector, SelectorResolutionError } from '../selectors/advancePage.js';
import { AutomationErrorType } from '../../../types/enums.js';

export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Performs interactive login flow.
 * Called when no valid session exists.
 *
 * In headless=false mode: fills credentials and submits.
 * In headless=true mode: requires pre-saved session (errors if no credentials set).
 */
export async function performLogin(
  page: Page,
  baseUrl: string,
  credentials: LoginCredentials,
  logger: AppLogger,
): Promise<Result<void, Error>> {
  logger.info({ action: 'login:start', email: credentials.email });

  try {
    // Navigate to login page
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' }); // TODO: confirm login path

    // Fill email
    const emailInput = await resolveSelector(page, 'loginEmailInput');
    await emailInput.fill(credentials.email);

    // Fill password
    const passwordInput = await resolveSelector(page, 'loginPasswordInput');
    await passwordInput.fill(credentials.password);

    logger.info({ action: 'login:credentials-filled' });

    // Submit
    const submitButton = await resolveSelector(page, 'loginSubmitButton');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => undefined),
      submitButton.click(),
    ]);

    // Check for login error
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      // Try to read the error message
      let errorMessage = 'Login failed — still on login page after submit';
      try {
        const errorEl = await resolveSelector(page, 'loginErrorMessage', 2000);
        errorMessage = await errorEl.textContent() ?? errorMessage;
      } catch {
        // no visible error element — use default message
      }

      logger.error({ action: 'login:failed', reason: errorMessage });
      return err(
        Object.assign(new Error(errorMessage), { automationType: AutomationErrorType.AuthFailed }),
      );
    }

    logger.info({ action: 'login:success', landedOn: currentUrl });
    return ok(undefined);
  } catch (e) {
    if (e instanceof SelectorResolutionError) {
      return err(e);
    }
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
