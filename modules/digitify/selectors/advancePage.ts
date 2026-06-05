import type { Page, Locator } from 'playwright';

/**
 * Central selector registry for Digitify UI.
 *
 * HOW TO FILL IN PLACEHOLDERS:
 *  1. Open Digitify in Chrome (logged in)
 *  2. Right-click the element → Inspect
 *  3. Look for data-testid, id, or aria-label attributes first
 *  4. Paste the value into the `primary` field
 *  5. Run: npm run process:digitify -- --session-only to test
 *
 * Selector resolution order: primary → fallback → role (first match wins)
 */
export interface SelectorDefinition {
  /** data-testid or stable id attribute — most reliable */
  primary: string | null;
  /** CSS selector — use if no testid available */
  fallback: string | null;
  /** Playwright role-based selector — most resilient to DOM changes */
  role: { role: Parameters<Page['getByRole']>[0]; name: string | RegExp } | null;
  /** Human-readable description for error messages */
  description: string;
}

export const SELECTORS = {
  // ── Login Page ──────────────────────────────────────────────────────────
  loginEmailInput: {
    primary: null, // TODO: inspect Digitify login page, e.g. '[data-testid="email-input"]'
    fallback: 'input[type="email"]',
    role: { role: 'textbox', name: /email/i },
    description: 'Email input on login page',
  },

  loginPasswordInput: {
    primary: null, // TODO: e.g. '[data-testid="password-input"]'
    fallback: 'input[type="password"]',
    role: null,
    description: 'Password input on login page',
  },

  loginSubmitButton: {
    primary: null, // TODO: e.g. '[data-testid="login-submit"]'
    fallback: 'button[type="submit"]',
    role: { role: 'button', name: /sign in|log in|login/i },
    description: 'Login submit button',
  },

  loginErrorMessage: {
    primary: null, // TODO: e.g. '[data-testid="login-error"]'
    fallback: '.error-message, .alert-danger',
    role: { role: 'alert', name: /./ },
    description: 'Login error/alert message',
  },

  // ── Post-Login: Identity Verification ────────────────────────────────────
  userAvatarOrMenu: {
    primary: null, // TODO: top-right user avatar/menu — confirms we are logged in
    fallback: '[class*="user-menu"], [class*="avatar"]',
    role: { role: 'button', name: /account|profile|user/i },
    description: 'User menu/avatar — presence confirms authenticated session',
  },

  // ── Navigation: Advance Payment Section ──────────────────────────────────
  advanceNavLink: {
    primary: null, // TODO: e.g. '[data-testid="nav-advance-payment"]'
    fallback: 'a[href*="advance"]',
    role: { role: 'link', name: /advance/i },
    description: 'Sidebar/nav link to Advance Payment section',
  },

  advancePageHeading: {
    primary: null,
    fallback: 'h1, h2, [class*="page-title"]',
    role: { role: 'heading', name: /payment|advance/i },
    description: 'Page heading confirming payment section is loaded',
  },

  // ── Filters ───────────────────────────────────────────────────────────────
  dateRangeStartInput: {
    primary: null, // TODO: start date picker input
    fallback: 'input[placeholder*="start"], input[name*="start"]',
    role: { role: 'textbox', name: /start date|from/i },
    description: 'Date range start date input',
  },

  dateRangeEndInput: {
    primary: null, // TODO: end date picker input
    fallback: 'input[placeholder*="end"], input[name*="end"]',
    role: { role: 'textbox', name: /end date|to/i },
    description: 'Date range end date input',
  },

  applyFilterButton: {
    primary: null,
    fallback: 'button[class*="filter"], button[class*="search"]',
    role: { role: 'button', name: /apply|search|filter/i },
    description: 'Apply filters / search button',
  },

  statusFilterTrigger: {
    primary:
      'th.ant-table-cell:has(.ant-table-column-title:text-is("Status")) .ant-table-filter-trigger',
    fallback: '.ant-table-filter-column:has-text("Status") .ant-table-filter-trigger',
    role: null,
    description: 'Status column table filter icon',
  },

  statusFilterOkButton: {
    primary: '.ant-table-filter-dropdown:visible .ant-btn-primary',
    fallback: '.ant-table-filter-dropdown:visible button:has-text("OK")',
    role: { role: 'button', name: /^OK$/i },
    description: 'OK button in Status filter dropdown',
  },

  // ── Download (two-step: menu → export) ───────────────────────────────────
  downloadMenuButton: {
    primary: 'span.anticon-download, svg[data-icon="download"]',
    fallback: 'button:has(svg[data-icon="download"]), [aria-label="download"]',
    role: { role: 'button', name: /download/i },
    description: 'Download menu icon — opens export options',
  },

  exportButton: {
    primary: 'span.anticon-file-pdf, svg[data-icon="file-pdf"]',
    fallback: 'button:has(svg[data-icon="file-pdf"]), [aria-label="file-pdf"]',
    role: { role: 'button', name: /pdf|export/i },
    description: 'Export icon (file-pdf) after download menu is open',
  },

  downloadButton: {
    primary: null,
    fallback: 'button:has(svg[data-icon="download"])',
    role: { role: 'button', name: /download/i },
    description: 'Legacy alias for download menu button',
  },

  downloadConfirmButton: {
    primary: null, // TODO: if a confirmation modal appears before download
    fallback: null,
    role: { role: 'button', name: /confirm|yes|ok/i },
    description: 'Download confirmation modal button (if present)',
  },

  downloadProgressIndicator: {
    primary: null, // TODO: loading spinner or progress bar during export generation
    fallback: '[class*="loading"], [class*="spinner"]',
    role: null,
    description: 'Loading indicator while export is being generated',
  },

  // ── Results Table ─────────────────────────────────────────────────────────
  resultsTable: {
    primary: null, // TODO: main data table
    fallback: '.ant-table, table.ant-table, .ant-table-wrapper table, [class*="trips-table"]',
    role: { role: 'table', name: /./ },
    description: 'Trip results table on advance payment page',
  },

  noResultsMessage: {
    primary: null, // TODO: empty state message
    fallback: '[class*="empty"], [class*="no-data"]',
    role: null,
    description: 'Empty state message when no trips found',
  },
} as const satisfies Record<string, SelectorDefinition>;

export type SelectorKey = keyof typeof SELECTORS;

/**
 * Resolves a Locator for the given selector key using primary → fallback → role order.
 * Logs which tier matched. Throws a descriptive error if none match.
 */
export async function resolveSelector(
  page: Page,
  key: SelectorKey,
  timeoutMs = 5000,
): Promise<Locator> {
  const def = SELECTORS[key];

  // Tier 1: primary (data-testid / id)
  if (def.primary) {
    const loc = page.locator(def.primary);
    if (await loc.isVisible({ timeout: timeoutMs }).catch(() => false)) {
      return loc;
    }
  }

  // Tier 2: CSS fallback
  if (def.fallback) {
    const loc = page.locator(def.fallback).first();
    if (await loc.isVisible({ timeout: timeoutMs }).catch(() => false)) {
      return loc;
    }
  }

  // Tier 3: ARIA role
  if (def.role) {
    const loc = page.getByRole(def.role.role, { name: def.role.name });
    if (await loc.isVisible({ timeout: timeoutMs }).catch(() => false)) {
      return loc;
    }
  }

  throw new SelectorResolutionError(key, def.description, page.url());
}

export class SelectorResolutionError extends Error {
  constructor(
    public readonly key: string,
    public readonly description: string,
    public readonly pageUrl: string,
  ) {
    super(
      `Could not resolve selector "${key}" (${description}) on page: ${pageUrl}. ` +
        `Update modules/digitify/selectors/advancePage.ts with the correct selector.`,
    );
    this.name = 'SelectorResolutionError';
  }
}
