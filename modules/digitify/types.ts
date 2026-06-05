import type { AutomationErrorType, RetryStrategy } from '../../types/enums.js';

export interface BrowserSession {
  savedAt: string;
  email: string;
  storageState: unknown;
}

export interface AutomationError {
  type: AutomationErrorType;
  message: string;
  retryable: boolean;
  retryStrategy: RetryStrategy;
  maxRetries: number;
  stage: string;
  pageUrl?: string;
  screenshotPath?: string;
  tracePath?: string;
}

export interface RetryOptions {
  max: number;
  strategy: RetryStrategy;
  baseMs: number;
  label: string;
}

export interface BrowserRunContext {
  runId: string;
  debugDir: string;
  tracesEnabled: boolean;
  screenshotsEnabled: boolean;
}
