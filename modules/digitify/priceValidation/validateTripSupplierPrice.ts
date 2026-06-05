import type { Page } from 'playwright';

import type { AppConfig } from '../../../config/schema.js';
import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import { ok } from '../../../types/result.js';
import { extractMemoDocument } from '../../../services/gemini/extractMemoDocument.js';
import { pricesMatch } from '../../../modules/validation/priceMatch.js';
import type { DocumentCheck } from '../documentValidation/memoChecks.js';
import { evaluateMemoDocument } from '../documentValidation/memoChecks.js';
import { searchTripById } from '../marginReview/idColumnSearch.js';
import { openTripDocumentsAndCapture } from '../marginReview/openTripDocuments.js';
import { dismissDigitifyModals } from '../documents/openLoadingMemo.js';
import { isMemoMissingError } from '../documents/memoMissing.js';
import type { VendorAdvanceRow } from '../../excel/readVendorSheet.js';

export type MemoStatus = 'present' | 'missing';

export interface TripPriceValidationResult {
  tripId: string;
  excelPrice: number;
  excelTruck: string;
  excelSupplier: string;
  ocrPrice: number | null;
  priceMismatch: boolean;
  /** All checks passed (price + truck + supplier + signature/seal). */
  documentApproved: boolean;
  rejectionReasons: string[];
  checks: DocumentCheck[];
  truckOnMemo: string | null;
  supplierOnMemo: string | null;
  hasSignature: boolean;
  hasSeal: boolean;
  isDigitalMemo: boolean;
  reason: string;
  ocrNote: string;
  memoStatus: MemoStatus;
  /** Weight extracted from POD modal (Sunflag weight-based trips only). */
  podWeight?: number | null;
  /** Rate per MT from loading memo OCR (Sunflag weight-based trips only). */
  ratePerMt?: number | null;
}

export async function validateTripSupplierPrice(
  page: Page,
  row: Pick<VendorAdvanceRow, 'id' | 'price' | 'truck' | 'supplier' | 'customer'>,
  config: AppConfig,
  logger: AppLogger,
): Promise<Result<TripPriceValidationResult, Error>> {
  const { id: tripId, price: excelPrice, truck: excelTruck, supplier: excelSupplier } = row;
  const isSunflag = /sunflag/i.test(row.customer ?? '');
  const d = config.digitify;
  const g = config.gemini;
  const tolerance = config.processing.supplierPriceTolerancePct;

  const base = (): TripPriceValidationResult => ({
    tripId,
    excelPrice,
    excelTruck,
    excelSupplier,
    ocrPrice: null,
    priceMismatch: true,
    documentApproved: false,
    rejectionReasons: [],
    checks: [],
    truckOnMemo: null,
    supplierOnMemo: null,
    hasSignature: false,
    hasSeal: false,
    isDigitalMemo: false,
    reason: '',
    ocrNote: '',
    memoStatus: 'present',
  });

  await dismissDigitifyModals(page);

  const searchResult = await searchTripById(
    page,
    tripId,
    {
      idColumnTitle: d.idColumnTitle,
      idFilterTrigger: d.selectorIdFilterTrigger,
      idSearchInput: d.selectorIdSearchInput,
    },
    logger,
  );
  if (!searchResult.ok) {
    const rejectionReasons = [`Digitify search failed: ${searchResult.error.message}`];
    return ok({
      ...base(),
      rejectionReasons,
      reason: rejectionReasons.join(' | '),
    });
  }

  let podWeight: number | null = null;

  const docSelectors = {
    rowFilesButton: d.selectorLoadingMemoFiles,
    section: d.selectorLoadingMemoSection,
    viewButton: d.selectorLoadingMemoViewButton,
    documentImage: d.selectorDocumentImage,
    pdfViewClick: d.selectorPdfViewClick,
    onPodOpen: isSunflag
      ? async (podModal: import('playwright').Locator) => {
          podWeight = await extractSunflagWeight(podModal, tripId, logger);
        }
      : undefined,
  };

  let docResult = await openTripDocumentsAndCapture(page, tripId, docSelectors, logger);
  if (!docResult.ok) {
    // Retry once — transient Playwright timing failures cause false "Memo missing" between trips
    logger.info({
      action: 'price-validation:doc-retry',
      tripId,
      reason: docResult.error.message.split('\n')[0]?.trim(),
    });
    await page.waitForTimeout(1500);
    await dismissDigitifyModals(page);
    docResult = await openTripDocumentsAndCapture(page, tripId, docSelectors, logger);
  }
  if (!docResult.ok) {
    if (isMemoMissingError(docResult.error)) {
      logger.info({ action: 'price-validation:memo-missing', tripId });
      const evaluated = evaluateMemoDocument({
        tripId,
        excelPrice,
        excelTruck,
        excelSupplier,
        ocrPrice: null,
        priceMismatch: false,
        truckOnMemo: null,
        supplierOnMemo: null,
        hasSignature: false,
        hasSeal: false,
        isDigitalMemo: false,
        memoStatus: 'missing',
        priceTolerancePct: tolerance,
      });
      return ok({
        ...base(),
        priceMismatch: false,
        memoStatus: 'missing',
        checks: evaluated.checks,
        rejectionReasons: evaluated.rejectionReasons,
        documentApproved: false,
        reason: evaluated.summaryReason,
      });
    }
    // Strip Playwright's multi-line call log — keep only the first meaningful line
    const cleanMsg = docResult.error.message.split('\n')[0]?.trim() ?? docResult.error.message;
    const rejectionReasons = [`Document open failed: ${cleanMsg}`];
    return ok({
      ...base(),
      rejectionReasons,
      reason: rejectionReasons.join(' | '),
    });
  }

  let mimeType = docResult.value.mimeType;
  if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') {
    mimeType = 'image/jpeg';
  }

  logger.info({ action: 'price-validation:memo-analysis-start', tripId, isSunflag, bytes: docResult.value.buffer.length, mimeType });
  const analysisResult = await extractMemoDocument(docResult.value.buffer, mimeType, {
    apiKey: g.apiKey,
    model: g.model,
    logger,
    excelPrice,
    excelTruck,
    excelSupplier,
    // OCR reconciliation needs a wider margin than the Excel comparison tolerance;
    // memos often show a total that includes add-ons slightly outside the configured band
    disambiguationTolerancePct: Math.max(tolerance, 10),
    priceMode: isSunflag ? 'per-mt-rate' : 'hire-rate',
  });

  if (!analysisResult.ok) {
    const rejectionReasons = [`OCR failed: ${analysisResult.error.message}`];
    return ok({
      ...base(),
      memoStatus: 'present',
      rejectionReasons,
      reason: rejectionReasons.join(' | '),
    });
  }

  const analysis = analysisResult.value;

  // Sunflag: effective price = rate/MT × weight from POD modal
  const ratePerMt = isSunflag ? analysis.supplierPrice : null;
  const effectivePrice =
    isSunflag && ratePerMt !== null && podWeight !== null
      ? Math.round(ratePerMt * podWeight)
      : null;

  const ocrPrice = isSunflag ? effectivePrice : analysis.supplierPrice;
  const priceMismatch =
    ocrPrice === null ? true : !pricesMatch(excelPrice, ocrPrice, tolerance);

  const evaluated = evaluateMemoDocument({
    tripId,
    excelPrice,
    excelTruck,
    excelSupplier,
    ocrPrice,
    priceMismatch,
    truckOnMemo: analysis.truckNumberOnMemo,
    supplierOnMemo: analysis.supplierNameOnMemo,
    hasSignature: analysis.hasSignature,
    hasSeal: analysis.hasSeal,
    isDigitalMemo: analysis.isDigitalMemo,
    memoStatus: 'present',
    priceTolerancePct: tolerance,
  });

  logger.info({
    action: 'price-validation:result',
    tripId,
    documentApproved: evaluated.documentApproved,
    priceMismatch,
    ocrPrice,
    excelPrice,
    ...(isSunflag && { podWeight, ratePerMt }),
    rejectionReasons: evaluated.rejectionReasons.length ? evaluated.rejectionReasons : undefined,
    truckOnMemo: analysis.truckNumberOnMemo,
    supplierOnMemo: analysis.supplierNameOnMemo,
    hasSignature: analysis.hasSignature,
    hasSeal: analysis.hasSeal,
  });

  return ok({
    tripId,
    excelPrice,
    excelTruck,
    excelSupplier,
    ocrPrice,
    priceMismatch,
    ...(isSunflag && { podWeight, ratePerMt }),
    documentApproved: evaluated.documentApproved,
    rejectionReasons: evaluated.rejectionReasons,
    checks: evaluated.checks,
    truckOnMemo: analysis.truckNumberOnMemo,
    supplierOnMemo: analysis.supplierNameOnMemo,
    hasSignature: analysis.hasSignature,
    hasSeal: analysis.hasSeal,
    isDigitalMemo: analysis.isDigitalMemo,
    memoStatus: 'present',
    reason: evaluated.summaryReason,
    ocrNote: analysis.extractionNote,
  });
}

/**
 * Reads the Weight column from ALL LR rows in the open POD modal and sums them.
 * Single browser evaluate() — one round trip regardless of row count.
 * Digitify labels the column "Kg" but the numeric values are in MT — no conversion needed.
 */
async function extractSunflagWeight(
  podModal: import('playwright').Locator,
  tripId: string,
  logger: AppLogger,
): Promise<number | null> {
  // Wait for at least one data row — the table loads async after the modal opens.
  // Without this, evaluate() sees an empty tbody and returns no rows.
  await podModal
    .locator('.ant-table-tbody tr.ant-table-row:not(.ant-table-measure-row)')
    .first()
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);

  const extracted = await podModal.evaluate((el) => {
    const headers = [...el.querySelectorAll('.ant-table-thead th.ant-table-cell')];
    const weightColIdx = headers.findIndex(
      (th) => /\bweight\b|\bwt\b/i.test(th.textContent?.trim() ?? ''),
    );
    if (weightColIdx === -1) return { found: false, raws: [] as string[] };

    const dataRows = [...el.querySelectorAll(
      '.ant-table-tbody tr.ant-table-row:not(.ant-table-measure-row)',
    )];
    const raws = dataRows.map((row) => {
      const cell = row.querySelectorAll('td.ant-table-cell')[weightColIdx];
      return (cell?.querySelector('h3')?.textContent ?? cell?.textContent ?? '').trim();
    }).filter(Boolean);

    return { found: raws.length > 0, raws };
  }).catch(() => null);

  if (!extracted || !extracted.found) {
    logger.warn({ action: 'sunflag:weight-column-not-found', tripId });
    return null;
  }

  let total = 0;
  const counted: string[] = [];
  for (const raw of extracted.raws) {
    const w = parseFloat(raw.replace(/,/g, '').match(/([\d.]+)/)?.[1] ?? '');
    if (Number.isFinite(w) && w > 0) { total += w; counted.push(raw); }
  }

  if (total <= 0) return null;
  logger.info({ action: 'sunflag:weight-extracted', tripId, rows: counted, totalMt: total });
  return total;
}
