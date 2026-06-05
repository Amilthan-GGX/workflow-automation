import { config as loadDotenv } from 'dotenv';

import { configSchema, type AppConfig } from './schema.js';

loadDotenv();

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const rawEnv = {
    nodeEnv: process.env['NODE_ENV'],
    appVersion: process.env['APP_VERSION'],
    logLevel: process.env['LOG_LEVEL'],
    storage: {
      inboxPath: process.env['STORAGE_INBOX_PATH'],
      processedPath: process.env['STORAGE_PROCESSED_PATH'],
      failedPath: process.env['STORAGE_FAILED_PATH'],
      quarantinePath: process.env['STORAGE_QUARANTINE_PATH'],
      reportsPath: process.env['STORAGE_REPORTS_PATH'],
      tempPath: process.env['STORAGE_TEMP_PATH'],
      dbPath: process.env['STORAGE_DB_PATH'],
    },
    processing: {
      advancePercentage: process.env['ADVANCE_PERCENTAGE'],
      negativeMarginThreshold: process.env['NEGATIVE_MARGIN_THRESHOLD'],
      clientRateTolerancePct: process.env['CLIENT_RATE_TOLERANCE_PCT'],
      supplierPriceTolerancePct: process.env['SUPPLIER_PRICE_TOLERANCE_PCT'],
      lrNumberMinLength: process.env['LR_NUMBER_MIN_LENGTH'],
      dcTiersJson: process.env['DC_TIERS_JSON'],
    },
    excel: {
      freezeHeaderRow: process.env['EXCEL_FREEZE_HEADER_ROW'],
      autosizeColumns: process.env['EXCEL_AUTOSIZE_COLUMNS'],
      protectFormulaCells: process.env['EXCEL_PROTECT_FORMULA_CELLS'],
    },
    googleDrive: {
      enabled: process.env['GOOGLE_DRIVE_ENABLED'],
      folderId: process.env['GOOGLE_DRIVE_FOLDER_ID'],
      serviceAccountKeyPath: process.env['GOOGLE_SERVICE_ACCOUNT_KEY_PATH'],
    },
    events: {
      enabled: process.env['EVENTS_ENABLED'],
      telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'],
      telegramChatId: process.env['TELEGRAM_CHAT_ID'],
      slackWebhookUrl: process.env['SLACK_WEBHOOK_URL'],
    },
    browser: {
      headless: process.env['BROWSER_HEADLESS'],
      slowMo: process.env['BROWSER_SLOW_MO'],
      timeout: process.env['BROWSER_TIMEOUT'],
      downloadTimeout: process.env['BROWSER_DOWNLOAD_TIMEOUT'],
      sessionPath: process.env['BROWSER_SESSION_PATH'],
      debugPath: process.env['BROWSER_DEBUG_PATH'],
      tracesEnabled: process.env['BROWSER_TRACES_ENABLED'],
      screenshotsEnabled: process.env['BROWSER_SCREENSHOTS_ENABLED'],
      retryMax: process.env['BROWSER_RETRY_MAX'],
      retryBaseMs: process.env['BROWSER_RETRY_BASE_MS'],
      sessionSecret: process.env['BROWSER_SESSION_SECRET'],
      manualLoginTimeoutMs: process.env['BROWSER_MANUAL_LOGIN_TIMEOUT_MS'],
      chromeProfile: process.env['BROWSER_CHROME_PROFILE'],
      chromeProfileAllowlist: process.env['BROWSER_CHROME_PROFILE_ALLOWLIST'],
      chromeUserDataDir: process.env['BROWSER_CHROME_USER_DATA_DIR'],
      cdpUrl: process.env['BROWSER_CDP_URL'],
      cdpPort: process.env['BROWSER_CDP_PORT'],
    },
    digitify: {
      baseUrl: process.env['DIGITIFY_BASE_URL'],
      accountEmail: process.env['DIGITIFY_ACCOUNT_EMAIL'],
      loginUrlPaths: process.env['DIGITIFY_LOGIN_URL_PATHS'],
      statusFilterLabels: process.env['DIGITIFY_STATUS_FILTER'],
      statusColumnTitle: process.env['DIGITIFY_STATUS_COLUMN'],
      email: process.env['DIGITIFY_EMAIL'],
      password: process.env['DIGITIFY_PASSWORD'],
      downloadDateRangeDays: process.env['DIGITIFY_DOWNLOAD_DATE_RANGE_DAYS'],
      selectorExportButton: process.env['DIGITIFY_SELECTOR_EXPORT_BUTTON'],
      selectorDownloadMenuButton: process.env['DIGITIFY_SELECTOR_DOWNLOAD_MENU'],
      selectorExportDialog: process.env['DIGITIFY_SELECTOR_EXPORT_DIALOG'],
      selectorStatusFilterTrigger: process.env['DIGITIFY_SELECTOR_STATUS_FILTER'],
      idColumnTitle: process.env['DIGITIFY_ID_COLUMN'],
      priceValidationEnabled: process.env['DIGITIFY_PRICE_VALIDATION_ENABLED'],
      selectorIdFilterTrigger: process.env['DIGITIFY_SELECTOR_ID_FILTER'],
      selectorIdSearchInput: process.env['DIGITIFY_SELECTOR_ID_SEARCH_INPUT'],
      selectorLoadingMemoSection: process.env['DIGITIFY_SELECTOR_LOADING_MEMO_SECTION'],
      selectorLoadingMemoFiles: process.env['DIGITIFY_SELECTOR_LOADING_MEMO_FILES'],
      selectorLoadingMemoViewButton: process.env['DIGITIFY_SELECTOR_LOADING_MEMO_VIEW'],
      selectorDocumentImage: process.env['DIGITIFY_SELECTOR_DOCUMENT_IMAGE'],
      selectorPdfViewClick: process.env['DIGITIFY_SELECTOR_PDF_VIEW_CLICK'],
    },
    gemini: {
      apiKey: process.env['GEMINI_API_KEY'] ?? '',
      model: process.env['GEMINI_MODEL'],
      approverNamePattern: process.env['GEMINI_VASANTH_NAME_PATTERN'],
    },
    retention: {
      tempMaxAgeDays: process.env['RETENTION_TEMP_MAX_AGE_DAYS'],
      debugMaxAgeDays: process.env['RETENTION_DEBUG_MAX_AGE_DAYS'],
      reportsMaxAgeDays: process.env['RETENTION_REPORTS_MAX_AGE_DAYS'],
      tracesMaxAgeDays: process.env['RETENTION_TRACES_MAX_AGE_DAYS'],
    },
  };

  const result = configSchema.safeParse(rawEnv);

  if (!result.success) {
    const errors = result.error.flatten();
    console.error('[CONFIG] Invalid configuration:');
    console.error(JSON.stringify(errors, null, 2));
    process.exit(1);
  }

  cachedConfig = result.data;
  return cachedConfig;
}
