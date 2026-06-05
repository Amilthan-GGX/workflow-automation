import type { Page } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import { waitForPaymentTableSettled } from '../navigation/tableSettle.js';

export interface IdSearchSelectors {
  idColumnTitle: string;
  idFilterTrigger?: string | undefined;
  idSearchInput?: string | undefined;
}

/**
 * Payment page: Id column filter → Search Id → filter to one trip.
 */
export async function searchTripById(
  page: Page,
  tripId: string,
  selectors: IdSearchSelectors,
  logger: AppLogger,
): Promise<Result<void, Error>> {
  const { idColumnTitle, idFilterTrigger, idSearchInput } = selectors;
  logger.info({ action: 'id-search:start', tripId });

  try {
    const trigger = idFilterTrigger
      ? page.locator(idFilterTrigger).first()
      : page
          .locator('th.ant-table-cell')
          .filter({
            has: page.locator('.ant-table-column-title', {
              hasText: new RegExp(
                `^${idColumnTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
                'i',
              ),
            }),
          })
          .locator('.ant-table-filter-trigger')
          .first();

    await trigger.waitFor({ state: 'visible', timeout: 15_000 });

    // Wait for any previously-open filter dropdown to fully close (Ant Design ~200ms CSS transition).
    // The trigger keeps ant-dropdown-open during the fade-out, which fails Playwright's stability check.
    await page
      .locator('.ant-table-filter-dropdown')
      .first()
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .catch(() => undefined);
    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);

    // Fallback to dispatchEvent if direct click is still blocked by an invisible overlay.
    try {
      await trigger.click({ timeout: 8_000 });
    } catch {
      await trigger.dispatchEvent('click');
    }

    const dropdown = page.locator('.ant-table-filter-dropdown:visible').last();
    await dropdown.waitFor({ state: 'visible', timeout: 10_000 });

    const input = idSearchInput
      ? dropdown.locator(idSearchInput).first()
      : dropdown.locator('input[placeholder*="Search Id" i], input.ant-input').first();

    await input.waitFor({ state: 'visible', timeout: 8_000 });
    await input.fill('');
    await input.fill(tripId);
    await input.press('Enter').catch(() => undefined);

    const okButton = dropdown.locator('button.ant-btn-primary').filter({ hasText: /^OK$/i }).first();
    if (await okButton.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await okButton.click();
    }

    await waitForPaymentTableSettled(page, logger, 15_000);

    const row = page.locator('tr.ant-table-row').filter({ hasText: tripId }).first();
    if (!(await row.isVisible({ timeout: 12_000 }).catch(() => false))) {
      return err(new Error(`Trip row not visible after Id search: ${tripId}`));
    }

    logger.info({ action: 'id-search:done', tripId });
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
