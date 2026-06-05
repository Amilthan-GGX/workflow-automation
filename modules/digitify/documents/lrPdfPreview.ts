import fs from 'fs/promises';

import type { Page, Locator } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
export interface CapturedDocument {
  buffer: Buffer;
  mimeType: string;
  sourceUrl?: string | undefined;
}

/** LR File Preview modal — click placeholder, then capture PDF bytes for OCR. */
export async function capturePdfFromLrPreview(
  page: Page,
  logger: AppLogger,
  clickTarget?: Locator,
  tripId?: string,
): Promise<Result<CapturedDocument, Error>> {
  // Prefer clicking the icon (cursor-pointer = handler is there or on its parent container).
  // Fall back to text if icon not visible.
  const openLink =
    clickTarget ??
    page.locator('.anticon-file-pdf').first().or(
      page.getByText(/click to view pdf file/i).first(),
    );

  if (!(await openLink.isVisible({ timeout: 4000 }).catch(() => false))) {
    // Also search MUI dialogs (Trip File Preview uses MUI, not Ant Design)
    const icon = page
      .locator(
        '.slick-active .anticon-file-pdf, [role="dialog"] .anticon-file-pdf, ' +
        '.ant-modal .anticon-file-pdf, svg[data-icon="file-pdf"]',
      )
      .first();
    if (!(await icon.isVisible({ timeout: 2000 }).catch(() => false))) {
      return err(new Error('PDF preview placeholder not found'));
    }
    return capturePdfFromLrPreview(page, logger, icon, tripId);
  }

  logger.info({ action: 'document:pdf-placeholder-detected', tripId });

  const context = page.context();
  const downloadP = page.waitForEvent('download', { timeout: 12_000 }).catch(() => null);
  const popupP = context.waitForEvent('page', { timeout: 12_000 }).catch(() => null);

  logger.info({ action: 'document:pdf-open-click', tripId });
  await openLink.click({ timeout: 8_000 });
  await page.waitForTimeout(1_000);

  // Check popup first — window.open('_blank') fires immediately; download is rare.
  // Awaiting downloadP first would always waste its full 12s timeout before we see the popup.
  const popup = await popupP;
  if (!popup) {
    // No popup — fall back to download check
    const download = await downloadP;
    if (download) {
      const filePath = await download.path();
      const buffer = await fs.readFile(filePath);
      logger.info({ action: 'document:pdf-download', bytes: buffer.length, tripId });
      return ok({ buffer, mimeType: 'application/pdf' });
    }
  }

  if (popup) {
    // domcontentloaded fires too early for S3 PDF redirects; wait for URL to settle
    await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
    if (popup.url().startsWith('about:') || popup.url() === '') {
      await popup.waitForURL(/https?:\/\//, { timeout: 8_000 }).catch(() => undefined);
    }
    const popupUrl = popup.url();
    logger.info({ action: 'document:pdf-popup-opened', url: popupUrl.slice(0, 120), tripId });
    const fromPopup = await capturePdfFromOpenPage(popup, logger, tripId);
    await popup.close().catch(() => undefined);
    if (fromPopup.ok) return fromPopup;
  }

  const embedded = await capturePdfFromEmbed(page, logger, tripId);
  if (embedded.ok) return embedded;

  const modal = page.locator('.ant-modal-content').last();
  if (await modal.isVisible().catch(() => false)) {
    const screenshot = await modal.screenshot({ type: 'png' });
    logger.info({ action: 'document:pdf-modal-screenshot', bytes: screenshot.length, tripId });
    return ok({ buffer: screenshot, mimeType: 'image/png' });
  }

  return err(new Error('PDF opened but could not capture content'));
}

async function capturePdfFromOpenPage(
  page: Page,
  logger: AppLogger,
  tripId?: string,
): Promise<Result<CapturedDocument, Error>> {
  let url = page.url();
  // URL may still be about:blank if load hasn't settled — wait for it
  if (!url || url.startsWith('about:')) {
    await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => undefined);
    url = page.url();
  }
  if (url && !url.startsWith('about:')) {
    try {
      logger.info({ action: 'document:pdf-fetching', url: url.slice(0, 120), tripId });
      const buffer = await fetchViaRequest(page, url);
      const magic = buffer.slice(0, 4).toString();
      if (magic === '%PDF') {
        logger.info({ action: 'document:pdf-captured', bytes: buffer.length, url: url.slice(0, 120), tripId });
        return ok({ buffer, mimeType: 'application/pdf', sourceUrl: url });
      }
      logger.warn({ action: 'document:pdf-not-pdf-bytes', magic: buffer.slice(0, 4).toString('hex'), url: url.slice(0, 80), tripId });
    } catch (e) {
      logger.warn({ action: 'document:pdf-url-failed', err: String(e), tripId });
    }
  }

  const embed = page.locator('embed[type="application/pdf"], iframe, object').first();
  if (await embed.isVisible({ timeout: 5000 }).catch(() => false)) {
    return capturePdfFromEmbed(page, logger, tripId);
  }

  return err(new Error('No PDF on opened page'));
}

async function capturePdfFromEmbed(
  page: Page,
  logger: AppLogger,
  tripId?: string,
): Promise<Result<CapturedDocument, Error>> {
  const embed = page
    .locator(
      '.ant-modal embed, .ant-modal iframe, .ant-modal object, embed[type="application/pdf"], iframe[src*="pdf"]',
    )
    .first();

  if (!(await embed.isVisible({ timeout: 8000 }).catch(() => false))) {
    return err(new Error('No PDF embed in modal'));
  }

  const src = await embed.getAttribute('src');
  if (src && !src.startsWith('blob:')) {
    const url = src.startsWith('//') ? `https:${src}` : src;
    const absolute = url.startsWith('http') ? url : new URL(url, page.url()).href;
    try {
      const buffer = await fetchViaRequest(page, absolute);
      const mime =
        buffer.slice(0, 4).toString() === '%PDF' ? 'application/pdf' : 'image/png';
      logger.info({ action: 'document:pdf-embed', bytes: buffer.length, tripId });
      return ok({ buffer, mimeType: mime, sourceUrl: absolute });
    } catch (e) {
      logger.warn({ action: 'document:pdf-embed-fetch-failed', err: String(e) });
    }
  }

  return err(new Error('PDF embed has no fetchable URL'));
}

async function fetchViaRequest(page: Page, url: string): Promise<Buffer> {
  const response = await page.request.get(url);
  if (!response.ok()) {
    throw new Error(`HTTP ${response.status()} for ${url.slice(0, 80)}`);
  }
  return Buffer.from(await response.body());
}

export function isPdfPreviewPlaceholder(page: Page): Locator {
  return page.getByText(/click to view pdf file/i);
}

export async function hasPdfPreviewPlaceholder(page: Page): Promise<boolean> {
  return isPdfPreviewPlaceholder(page).isVisible({ timeout: 3000 }).catch(() => false);
}
