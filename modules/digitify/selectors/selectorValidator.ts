import type { Page } from 'playwright';

import type { AppLogger } from '../../../utils/logger.js';
import { SELECTORS, type SelectorKey } from './advancePage.js';

export type SelectorConfidence = 'high' | 'medium' | 'low' | 'unset';

export interface SelectorResult {
  key: SelectorKey;
  description: string;
  passed: boolean;
  matchedTier: 'primary' | 'fallback' | 'role' | null;
  matchedCount: number;
  confidence: SelectorConfidence;
  fallbackUsed: boolean;
  driftWarning: boolean;
  screenshotPath: string | null;
  error: string | null;
}

export interface ValidationMatrix {
  results: SelectorResult[];
  passed: number;
  failed: number;
  unset: number;
  driftWarnings: number;
  testedAt: string;
}

function computeConfidence(
  result: Pick<SelectorResult, 'matchedTier' | 'matchedCount' | 'passed'>,
): SelectorConfidence {
  if (!result.passed) return 'low';
  if (result.matchedTier === 'primary') return 'high';
  if (result.matchedTier === 'fallback') return 'medium';
  if (result.matchedTier === 'role') return 'medium';
  return 'low';
}

export async function validateAllSelectors(
  page: Page,
  debugDir: string,
  logger: AppLogger,
): Promise<ValidationMatrix> {
  const results: SelectorResult[] = [];
  const keys = Object.keys(SELECTORS) as SelectorKey[];

  for (const key of keys) {
    const def = SELECTORS[key];
    const result: SelectorResult = {
      key,
      description: def.description,
      passed: false,
      matchedTier: null,
      matchedCount: 0,
      confidence: 'low',
      fallbackUsed: false,
      driftWarning: false,
      screenshotPath: null,
      error: null,
    };

    // Track whether primary is unset (placeholder)
    const isPrimaryUnset = def.primary === null;
    if (isPrimaryUnset) {
      result.confidence = 'unset';
    }

    // Try primary
    if (def.primary) {
      try {
        const loc = page.locator(def.primary);
        const count = await loc.count();
        if (count > 0) {
          result.passed = true;
          result.matchedTier = 'primary';
          result.matchedCount = count;
          result.confidence = computeConfidence(result);
          results.push(result);
          continue;
        }
      } catch { /* try next */ }
    }

    // Try fallback
    if (def.fallback) {
      try {
        const loc = page.locator(def.fallback).first();
        const visible = await loc.isVisible({ timeout: 2000 }).catch(() => false);
        if (visible) {
          result.passed = true;
          result.matchedTier = 'fallback';
          result.matchedCount = await page.locator(def.fallback).count();
          result.fallbackUsed = true;
          result.driftWarning = !isPrimaryUnset; // primary was set but didn't match
          result.confidence = computeConfidence(result);
          results.push(result);
          continue;
        }
      } catch { /* try next */ }
    }

    // Try role
    if (def.role) {
      try {
        const loc = page.getByRole(def.role.role, { name: def.role.name });
        const count = await loc.count();
        if (count > 0) {
          result.passed = true;
          result.matchedTier = 'role';
          result.matchedCount = count;
          result.fallbackUsed = !isPrimaryUnset;
          result.driftWarning = !isPrimaryUnset;
          result.confidence = computeConfidence(result);
          results.push(result);
          continue;
        }
      } catch { /* all tiers failed */ }
    }

    // All tiers failed — capture debug artifacts
    result.error = 'No tier matched';
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      await fs.mkdir(debugDir, { recursive: true });
      const screenshotPath = path.join(debugDir, `selector-fail-${key}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      result.screenshotPath = screenshotPath;
    } catch { /* screenshot optional */ }

    logger.warn({ action: 'selector:failed', key, description: def.description });
    results.push(result);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const unset = results.filter((r) => r.confidence === 'unset' && r.passed).length;
  const driftWarnings = results.filter((r) => r.driftWarning).length;

  return { results, passed, failed, unset, driftWarnings, testedAt: new Date().toISOString() };
}
