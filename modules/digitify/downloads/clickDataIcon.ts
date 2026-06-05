import type { Locator, Page } from 'playwright';

import { resolveSelector, type SelectorKey } from '../selectors/advancePage.js';

/**
 * Clicks Ant Design toolbar icons (often span.anticon + svg[data-icon], not button).
 */
export async function clickDataIcon(
  page: Page,
  dataIcon: string,
  envSelector: string,
  fallbackKey: SelectorKey,
  scope?: Locator,
): Promise<void> {
  const root = scope ?? page;

  const tryClick = async (selector: string, timeoutMs: number): Promise<boolean> => {
    const loc = root.locator(selector).first();
    if (!(await loc.isVisible({ timeout: timeoutMs }).catch(() => false))) {
      return false;
    }
    await loc.click();
    return true;
  };

  if (envSelector && (await tryClick(envSelector, 5000))) {
    return;
  }

  const anticonClass =
    dataIcon === 'file-pdf' ? '.anticon-file-pdf' : `.anticon-${dataIcon.replace(/^file-/, '')}`;

  const builtIn = [
    anticonClass,
    `span.anticon:has(svg[data-icon="${dataIcon}"])`,
    `[aria-label="${dataIcon}"]`,
    `svg[data-icon="${dataIcon}"]`,
  ];

  for (const sel of builtIn) {
    if (await tryClick(sel, 2000)) {
      return;
    }
  }

  const svg = root.locator(`svg[data-icon="${dataIcon}"]`).first();
  await svg.waitFor({ state: 'visible', timeout: 15_000 });

  const ancestor = svg.locator(
    'xpath=ancestor::button[1] | ancestor::a[1] | ancestor::*[@role="button"][1] | ancestor::span[contains(@class,"anticon")][1]',
  );
  if ((await ancestor.count()) > 0) {
    await ancestor.first().click();
    return;
  }

  if (scope) {
    await svg.click();
    return;
  }

  const fallback = await resolveSelector(page, fallbackKey, 3000);
  await fallback.click();
}
