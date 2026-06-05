import type { Page } from 'playwright';

import type { AppConfig } from '../../../config/schema.js';
import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import { scanDocumentForVasanthApproval } from '../../../services/gemini/geminiDocumentScanner.js';
import { searchTripById } from './idColumnSearch.js';
import { openTripDocumentsAndCapture } from './openTripDocuments.js';

export interface TripMarginReviewResult {
  tripId: string;
  vasanthApprovalFound: boolean;
  reason: string;
  recommendedAction: 'approve' | 'reject';
}

export async function reviewNegativeMarginTrip(
  page: Page,
  tripId: string,
  config: AppConfig,
  logger: AppLogger,
): Promise<Result<TripMarginReviewResult, Error>> {
  const d = config.digitify;
  const g = config.gemini;

  await page.goto(d.baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await page.waitForLoadState('networkidle').catch(() => undefined);

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
  if (!searchResult.ok) return err(searchResult.error);

  const docResult = await openTripDocumentsAndCapture(
    page,
    tripId,
    {
      rowFilesButton: d.selectorLoadingMemoFiles,
      section: d.selectorLoadingMemoSection,
      viewButton: d.selectorLoadingMemoViewButton,
      documentImage: d.selectorDocumentImage,
    },
    logger,
  );
  if (!docResult.ok) return err(docResult.error);

  let mimeType = docResult.value.mimeType;
  if (mimeType === 'application/pdf') {
    return ok({
      tripId,
      vasanthApprovalFound: false,
      reason: 'PDF document — manual review required (OCR PDF not yet automated)',
      recommendedAction: 'reject',
    });
  }
  if (!mimeType.startsWith('image/')) {
    mimeType = 'image/jpeg';
  }

  const scanResult = await scanDocumentForVasanthApproval(docResult.value.buffer, mimeType, {
    apiKey: g.apiKey,
    model: g.model,
    approverPattern: new RegExp(g.approverNamePattern, 'i'),
    logger,
  });
  if (!scanResult.ok) return err(scanResult.error);

  const { approved, reason } = scanResult.value;
  return ok({
    tripId,
    vasanthApprovalFound: approved,
    reason,
    recommendedAction: approved ? 'approve' : 'reject',
  });
}
