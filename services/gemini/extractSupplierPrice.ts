export interface OcrSupplierPrice {
  supplierPrice: number | null;
  reason: string;
  rawText?: string | undefined;
}

export { extractSupplierPriceFromDocument } from './extractMemoDocument.js';

const MIN_HIRE_RATE = 5_000;
const MAX_HIRE_RATE = 9_999_999;
const DEFAULT_DISAMBIGUATION_TOLERANCE_PCT = 10;

function isPlausibleHireRate(n: number, excelPrice?: number): boolean {
  if (n < MIN_HIRE_RATE || n > MAX_HIRE_RATE) return false;
  if (excelPrice !== undefined && excelPrice >= MIN_HIRE_RATE) {
    const diffPct = (Math.abs(excelPrice - n) / excelPrice) * 100;
    if (diffPct > 50 && n < excelPrice * 0.5) return false;
  }
  return true;
}

function withinTolerance(a: number, b: number, tolerancePct: number): boolean {
  if (a === 0) return b === 0;
  return (Math.abs(a - b) / Math.abs(a)) * 100 <= tolerancePct;
}

/**
 * Digitify Price is usually base hire. Memos often show base + detention (e.g. 35000 + 2000 → Freight 37000).
 * When OCR reads the footer total but Excel has the base rate, align to Excel.
 */
export function reconcileOcrWithExcelBaseRate(
  ocrPrice: number,
  excelPrice: number,
  tolerancePct: number,
  reason = '',
): { price: number; adjusted: boolean; note?: string } {
  if (withinTolerance(excelPrice, ocrPrice, tolerancePct)) {
    return { price: ocrPrice, adjusted: false };
  }

  const addon = ocrPrice - excelPrice;
  // Only reconcile when the extraction note explicitly mentions a freight/total field.
  // Without this guard, any OCR reading within 20% above Excel would be silently snapped
  // to the Excel price — which would hide genuine price mismatches on the memo.
  const looksLikeFreightTotal = /freight|total|grand/i.test(reason);

  if (
    ocrPrice > excelPrice &&
    addon >= 500 &&
    addon <= 15_000 &&
    addon / excelPrice <= 0.2 &&
    looksLikeFreightTotal
  ) {
    return {
      price: excelPrice,
      adjusted: true,
      note: `Base rate ${excelPrice} (memo shows ${ocrPrice} incl. add-ons)`,
    };
  }

  return { price: ocrPrice, adjusted: false };
}

function pickBestAmount(
  candidates: number[],
  excelPrice?: number,
  tolerancePct = DEFAULT_DISAMBIGUATION_TOLERANCE_PCT,
): number | null {
  const valid = candidates.filter((n) => isPlausibleHireRate(n, excelPrice));
  if (valid.length === 0) return null;
  if (excelPrice !== undefined && excelPrice >= MIN_HIRE_RATE) {
    const nearExcel = valid.reduce((best, n) =>
      Math.abs(n - excelPrice) < Math.abs(best - excelPrice) ? n : best,
    );
    if (withinTolerance(excelPrice, nearExcel, tolerancePct)) return nearExcel;
  }
  return Math.max(...valid);
}

/** Fallback when model returns null — many supplier label variants. */
export function extractHireRateFromText(
  text: string,
  excelPrice?: number,
  tolerancePct = DEFAULT_DISAMBIGUATION_TOLERANCE_PCT,
): number | null {
  const t = text.replace(/,/g, ' ');

  const labeled = [
    /rate\s*per\s*(?:ton|mt|tonne)[^0-9]{0,80}(\d{4,7})/i,
    /\brate\s*[/:]?\s*(?:per\s*)?(?:ton|mt)?[^0-9]{0,20}(\d{4,7})/i,
    /(?:hire|kiraya|bhada|भाड़ा|किराया)[^0-9]{0,40}(\d{4,7})/i,
    /freight\s*charg[^0-9]{0,50}(\d{4,7})/i,
    /\bfreight\s*[:.]?\s*(\d{4,7})\b/i,
    /lorry\s*hire[^0-9]{0,50}(\d{4,7})/i,
    /trip\s*rate[^0-9]{0,50}(\d{4,7})/i,
    /vehicle\s*rate[^0-9]{0,50}(\d{4,7})/i,
    /(?:fixed|contract)\s*[^0-9]{0,30}(\d{4,7})/i,
    /"supplierPrice"\s*:\s*(\d{4,7})/i,
  ];

  for (const re of labeled) {
    const m = t.match(re);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (isPlausibleHireRate(n, excelPrice)) return n;
    }
  }

  const plus = t.match(/(\d{4,7})\s*\+\s*\d+/);
  if (plus?.[1]) {
    const n = Number(plus[1]);
    if (isPlausibleHireRate(n, excelPrice)) return n;
  }

  const amounts = [...t.matchAll(/\b(\d{4,7})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => isPlausibleHireRate(n, excelPrice));
  return pickBestAmount(amounts, excelPrice, tolerancePct);
}
