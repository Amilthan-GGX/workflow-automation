import { RetryStrategy, AutomationErrorType } from '../types/enums.js';
import type { AppLogger } from './logger.js';
import type { RetryOptions } from '../modules/digitify/types.js';

/** Error types that should never be retried — fast-fail */
const NON_RETRYABLE_TYPES = new Set<AutomationErrorType>([
  AutomationErrorType.AuthFailed,
  AutomationErrorType.DownloadCorrupt,
  AutomationErrorType.Unknown,
]);

export function classifyError(error: Error): AutomationErrorType {
  const msg = error.message.toLowerCase();
  if (msg.includes('net::err') || msg.includes('network')) return AutomationErrorType.NetworkError;
  if (msg.includes('timeout') && msg.includes('navigation')) return AutomationErrorType.NavigationTimeout;
  if (msg.includes('timeout') && msg.includes('download')) return AutomationErrorType.DownloadTimeout;
  if (msg.includes('selector') || msg.includes('locator') || msg.includes('not found')) return AutomationErrorType.SelectorNotFound;
  if (msg.includes('auth') || msg.includes('login') || msg.includes('unauthorized')) return AutomationErrorType.AuthFailed;
  if (msg.includes('session') || msg.includes('expired')) return AutomationErrorType.AuthExpired;
  return AutomationErrorType.Unknown;
}

export function isRetryable(type: AutomationErrorType): boolean {
  return !NON_RETRYABLE_TYPES.has(type);
}

function computeDelay(attempt: number, options: RetryOptions): number {
  if (options.strategy === RetryStrategy.Fixed) return options.baseMs;
  // Exponential: baseMs * 2^attempt, capped at 30s
  return Math.min(options.baseMs * Math.pow(2, attempt), 30_000);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  logger: AppLogger,
): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= options.max; attempt++) {
    try {
      const result = await fn();
      if (attempt > 0) {
        logger.info({ action: 'retry:success', label: options.label, attempt });
      }
      return result;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const errorType = classifyError(lastError);

      if (!isRetryable(errorType)) {
        logger.error({ action: 'retry:non-retryable', label: options.label, errorType, err: lastError.message });
        throw lastError;
      }

      if (attempt === options.max) {
        logger.error({ action: 'retry:exhausted', label: options.label, attempt, err: lastError.message });
        break;
      }

      const delayMs = computeDelay(attempt, options);
      logger.warn({ action: 'retry:attempt', label: options.label, attempt: attempt + 1, max: options.max, delayMs, err: lastError.message });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError;
}
