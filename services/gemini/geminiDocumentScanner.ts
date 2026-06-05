import type { AppLogger } from '../../utils/logger.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';

export interface VasanthApprovalResult {
  approved: boolean;
  reason: string;
  rawText?: string | undefined;
}

const DEFAULT_PROMPT = `You are reviewing a logistics trip document image for finance approval.
Determine if this shows email or written approval from "Vasanth" (or clear manager approval for a negative-margin trip).
Reply with JSON only: {"approved":true|false,"reason":"short explanation"}`;

export async function scanDocumentForVasanthApproval(
  buffer: Buffer,
  mimeType: string,
  options: {
    apiKey: string;
    model: string;
    approverPattern: RegExp;
    logger: AppLogger;
  },
): Promise<Result<VasanthApprovalResult, Error>> {
  const { apiKey, model, approverPattern, logger } = options;

  if (!apiKey.trim()) {
    return err(new Error('GEMINI_API_KEY is not set'));
  }

  const base64 = buffer.toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: DEFAULT_PROMPT },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return err(new Error(`Gemini API ${res.status}: ${text.slice(0, 300)}`));
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

    logger.info({ action: 'gemini:response', preview: text.slice(0, 200) });

    const parsed = parseJsonApproval(text);
    if (parsed) {
      return ok(parsed);
    }

    const approved =
      approverPattern.test(text) &&
      /approv|ok|yes|confirmed|granted/i.test(text);
    return ok({
      approved,
      reason: approved ? 'Keyword match in Gemini text' : 'No Vasanth approval detected',
      rawText: text,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

function parseJsonApproval(text: string): VasanthApprovalResult | null {
  const match = text.match(/\{[\s\S]*"approved"[\s\S]*\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as { approved?: boolean; reason?: string };
    if (typeof o.approved === 'boolean') {
      return {
        approved: o.approved,
        reason: String(o.reason ?? ''),
        rawText: text,
      };
    }
  } catch {
    return null;
  }
  return null;
}
