import type { Page } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';
import type { Result } from '../../../types/result.js';
import {
  openLoadingMemoAndCapture,
  type CapturedDocument,
  type LoadingMemoSelectors,
} from '../documents/openLoadingMemo.js';

export type { CapturedDocument };

export interface DocumentViewSelectors extends LoadingMemoSelectors {
  /** @deprecated — not used; Loading Memo section eye only */
  loadingMemoFiles?: string | undefined;
  loadingMemoViewButton?: string | undefined;
}

/** Filtered row → trip detail → Loading Memo eye → capture document. */
export async function openTripDocumentsAndCapture(
  page: Page,
  tripId: string,
  selectors: DocumentViewSelectors,
  logger: AppLogger,
): Promise<Result<CapturedDocument, Error>> {
  return openLoadingMemoAndCapture(page, tripId, selectors, logger);
}
