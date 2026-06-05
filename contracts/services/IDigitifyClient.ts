import type { Page } from 'playwright';

import type { Result } from '../../types/result.js';

export interface DigitifyAuthStatus {
  authenticated: boolean;
  email: string;
  sessionLoadedFrom: 'storage' | 'chrome' | 'fresh';
}

export interface DigitifyDownloadOptions {
  dateRangeDays: number;
}

export interface DigitifyDownloadResult {
  localPath: string;
  originalFilename: string;
  downloadedAt: string;
  sizeBytes: number;
}

export interface IDigitifyClient {
  login(): Promise<Result<DigitifyAuthStatus, Error>>;
  navigateToAdvance(): Promise<Result<void, Error>>;
  applyFilters(options: DigitifyDownloadOptions): Promise<Result<void, Error>>;
  downloadTrips(options: DigitifyDownloadOptions): Promise<Result<DigitifyDownloadResult, Error>>;
  getPageForReview(): Promise<Page>;
  searchTrip(tripId: string): Promise<Result<void, Error>>;
  approveTrip(tripId: string): Promise<Result<void, Error>>;
  rejectTrip(tripId: string, reason: string): Promise<Result<void, Error>>;
  close(): Promise<void>;
}
