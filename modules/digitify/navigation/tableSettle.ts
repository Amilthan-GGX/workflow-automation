import type { Page } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';

/**
 * Wait for the payment grid to finish loading after a filter change.
 * Avoids `networkidle` — Digitify keeps polling so networkidle can take 30s+.
 */
export async function waitForPaymentTableSettled(
  page: Page,
  logger: AppLogger,
  maxMs = 12_000,
): Promise<void> {
  const spinner = page.locator(
    '.ant-spin-spinning, .ant-table-wrapper .ant-spin-spinning, .ant-spin-nested-loading .ant-spin-spinning',
  );
  await spinner.first().waitFor({ state: 'hidden', timeout: maxMs }).catch(() => undefined);

  const tbody = page.locator('.ant-table-tbody').first();
  await tbody.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);

  await page.waitForTimeout(500);
  logger.info({ action: 'table:settled' });
}
