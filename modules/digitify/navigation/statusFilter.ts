import type { Page } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import { waitForPaymentTableSettled } from './tableSettle.js';

export interface StatusFilterOptions {
  labels: readonly string[];
  columnTitle: string;
  statusFilterTriggerSelector?: string | undefined;
}

export function isTargetStatus(label: string, allowedLabels: readonly string[]): boolean {
  const normalized = label.trim().toUpperCase();
  return allowedLabels.some((s) => normalized.includes(s.toUpperCase()));
}

/**
 * Opens the Status column filter, checks only configured labels, applies OK.
 */
export async function applyStatusFilter(
  page: Page,
  options: StatusFilterOptions,
  logger: AppLogger,
): Promise<Result<void, Error>> {
  const { labels, columnTitle, statusFilterTriggerSelector } = options;
  logger.info({ action: 'status-filter:start', statuses: labels, columnTitle });

  try {
    const filterTrigger = statusFilterTriggerSelector
      ? page.locator(statusFilterTriggerSelector).first()
      : page
          .locator('th.ant-table-cell')
          .filter({
            has: page.locator('.ant-table-column-title', {
              hasText: new RegExp(`^${columnTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            }),
          })
          .locator('.ant-table-filter-trigger')
          .first();

    await filterTrigger.waitFor({ state: 'visible', timeout: 15_000 });

    // Ant Design reflows column widths during initial table load, making the trigger's
    // bounding box move and failing Playwright's stability check. Wait for the spinner
    // and any open dropdown to settle before clicking.
    const spinner = page.locator(
      '.ant-spin-spinning, .ant-table-wrapper .ant-spin-spinning',
    );
    await spinner.first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
    await page
      .locator('.ant-table-filter-dropdown')
      .first()
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .catch(() => undefined);
    await filterTrigger.scrollIntoViewIfNeeded().catch(() => undefined);

    try {
      await filterTrigger.click({ timeout: 8_000 });
    } catch {
      await filterTrigger.dispatchEvent('click');
    }

    const dropdown = page.locator('.ant-table-filter-dropdown:visible').last();
    await dropdown.waitFor({ state: 'visible', timeout: 10_000 });

    const items = dropdown.locator(
      'label.ant-checkbox-wrapper.ant-checkbox-group-item, label.ant-checkbox-group-item',
    );
    const count = await items.count();

    if (count === 0) {
      return err(new Error('Status filter dropdown has no checkbox options'));
    }

    // Reset first — fewer server round-trips than unchecking every non-target status on a large grid.
    const resetBtn = dropdown
      .locator('a, button, span')
      .filter({ hasText: /^Reset$/i })
      .first();
    if (await resetBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await resetBtn.click();
      logger.info({ action: 'status-filter:reset' });
      await page.waitForTimeout(300);
    }

    let toggled = 0;
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const labelText = ((await item.textContent()) ?? '').trim();
      if (!isTargetStatus(labelText, labels)) continue;

      const input = item.locator('input.ant-checkbox-input');
      const checked = await input.isChecked().catch(() => false);
      if (!checked) {
        await item.click();
        toggled++;
        logger.info({ action: 'status-filter:check', label: labelText });
      }
    }

    if (toggled === 0) {
      for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        const labelText = ((await item.textContent()) ?? '').trim();
        const shouldCheck = isTargetStatus(labelText, labels);
        const input = item.locator('input.ant-checkbox-input');
        const checked = await input.isChecked().catch(() => false);
        if (shouldCheck !== checked) {
          await item.click();
          logger.info({ action: 'status-filter:toggle', label: labelText, checked: shouldCheck });
        }
      }
    }

    const okButton = dropdown
      .locator('button.ant-btn-primary')
      .filter({ hasText: /^OK$/i })
      .first();
    await okButton.click();

    await waitForPaymentTableSettled(page, logger);

    logger.info({ action: 'status-filter:applied', toggled });
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
