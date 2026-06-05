import { z } from 'zod';

const booleanFromString = z
  .string()
  .transform((v) => v === 'true')
  .pipe(z.boolean());

const commaSeparatedList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  appVersion: z.string().default('1.0.0'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  storage: z.object({
    tempPath: z.string().default('./storage/temp'),
  }),

  events: z.object({
    enabled: booleanFromString.default('false'),
    telegramBotToken: z.string().optional(),
    telegramChatId: z.string().optional(),
    slackWebhookUrl: z.string().optional(),
  }),

  browser: z.object({
    headless: booleanFromString.default('false'),
    slowMo: z.coerce.number().default(0),
    timeout: z.coerce.number().default(30000),
    downloadTimeout: z.coerce.number().default(120000),
    sessionPath: z.string().default('./storage/browser/session.json'),
    debugPath: z.string().default('./storage/debug'),
    tracesEnabled: booleanFromString.default('true'),
    screenshotsEnabled: booleanFromString.default('true'),
    retryMax: z.coerce.number().default(3),
    retryBaseMs: z.coerce.number().default(2000),
    sessionSecret: z.string().optional(),
    manualLoginTimeoutMs: z.coerce.number().default(180000),
    chromeProfile: z.string().optional(),
    chromeProfileAllowlist: commaSeparatedList,
    chromeUserDataDir: z.string().optional(),
    /** Attach to Chrome already running with --remote-debugging-port (keeps your login). */
    cdpUrl: z.string().url().optional(),
    cdpPort: z.coerce.number().default(9222),
  }),

  digitify: z.object({
    baseUrl: z.string().url(),
    accountEmail: z.string().optional(),
    loginUrlPaths: commaSeparatedList,
    statusFilterLabels: commaSeparatedList,
    statusColumnTitle: z.string().min(1),
    idColumnTitle: z.string().default('Id'),
    email: z.string().optional(),
    password: z.string().optional(),
    downloadDateRangeDays: z.coerce.number().default(1),
    selectorExportButton: z.string().min(1),
    selectorDownloadMenuButton: z.string().min(1),
    selectorExportDialog: z.string().min(1),
    selectorStatusFilterTrigger: z.string().min(1),
    selectorIdFilterTrigger: z.string().optional(),
    selectorIdSearchInput: z.string().optional(),
    selectorLoadingMemoSection: z.string().optional(),
    selectorLoadingMemoFiles: z.string().optional(),
    selectorLoadingMemoViewButton: z.string().optional(),
    selectorDocumentImage: z.string().optional(),
    selectorPdfViewClick: z.string().optional(),
  }),

  gemini: z.object({
    apiKey: z.string().default(''),
    model: z.string().default('gemini-2.0-flash'),
    approverNamePattern: z.string().default('vasanth'),
  }),

  retention: z.object({
    tempMaxAgeDays: z.coerce.number().default(1),
    debugMaxAgeDays: z.coerce.number().default(7),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;
