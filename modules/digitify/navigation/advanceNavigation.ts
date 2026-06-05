import type { Page } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import { resolveSelector } from '../selectors/advancePage.js';
import { waitForPaymentTableSettled } from './tableSettle.js';

export function resolvePaymentUrl(baseUrl: string): string {
  if (baseUrl.includes('/payment')) return baseUrl;
  return `${baseUrl.replace(/\/$/, '')}/payment`;
}

/**
 * Digitify sometimes shows a landing card on /payment ("click here to go") before the trips grid.
 * Click through so waitForTripsTable can succeed.
 */
export async function dismissPaymentLandingGate(
  page: Page,
  logger: AppLogger,
): Promise<boolean> {
  const candidates: Array<{ label: string; locator: ReturnType<Page['locator']> }> = [
    {
      label: 'click-here-link',
      locator: page.getByRole('link', { name: /click here/i }),
    },
    {
      label: 'click-here-text',
      locator: page.locator('a, button, span[role="button"]').filter({ hasText: /click here/i }).first(),
    },
    {
      label: 'go-link',
      locator: page.getByRole('link', { name: /^go$/i }),
    },
    {
      label: 'continue-button',
      locator: page.getByRole('button', { name: /continue|proceed|go to/i }),
    },
  ];

  for (const { label, locator } of candidates) {
    if (!(await locator.isVisible({ timeout: 1500 }).catch(() => false))) {
      continue;
    }
    logger.info({ action: 'navigate:landing-gate-click', label, url: page.url() });
    await locator.click();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(1_500);
    return true;
  }

  return false;
}

export async function navigateToAdvanceSection(
  page: Page,
  baseUrl: string,
  logger: AppLogger,
): Promise<Result<void, Error>> {
  const paymentUrl = resolvePaymentUrl(baseUrl);
  logger.info({ action: 'navigate:advance-start', paymentUrl, currentUrl: page.url() });

  try {
    if (!page.url().includes('/payment') || page.url() === 'about:blank') {
      await page.goto(paymentUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(2_000);
    }

    await dismissPaymentLandingGate(page, logger);

    const tableDeadline = Date.now() + 30_000;
    while (Date.now() < tableDeadline) {
      const remaining = tableDeadline - Date.now();
      try {
        await waitForTripsTable(page, Math.min(8_000, remaining));
        break;
      } catch {
        if (await dismissPaymentLandingGate(page, logger)) {
          continue;
        }
        if (Date.now() >= tableDeadline) {
          throw new Error(
            `Trips table not visible on ${page.url()}. If you see "click here to go", click it manually in CDP Chrome, wait for the grid, then rerun.`,
          );
        }
        await page.waitForTimeout(1_000);
      }
    }

    logger.info({ action: 'navigate:advance-complete', currentUrl: page.url() });
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Digitify payment grid — ant-table or configured fallback. */
export async function waitForTripsTable(page: Page, timeoutMs: number): Promise<void> {
  const antTable = page.locator('.ant-table-wrapper .ant-table, .ant-table').first();
  if (await antTable.waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => null)) {
    const rowCount = await page.locator('.ant-table-tbody tr.ant-table-row').count();
    if (rowCount > 0) return;
  }
  await resolveSelector(page, 'resultsTable', timeoutMs);
}

export async function applyDateFilters(
  page: Page,
  dateRangeDays: number,
  logger: AppLogger,
): Promise<Result<void, Error>> {
  logger.info({ action: 'filters:apply', dateRangeDays });

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - dateRangeDays);

    const format = (d: Date): string =>
      `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;

    // TODO: date format may differ — check Digitify's date picker format
    const startStr = format(startDate);
    const endStr = format(endDate);

    try {
      const startInput = await resolveSelector(page, 'dateRangeStartInput');
      await startInput.fill(startStr);

      const endInput = await resolveSelector(page, 'dateRangeEndInput');
      await endInput.fill(endStr);
    } catch {
      logger.warn({ action: 'filters:date-inputs-not-found', note: 'Date filter skipped' });
    }

    try {
      const applyBtn = await resolveSelector(page, 'applyFilterButton');
      await applyBtn.click();
      await waitForPaymentTableSettled(page, logger);
    } catch {
      logger.warn({ action: 'filters:apply-button-not-found', note: 'Proceeding without filter apply' });
    }

    logger.info({ action: 'filters:applied', startDate: startStr, endDate: endStr });
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
