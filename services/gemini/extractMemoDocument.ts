import type { AppLogger } from '../../utils/logger.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import {
  extractHireRateFromText,
  reconcileOcrWithExcelBaseRate,
  type OcrSupplierPrice,
} from './extractSupplierPrice.js';

export interface MemoDocumentAnalysis {
  supplierPrice: number | null;
  priceReason: string;
  supplierNameOnMemo: string | null;
  truckNumberOnMemo: string | null;
  hasSignature: boolean;
  hasSeal: boolean;
  /** True when the memo is computer-generated/printed with no handwritten elements — physical auth not applicable. */
  isDigitalMemo: boolean;
  extractionNote: string;
  rawText?: string;
}

const MIN_HIRE_RATE = 5_000;
const MAX_HIRE_RATE = 9_999_999;
const MIN_MT_RATE = 50;
const MAX_MT_RATE = 50_000;
const DEFAULT_DISAMBIGUATION_TOLERANCE_PCT = 10;

const MEMO_ANALYSIS_PROMPT = `Analyze this Indian transport loading memo / loading advice / lorry hire slip photo or PDF.

Extract ALL of the following in one pass (layouts vary by supplier — read only THIS document):

1. **supplierPrice** — TRUCK HIRE rate in INR (base rate, not advance %, balance, weight MT alone). "35000 + 2000" → 35000. If the AMOUNT cell has a vertical table border at its left edge that could be mistaken for the digit 1, cross-check with the TOTAL box at the bottom — use whichever is most legible. Read what is written, not what you expect.
2. **supplierNameOnMemo** — Transporter / truck owner name on letterhead or top (e.g. "SOURASHTRA ROADLINES").
3. **truckNumberOnMemo** — Vehicle registration (e.g. "MH 24 AU 1555", "KA01AB1234") from any field labelled Truck No / Lorry No / Vehicle No / TRUCK TYPE/VEHICLE NO / Vehicle Registration / Veh. No.
4. **hasSignature** — true if handwritten signature or signatory mark visible (usually bottom).
5. **hasSeal** — true if rubber stamp / company seal visible.
6. **isDigitalMemo** — true if the document is fully computer-generated/system-printed with no handwritten elements (e-memo, online booking confirmation, digital lorry receipt). Physical signature/seal is not expected on these.
7. **extractionNote** — ≤12 words: list which fields were found or missing.

If a field is not visible, use null for strings/price and false for booleans.

JSON only:
{"supplierPrice":<int or null>,"supplierNameOnMemo":"<string or null>","truckNumberOnMemo":"<string or null>","hasSignature":<bool>,"hasSeal":<bool>,"isDigitalMemo":<bool>,"extractionNote":"<string>"}`;

const PER_MT_RATE_PROMPT = `Analyze this Indian transport loading memo / loading advice / lorry hire slip photo or PDF.

This supplier charges by weight (metric tons). Extract ALL of the following in one pass:

1. **supplierPrice** — RATE PER METRIC TON in INR/MT (not the total amount, not the weight). Example: "Rate: ₹1,200/MT" or "1200 per ton" → return 1200. Extract only the per-unit rate.
2. **supplierNameOnMemo** — Transporter / truck owner name on letterhead or top.
3. **truckNumberOnMemo** — Vehicle registration from any field labelled Truck No / Lorry No / Vehicle No / TRUCK TYPE/VEHICLE NO / Vehicle Registration / Veh. No.
4. **hasSignature** — true if handwritten signature visible.
5. **hasSeal** — true if rubber stamp / company seal visible.
6. **isDigitalMemo** — true if fully computer-generated with no handwritten elements.
7. **extractionNote** — ≤12 words: list which fields were found or missing.

If a field is not visible, use null for strings/price and false for booleans.

JSON only:
{"supplierPrice":<int or null>,"supplierNameOnMemo":"<string or null>","truckNumberOnMemo":"<string or null>","hasSignature":<bool>,"hasSeal":<bool>,"isDigitalMemo":<bool>,"extractionNote":"<string>"}`;

function buildContextPrompt(ctx: {
  excelPrice?: number;
  excelTruck?: string;
  excelSupplier?: string;
  priceMode?: 'hire-rate' | 'per-mt-rate';
}): string {
  const basePrompt = ctx.priceMode === 'per-mt-rate' ? PER_MT_RATE_PROMPT : MEMO_ANALYSIS_PROMPT;
  const lines = [
    'CONTEXT — use ONLY as a tiebreaker when two or more valid rates appear.',
    'Do NOT use this to override a single clearly visible amount on the document.',
  ];
  // For per-MT mode, excelPrice is the total (not the rate) — skip it to avoid confusing the model
  if (ctx.excelPrice && ctx.priceMode !== 'per-mt-rate') {
    lines.push(`- Expected hire rate ≈ ${ctx.excelPrice} INR`);
  }
  if (ctx.excelTruck?.trim()) lines.push(`- Expected truck: ${ctx.excelTruck.trim()}`);
  if (ctx.excelSupplier?.trim()) lines.push(`- Expected supplier: ${ctx.excelSupplier.trim()}`);
  return `${basePrompt}\n\n${lines.join('\n')}`;
}

const MEMO_SCHEMA = {
  type: 'object',
  properties: {
    supplierPrice: { type: 'number', nullable: true },
    supplierNameOnMemo: { type: 'string', nullable: true },
    truckNumberOnMemo: { type: 'string', nullable: true },
    hasSignature: { type: 'boolean' },
    hasSeal: { type: 'boolean' },
    isDigitalMemo: { type: 'boolean' },
    extractionNote: { type: 'string' },
  },
  required: ['hasSignature', 'hasSeal', 'isDigitalMemo', 'extractionNote'],
} as const;

export async function extractMemoDocument(
  buffer: Buffer,
  mimeType: string,
  options: {
    apiKey: string;
    model: string;
    logger: AppLogger;
    excelPrice?: number;
    excelTruck?: string;
    excelSupplier?: string;
    disambiguationTolerancePct?: number;
    /** 'per-mt-rate': extract rate per metric ton (Sunflag / weight-based suppliers). */
    priceMode?: 'hire-rate' | 'per-mt-rate';
  },
): Promise<Result<MemoDocumentAnalysis, Error>> {
  const { apiKey, model, logger } = options;
  const tolerancePct = options.disambiguationTolerancePct ?? DEFAULT_DISAMBIGUATION_TOLERANCE_PCT;
  const priceMode = options.priceMode ?? 'hire-rate';
  if (!apiKey.trim()) return err(new Error('GEMINI_API_KEY is not set'));

  const prompt = buildContextPrompt({ ...options, priceMode });
  const first = await callGeminiMemo(buffer, mimeType, prompt, apiKey, model, logger);
  if (!first.ok) return first;

  let analysis = normalizeAnalysis(first.value, logger, options.excelPrice, tolerancePct, undefined, priceMode);

  const needsRetry =
    analysis.supplierPrice === null ||
    analysis.truckNumberOnMemo === null ||
    analysis.supplierNameOnMemo === null;
  if (needsRetry) {
    logger.info({ action: 'gemini:memo-analysis-retry', reason: analysis.priceReason });
    const second = await callGeminiMemo(buffer, mimeType, prompt, apiKey, model, logger);
    if (second.ok) {
      analysis = normalizeAnalysis(second.value, logger, options.excelPrice, tolerancePct, analysis.rawText, priceMode);
    }
  }

  return ok(analysis);
}

/** Backward-compatible price-only wrapper (same single Gemini call). */
export async function extractSupplierPriceFromDocument(
  buffer: Buffer,
  mimeType: string,
  options: Parameters<typeof extractMemoDocument>[2],
): Promise<Result<OcrSupplierPrice, Error>> {
  const result = await extractMemoDocument(buffer, mimeType, options);
  if (!result.ok) return result;
  const v = result.value;
  return ok({
    supplierPrice: v.supplierPrice,
    reason: v.priceReason,
    rawText: v.rawText,
  });
}

async function callGeminiMemo(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  apiKey: string,
  model: string,
  logger: AppLogger,
): Promise<Result<MemoDocumentAnalysis & { rawText?: string }, Error>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: MEMO_SCHEMA,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return err(new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`));
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    logger.info({ action: 'gemini:memo-analysis', mimeType, bytes: buffer.length, preview: text.slice(0, 200) });

    const parsed = parseMemoJson(text);
    if (parsed) return ok({ ...parsed, rawText: text });

    return err(new Error(`Invalid memo analysis JSON: ${text.slice(0, 120)}`));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

function parseMemoJson(text: string): MemoDocumentAnalysis | null {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*"hasSignature"[\s\S]*\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      supplierPrice: parsePrice(o.supplierPrice),
      priceReason: String(o.extractionNote ?? ''),
      supplierNameOnMemo: parseStr(o.supplierNameOnMemo),
      truckNumberOnMemo: parseStr(o.truckNumberOnMemo),
      hasSignature: Boolean(o.hasSignature),
      hasSeal: Boolean(o.hasSeal),
      isDigitalMemo: Boolean(o.isDigitalMemo),
      extractionNote: String(o.extractionNote ?? ''),
    };
  } catch {
    return null;
  }
}

function parsePrice(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  // \d{2,7} — covers per-MT rates (₹50–₹99) as well as flat hire rates (₹5,000+)
  const digits = String(v).replace(/,/g, '').match(/\d{2,7}/);
  return digits ? Number(digits[0]) : null;
}

function parseStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function isPlausibleHireRate(n: number): boolean {
  return n >= MIN_HIRE_RATE && n <= MAX_HIRE_RATE;
}

function normalizeAnalysis(
  raw: MemoDocumentAnalysis & { rawText?: string },
  logger: AppLogger,
  excelPrice?: number,
  tolerancePct = DEFAULT_DISAMBIGUATION_TOLERANCE_PCT,
  priorRaw?: string,
  priceMode: 'hire-rate' | 'per-mt-rate' = 'hire-rate',
): MemoDocumentAnalysis {
  const mergedText = [priorRaw, raw.rawText].filter(Boolean).join('\n');
  let supplierPrice = raw.supplierPrice;
  let priceReason = raw.priceReason || raw.extractionNote;

  if (supplierPrice !== null) {
    supplierPrice = Math.round(supplierPrice);
    const inRange = priceMode === 'per-mt-rate'
      ? supplierPrice >= MIN_MT_RATE && supplierPrice <= MAX_MT_RATE
      : isPlausibleHireRate(supplierPrice);
    if (!inRange) {
      logger.warn({ action: 'gemini:price-out-of-range', supplierPrice, priceMode });
      supplierPrice = null;
      priceReason = priceMode === 'per-mt-rate' ? 'Per-MT rate out of range' : 'Hire rate out of range';
    }
  }

  // Regex fallback only for hire-rate mode (per-MT regex patterns need different ranges)
  if (supplierPrice === null && mergedText && priceMode === 'hire-rate') {
    const fallback = extractHireRateFromText(mergedText, excelPrice, tolerancePct);
    if (fallback !== null) {
      supplierPrice = fallback;
      priceReason = 'Regex fallback on model output';
    }
  }

  // Skip reconciliation for per-MT mode: excelPrice is the total, not the per-unit rate
  if (supplierPrice !== null && excelPrice !== undefined && priceMode === 'hire-rate') {
    const reconciled = reconcileOcrWithExcelBaseRate(
      supplierPrice,
      excelPrice,
      tolerancePct,
      priceReason,
    );
    if (reconciled.adjusted) {
      supplierPrice = reconciled.price;
      priceReason = reconciled.note ?? priceReason;
    }
  }

  return {
    supplierPrice,
    priceReason,
    supplierNameOnMemo: raw.supplierNameOnMemo,
    truckNumberOnMemo: raw.truckNumberOnMemo,
    hasSignature: raw.hasSignature,
    hasSeal: raw.hasSeal,
    isDigitalMemo: raw.isDigitalMemo,
    extractionNote: raw.extractionNote,
    rawText: mergedText,
  };
}
