/** Normalized Indian vehicle registration for comparison. */
export function normalizeVehicleRegistration(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function trucksMatch(excelTruck: string, memoTruck: string | null | undefined): boolean {
  const expected = normalizeVehicleRegistration(excelTruck);
  if (!expected || expected.length < 6) return true;
  const found = normalizeVehicleRegistration(memoTruck ?? '');
  if (!found) return false;
  if (found === expected || found.includes(expected) || expected.includes(found)) return true;

  // OCR commonly confuses 0↔O and 1↔I/L. Collapse both strings symmetrically and retry.
  // Applied to both sides so legitimate series letters (e.g. "OB", "LA") are handled consistently.
  const collapseOcr = (s: string) => s.replace(/O/g, '0').replace(/[IL]/g, '1');
  const eOcr = collapseOcr(expected);
  const fOcr = collapseOcr(found);
  return eOcr === fOcr || fOcr.includes(eOcr) || eOcr.includes(fOcr);
}

/**
 * Returns true if a and b differ by at most one edit (insert / delete / substitute).
 * Only applied to tokens ≥5 chars to avoid false matches on short words.
 */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const dl = a.length - b.length;
  if (dl < -1 || dl > 1) return false;
  let diffs = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] !== b[j]) {
      if (++diffs > 1) return false;
      if (dl > 0) i++;        // deletion in a
      else if (dl < 0) j++;   // insertion into a
      else { i++; j++; }      // substitution
    } else { i++; j++; }
  }
  return true;
}

/**
 * Fuzzy supplier-name match for Indian transport memos.
 *
 * Three divergence patterns are handled uniformly:
 *   1. Compound-word split  — "ROADLINES" ↔ "ROAD LINES"
 *   2. Spelling variant     — "UMAKANTH" ↔ "UMAKANT"  (1-edit distance)
 *   3. Personal vs trading  — "UMAKANTH YAVATE" ↔ "Umakanth Goods" (first name sufficient)
 *
 * Rule: ≥50% of meaningful Excel tokens must be found in the memo (minimum 1).
 * No special-casing by token length or count — one threshold for all name shapes.
 */
export function supplierNamesMatch(
  excelSupplier: string,
  memoSupplier: string | null | undefined,
): boolean {
  const excel = excelSupplier.trim();
  if (!excel || excel.length < 3) return true;

  const memo = (memoSupplier ?? '').toUpperCase();
  if (!memo) return false;

  const memoCompact = memo.replace(/\s+/g, '');
  const memoWords = memo.replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

  const NOISE = /^(PVT|LTD|LLP|PRIVATE|LIMITED|LOGISTICS|TRANSPORT|ROAD|LINES|LINE|AND|THE)$/i;
  const tokens = excel
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !NOISE.test(w));

  if (tokens.length === 0) return memo.includes(excel.toUpperCase().slice(0, 8));

  const hit = tokens.filter((t) => {
    if (memo.includes(t) || memoCompact.includes(t)) return true;
    if (t.length >= 5) {
      return memoWords.some((w) => w.length >= 5 && withinOneEdit(t, w));
    }
    return false;
  }).length;

  // Require ≥50% of meaningful tokens to match (minimum 1).
  return hit >= Math.max(1, Math.ceil(tokens.length * 0.5));
}

export function hasSignatureOrSeal(hasSignature: boolean, hasSeal: boolean): boolean {
  return hasSignature || hasSeal;
}

export interface MemoCheckInput {
  tripId: string;
  excelPrice: number;
  excelTruck: string;
  excelSupplier: string;
  ocrPrice: number | null;
  priceMismatch: boolean;
  truckOnMemo: string | null;
  supplierOnMemo: string | null;
  hasSignature: boolean;
  hasSeal: boolean;
  isDigitalMemo: boolean;
  memoStatus: 'present' | 'missing';
  priceTolerancePct: number;
}

export interface DocumentCheck {
  code: string;
  passed: boolean;
  message: string;
}

export interface MemoCheckResult {
  checks: DocumentCheck[];
  rejectionReasons: string[];
  documentApproved: boolean;
  summaryReason: string;
}

export function evaluateMemoDocument(input: MemoCheckInput): MemoCheckResult {
  const checks: DocumentCheck[] = [];
  const rejectionReasons: string[] = [];

  if (input.memoStatus === 'missing') {
    checks.push({
      code: 'memo_present',
      passed: false,
      message: 'Loading memo not uploaded in Digitify',
    });
    return {
      checks,
      rejectionReasons: ['Memo missing'],
      documentApproved: false,
      summaryReason: 'Memo missing',
    };
  }

  checks.push({
    code: 'memo_present',
    passed: true,
    message: 'Loading memo present',
  });

  if (input.ocrPrice === null) {
    rejectionReasons.push('Price not readable on memo');
    checks.push({
      code: 'price_readable',
      passed: false,
      message: 'Could not read hire rate from memo',
    });
  } else if (input.priceMismatch) {
    rejectionReasons.push(
      `Price mismatch: Excel ${input.excelPrice} vs memo ${input.ocrPrice} (tolerance ${input.priceTolerancePct}%)`,
    );
    checks.push({
      code: 'price_match',
      passed: false,
      message: `Excel ${input.excelPrice} ≠ memo ${input.ocrPrice}`,
    });
  } else {
    checks.push({
      code: 'price_match',
      passed: true,
      message: `Price matches (${input.excelPrice})`,
    });
  }

  const truckOk = trucksMatch(input.excelTruck, input.truckOnMemo);
  checks.push({
    code: 'truck_match',
    passed: truckOk,
    message: truckOk
      ? `Truck matches (${input.excelTruck})`
      : `Truck mismatch: Excel "${input.excelTruck}" vs memo "${input.truckOnMemo ?? 'not found'}"`,
  });
  if (!truckOk) {
    rejectionReasons.push(
      `Truck mismatch: Excel ${input.excelTruck} vs memo ${input.truckOnMemo ?? 'not found'}`,
    );
  }

  const supplierOk = supplierNamesMatch(input.excelSupplier, input.supplierOnMemo);
  checks.push({
    code: 'supplier_match',
    passed: supplierOk,
    message: supplierOk
      ? `Supplier matches (${input.excelSupplier})`
      : `Supplier mismatch: Excel "${input.excelSupplier}" vs memo "${input.supplierOnMemo ?? 'not found'}"`,
  });
  if (!supplierOk) {
    rejectionReasons.push(
      `Supplier mismatch: Excel ${input.excelSupplier} vs memo ${input.supplierOnMemo ?? 'not found'}`,
    );
  }

  const authOk = input.isDigitalMemo || hasSignatureOrSeal(input.hasSignature, input.hasSeal);
  checks.push({
    code: 'signature_or_seal',
    passed: authOk,
    message: input.isDigitalMemo
      ? 'Digital memo — physical auth not required'
      : authOk
        ? `Auth present (signature=${input.hasSignature}, seal=${input.hasSeal})`
        : 'Missing signature and company seal on memo',
  });
  if (!authOk) {
    rejectionReasons.push('Missing signature and seal on loading memo');
  }

  const documentApproved = rejectionReasons.length === 0;
  const summaryReason = documentApproved
    ? 'Memo approved'
    : rejectionReasons.join(' | ');

  return { checks, rejectionReasons, documentApproved, summaryReason };
}
