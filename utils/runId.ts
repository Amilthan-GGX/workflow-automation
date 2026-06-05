import crypto from 'crypto';

let runCounter = 0;

/**
 * Generates a lexicographically sortable run ID.
 * Format: RUN-YYYYMMDD-HHMMSS-{4-char hex suffix}
 */
export function generateRunId(): string {
  runCounter++;
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `RUN-${date}-${suffix}`;
}

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}
