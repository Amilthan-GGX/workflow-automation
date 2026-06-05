import type { Page, Locator } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import { capturePdfFromLrPreview } from './lrPdfPreview.js';
import { MemoMissingError } from './memoMissing.js';

export interface CapturedDocument {
  buffer: Buffer;
  mimeType: string;
  sourceUrl?: string | undefined;
}

export interface LoadingMemoSelectors {
  /** LR No cell: Files link button (opens POD modal). */
  rowFilesButton?: string | undefined;
  section?: string | undefined;
  viewButton?: string | undefined;
  documentImage?: string | undefined;
  pdfViewClick?: string | undefined;
  /** Called with the open POD modal locator before the Loading Memo eye is clicked. */
  onPodOpen?: ((podModal: import('playwright').Locator) => Promise<void>) | undefined;
}

/**
 * Id filter → LR No cell Files (LRIcon + /trips/ link) → POD modal
 * → Loading Memo eye (not LR Preview / Other Documents) → Trip File Preview OCR.
 */
/** Close stacked Digitify modals before the next trip. */
export async function dismissDigitifyModals(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await closeTopModal(page);
  }
}

export async function openLoadingMemoAndCapture(
  page: Page,
  tripId: string,
  selectors: LoadingMemoSelectors,
  logger: AppLogger,
): Promise<Result<CapturedDocument, Error>> {
  try {
    await dismissDigitifyModals(page);

    const row = page.locator('tr.ant-table-row').filter({ hasText: tripId }).first();
    await row.waitFor({ state: 'visible', timeout: 12_000 });
    await row.scrollIntoViewIfNeeded().catch(() => undefined);

    const filesBtn = await resolveRowFilesButton(row, selectors.rowFilesButton);
    if (!filesBtn) {
      return err(
        new Error(
          `Files (LRIcon) not in LR No cell for ${tripId} — Id filter must leave one row visible`,
        ),
      );
    }

    await filesBtn.waitFor({ state: 'visible', timeout: 15_000 });

    // When no documents are uploaded the button is disabled in the UI — skip immediately
    if (!(await filesBtn.isEnabled().catch(() => true))) {
      logger.info({ action: 'loading-memo:files-disabled', tripId });
      return err(new MemoMissingError());
    }

    logger.info({ action: 'loading-memo:files-click', tripId });
    try {
      await filesBtn.click({ timeout: 8_000 });
    } catch {
      // ant-table-body intercepts pointer events — force bypasses hit-testing and keeps React events
      await filesBtn.click({ force: true, timeout: 5_000 });
    }

    const podModal = await waitForPodModal(page, tripId, logger);

    if (selectors.onPodOpen) {
      await selectors.onPodOpen(podModal).catch((e) => {
        logger.warn({ action: 'loading-memo:pod-callback-error', tripId, err: String(e) });
      });
    }

    const section = await resolveLoadingMemoSection(podModal, selectors.section);
    if (!section) {
      logger.info({ action: 'loading-memo:section-not-found', tripId });
      await closeDialogs(page);
      return err(new MemoMissingError());
    }

    const eyeBtn = await resolveLoadingMemoEye(section, podModal, selectors.viewButton);
    if (!eyeBtn) {
      logger.info({ action: 'loading-memo:eye-not-found', tripId });
      await closeDialogs(page);
      return err(new MemoMissingError());
    }

    if (!(await hasLoadingMemoUploaded(section, eyeBtn))) {
      logger.info({ action: 'loading-memo:missing', tripId });
      await closeDialogs(page);
      return err(new MemoMissingError());
    }

    logger.info({ action: 'loading-memo:eye-click', tripId });
    await eyeBtn.click();

    const captured = await captureLoadingMemoPreview(page, tripId, selectors, logger);
    await closeDialogs(page);
    return captured;
  } catch (e) {
    await closeDialogs(page).catch(() => undefined);
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Files button in LR No column: badge + LRIcon beside /trips/ link. */
async function resolveRowFilesButton(
  row: Locator,
  custom?: string,
): Promise<Locator | null> {
  const candidates: Locator[] = custom?.trim()
    ? [row.locator(custom).first()]
    : [
        row.locator('div.break-all button.ant-btn-link:has(img[alt="Files"])'),
        row.locator('.ant-badge button.ant-btn-link:has(picture img[alt="Files"])'),
        row.locator('button.ant-btn-link:has(img[src*="LRIcon"])'),
        row.locator('a[href*="/trips/"]').locator('..').locator('button.ant-btn-link').first(),
      ];

  for (const loc of candidates) {
    const btn = loc.first();
    if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      return btn;
    }
  }
  return null;
}

/** Disabled eye or zero file badge → no memo to OCR. */
async function hasLoadingMemoUploaded(section: Locator, eyeBtn: Locator): Promise<boolean> {
  const className = (await eyeBtn.getAttribute('class')) ?? '';
  if (
    !(await eyeBtn.isEnabled().catch(() => false)) ||
    /ant-btn-disabled/.test(className)
  ) {
    return false;
  }
  const badgeHost = eyeBtn.locator('xpath=ancestor::*[contains(@class,"ant-badge")][1]');
  const badge = badgeHost
    .locator('.ant-badge-count, sup.ant-scroll-number')
    .first()
    .or(section.locator('.ant-badge-count, sup.ant-scroll-number').first());
  if (!(await badge.isVisible({ timeout: 800 }).catch(() => false))) {
    return true;
  }
  const raw =
    (await badge.getAttribute('title')) ??
    (await badge.textContent()) ??
    (await badge.innerText().catch(() => ''));
  const n = parseInt(String(raw).replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0;
}

/** Digitify uses `tiny-label` or `tinyLabel` on section titles. */
function loadingMemoTitle(podModal: Locator): Locator {
  return podModal
    .locator('p.tinyLabel, p.tiny-label, p[class*="tinyLabel"], p[class*="tiny-label"]')
    .filter({ hasText: /^Loading Memo$/i });
}

async function waitForPodModal(page: Page, tripId: string, logger: AppLogger): Promise<Locator> {
  const podModal = page.locator('.ant-modal:visible').filter({
    has: page.locator('.ant-modal-title').filter({ hasText: /^POD$/i }),
  }).last();

  try {
    await podModal.waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    // Intransit/other-status trips may open a different modal title
    const anyModal = page.locator('.ant-modal:visible').last();
    const title = (await anyModal.locator('.ant-modal-title').textContent().catch(() => ''))?.trim();
    if (title) {
      throw new Error(`Document opened as "${title}" — POD modal not available for this trip`);
    }
    throw new Error('POD modal did not open — document not accessible for this trip');
  }

  const body = podModal.locator('.ant-modal-body').first();
  await body.waitFor({ state: 'visible', timeout: 10_000 });
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  }).catch(() => undefined);

  await loadingMemoTitle(podModal).first().waitFor({ state: 'visible', timeout: 12_000 });
  logger.info({ action: 'loading-memo:pod-open', tripId });
  return podModal;
}

async function resolveLoadingMemoSection(
  podModal: Locator,
  custom?: string,
): Promise<Locator | null> {
  if (custom?.trim()) {
    const customLoc = podModal.locator(custom).first();
    if (await customLoc.isVisible({ timeout: 3_000 }).catch(() => false)) {
      return customLoc;
    }
  }

  const label = loadingMemoTitle(podModal).first();
  const rowCandidates = [
    label.locator(
      'xpath=ancestor::div[contains(@class,"border-b") and (contains(@class,"flex") or contains(@class,"justify-between"))][1]',
    ),
    podModal
      .locator('div.flex.justify-between.border-b, div.border-b')
      .filter({ has: label }),
  ];

  for (const rows of rowCandidates) {
    const row = rows.first();
    if (await row.isVisible({ timeout: 2_000 }).catch(() => false)) {
      return row;
    }
  }

  if (!(await label.isVisible({ timeout: 2_000 }).catch(() => false))) {
    return null;
  }

  return label.locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
}

/** Trip File Preview is usually a photo (image); LR rows may be PDF — capture top layer only. */
async function captureLoadingMemoPreview(
  page: Page,
  tripId: string,
  selectors: LoadingMemoSelectors,
  logger: AppLogger,
): Promise<Result<CapturedDocument, Error>> {
  const tripPreviewWrap = page.locator('.ant-modal-wrap:visible').filter({
    has: page.locator('.ant-modal-title', { hasText: /Trip File Preview/i }),
  });
  const muiPreview = page.locator('[role="dialog"]:visible').filter({
    has: page.locator('img[src]:not([src=""])'),
  });
  const imagePreview = page.locator('.ant-image-preview-wrap:visible').last();

  // "Trip File Preview" may be a full-page custom overlay (not ant-modal-wrap).
  // Detect by text (reliable) but click the icon span — cursor-pointer is on the icon,
  // meaning the React onClick is there (or on its parent), NOT on the <p> text sibling.
  const pdfText = page.getByText(/click to view pdf file/i).first();
  const pdfIcon = page.locator('.anticon-file-pdf').first();

  // Wait specifically for Trip File Preview, image preview, or PDF placeholder —
  // NOT a generic modal-wrap, because the POD modal is already visible.
  await Promise.race([
    tripPreviewWrap.last().waitFor({ state: 'visible', timeout: 18_000 }),
    muiPreview.last().waitFor({ state: 'visible', timeout: 18_000 }),
    imagePreview.waitFor({ state: 'visible', timeout: 18_000 }),
    pdfText.waitFor({ state: 'visible', timeout: 18_000 }),
  ]).catch(() => undefined);
  await page.waitForTimeout(800);

  // PDF placeholder check first — container-agnostic (works with full-page overlays too)
  if (await pdfText.isVisible({ timeout: 2_000 }).catch(() => false)) {
    logger.info({ action: 'loading-memo:pdf-placeholder-found', tripId });
    // onClick is on the icon span (cursor-pointer), NOT on the <p> text sibling.
    // Find the icon as a preceding-sibling of the detected text — scoped to the exact slide,
    // avoiding toolbar or inactive-slide icons elsewhere on the page.
    const siblingIcon = pdfText.locator(
      'xpath=preceding-sibling::*[contains(@class,"anticon-file-pdf")]',
    );
    let clickTarget = pdfText as import('playwright').Locator;
    if (await siblingIcon.isVisible({ timeout: 500 }).catch(() => false)) {
      clickTarget = siblingIcon;
    } else if (await pdfIcon.isVisible({ timeout: 500 }).catch(() => false)) {
      clickTarget = pdfIcon;
    }
    const pdfResult = await capturePdfFromLrPreview(page, logger, clickTarget, tripId);
    if (pdfResult.ok) return pdfResult;
    logger.warn({ action: 'loading-memo:pdf-failed', tripId, err: pdfResult.error.message });
  }

  if (await tripPreviewWrap.last().isVisible({ timeout: 2_000 }).catch(() => false)) {
    const modal = tripPreviewWrap.last().locator('.ant-modal').first();
    logger.info({ action: 'loading-memo:trip-file-preview', tripId });
    const fromImage = await captureDocumentImageFromModal(
      page,
      modal,
      tripId,
      selectors,
      logger,
      'trip-file-preview',
    );
    if (fromImage.ok) return fromImage;
  }

  if (await imagePreview.isVisible({ timeout: 1_500 }).catch(() => false)) {
    const img = imagePreview.locator('img.ant-image-preview-img, img[src]').first();
    if (await img.isVisible({ timeout: 3_000 }).catch(() => false)) {
      logger.info({ action: 'loading-memo:preview-layer', tripId, layer: 'ant-image-preview' });
      return captureFromImage(page, img, tripId, logger);
    }
    const shot = await imagePreview.screenshot({ type: 'png' });
    logger.info({ action: 'document:image-preview-screenshot', tripId, bytes: shot.length });
    return ok({ buffer: shot, mimeType: 'image/png' });
  }

  if (await muiPreview.last().isVisible({ timeout: 2_000 }).catch(() => false)) {
    const dialog = muiPreview.last();
    logger.info({ action: 'loading-memo:mui-preview', tripId });
    const largest = await findLargestImageIn(dialog);
    if (largest) {
      return captureFromImage(page, largest, tripId, logger);
    }
    const shot = await dialog.screenshot({ type: 'png' });
    if (shot.length > 8_000) {
      logger.info({ action: 'document:mui-dialog-screenshot', tripId, bytes: shot.length });
      return ok({ buffer: shot, mimeType: 'image/png' });
    }
  }

  const topWrap = page.locator('.ant-modal-wrap:visible').last();
  const topModal = topWrap.locator('.ant-modal').first();
  const title = (await topModal.locator('.ant-modal-title').textContent().catch(() => '')) ?? '';
  logger.info({ action: 'loading-memo:preview-modal', tripId, title: title.trim() });

  if (/^POD$/i.test(title.trim())) {
    return err(
      new Error(
        'Loading Memo image preview did not open (only POD modal visible). Retry or open the memo eye icon manually.',
      ),
    );
  }

  const fromTop = await captureDocumentImageFromModal(
    page,
    topModal,
    tripId,
    selectors,
    logger,
    'top-modal',
  );
  if (fromTop.ok) return fromTop;

  const pdfLink = topModal.getByText(/click to view pdf file/i).first();
  if (await pdfLink.isVisible({ timeout: 1_500 }).catch(() => false)) {
    const pdfResult = await capturePdfFromLrPreview(page, logger, pdfLink, tripId);
    if (pdfResult.ok) return pdfResult;
  }

  return err(new Error('Loading Memo preview empty'));
}

/** Prefer largest memo photo in modal; fallback to body screenshot. */
async function captureDocumentImageFromModal(
  page: Page,
  modal: Locator,
  tripId: string,
  selectors: LoadingMemoSelectors,
  logger: AppLogger,
  source: string,
): Promise<Result<CapturedDocument, Error>> {
  const body = modal.locator('.ant-modal-body').first();
  if (!(await body.isVisible({ timeout: 3_000 }).catch(() => false))) {
    return err(new Error('Preview modal body not visible'));
  }

  const customImg = selectors.documentImage?.trim()
    ? body.locator(selectors.documentImage).first()
    : null;
  if (customImg && (await customImg.isVisible({ timeout: 2_000 }).catch(() => false))) {
    return captureFromImage(page, customImg, tripId, logger);
  }

  const largest = await findLargestImageIn(body);
  if (largest) {
    const box = await largest.boundingBox().catch(() => null);
    if (box && box.width >= 200 && box.height >= 200) {
      logger.info({ action: 'loading-memo:preview-image', tripId, source });
      return captureFromImage(page, largest, tripId, logger);
    }
  }

  const screenshot = await body.screenshot({ type: 'png' });
  if (screenshot.length > 50_000) {
    logger.info({ action: 'document:modal-body-screenshot', tripId, source, bytes: screenshot.length });
    return ok({ buffer: screenshot, mimeType: 'image/png' });
  }

  return err(new Error('No image in preview modal'));
}

async function findLargestImageIn(root: Locator): Promise<Locator | null> {
  const imgs = root.locator('img[src]:not([src=""])');
  const count = await imgs.count();
  let best: Locator | null = null;
  let bestArea = 0;

  for (let i = 0; i < count; i++) {
    const img = imgs.nth(i);
    const box = await img.boundingBox().catch(() => null);
    if (!box || box.width < 100 || box.height < 100) continue;
    const area = box.width * box.height;
    if (area > bestArea) {
      bestArea = area;
      best = img;
    }
  }

  return best;
}

async function resolveLoadingMemoEye(
  section: Locator,
  podModal: Locator,
  customView?: string,
): Promise<Locator | null> {
  const inSection = customView?.trim()
    ? section.locator(customView).first()
    : section.locator('button.ant-btn-circle:has(.anticon-eye)').first();
  if (await inSection.isVisible({ timeout: 2_000 }).catch(() => false)) {
    return inSection;
  }

  const nearLabel = loadingMemoTitle(podModal)
    .first()
    .locator('xpath=ancestor::*[contains(@class,"border")][1]')
    .locator('button.ant-btn-circle:has(.anticon-eye)')
    .first();
  if (await nearLabel.isVisible({ timeout: 2_000 }).catch(() => false)) {
    return nearLabel;
  }

  return null;
}

async function captureFromImage(
  page: Page,
  img: Locator,
  tripId: string,
  logger: AppLogger,
): Promise<Result<CapturedDocument, Error>> {
  const src = await img.getAttribute('src');
  if (src && (src.startsWith('http') || src.startsWith('//'))) {
    const url = src.startsWith('//') ? `https:${src}` : src;
    const response = await page.request.get(url);
    if (!response.ok()) {
      return err(new Error(`Failed to fetch document URL: ${response.status()}`));
    }
    const buffer = Buffer.from(await response.body());
    const mimeType = response.headers()['content-type'] ?? guessMime(url, buffer);
    logger.info({
      action: 'document:captured',
      tripId,
      source: 'loading-memo-image',
      mimeType,
      bytes: buffer.length,
    });
    return ok({ buffer, mimeType, sourceUrl: url });
  }

  const screenshot = await img.screenshot({ type: 'png' });
  logger.info({ action: 'document:screenshot', tripId, source: 'loading-memo', bytes: screenshot.length });
  return ok({ buffer: screenshot, mimeType: 'image/png' });
}

async function closeTopModal(page: Page): Promise<void> {
  // MUI Dialog close button (Trip File Preview uses MUI, not Ant Design)
  const muiClose = page.locator('[role="dialog"] button[aria-label="close"], .MuiDialog-root button.MuiIconButton-root').first();
  if (await muiClose.isVisible({ timeout: 300 }).catch(() => false)) {
    await muiClose.click().catch(() => undefined);
    await page.waitForTimeout(300);
    return;
  }
  // Ant Design modal close
  const close = page.locator('.ant-modal-close').last();
  if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
    await close.click().catch(() => undefined);
  } else {
    await page.keyboard.press('Escape').catch(() => undefined);
  }
  await page.waitForTimeout(400);
}

async function closeDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await closeTopModal(page);
  }
}

function guessMime(url: string, buffer: Buffer): string {
  if (url.includes('.pdf') || buffer.slice(0, 4).toString() === '%PDF') return 'application/pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  return 'image/jpeg';
}
