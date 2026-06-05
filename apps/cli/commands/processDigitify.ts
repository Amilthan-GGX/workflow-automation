import { Command } from 'commander';
import ora from 'ora';

import { getConfig } from '../../../config/index.js';
import { createRunLogger } from '../../../utils/logger.js';
import { generateRunId, generateCorrelationId } from '../../../utils/runId.js';
import { ensureDir } from '../../../services/fileSystem/fileService.js';
import type { WorkflowContext } from '../../../types/workflow.js';
import { runDigitifyDownloadPipeline } from '../../../workflows/digitify/downloadPipeline.js';
import { runStartupValidation } from '../../../services/startup/startupValidator.js';
import { installShutdownHandlers, registerCleanup } from '../../../services/shutdown/gracefulShutdown.js';
import { runAllRetentionPolicies } from '../../../services/retention/retentionService.js';
import { BrowserManager } from '../../../services/browser/browserManager.js';
import { createEventBus } from '../../../services/events/createEventBus.js';

export function buildProcessDigitifyCommand(): Command {
  const cmd = new Command('process:digitify');

  cmd
    .description('Login to Digitify, navigate to the Advance page, and download trip Excel')
    .option('--headless', 'Run browser in headless mode (requires pre-saved session or credentials in .env)')
    .option('--days <number>', 'Number of days to download', parseInt)
    .option('--skip-retention', 'Skip temp/debug file retention cleanup')
    .action(async (options: {
      headless?: boolean;
      days?: number;
      skipRetention?: boolean;
    }) => {
      const config = getConfig();

      config.browser.headless = options.headless === true;
      if (options.days !== undefined) {
        (config.digitify as { downloadDateRangeDays: number }).downloadDateRangeDays = options.days;
      }

      const runId = generateRunId();
      const correlationId = generateCorrelationId();
      const logger = createRunLogger('digitify-pipeline', runId);
      const eventBus = createEventBus(config, logger);

      installShutdownHandlers(logger);

      const valid = await runStartupValidation(config, logger, { requireBrowser: true });
      if (!valid) process.exit(1);

      await Promise.all([
        ensureDir(config.storage.tempPath),
        ensureDir(config.browser.debugPath),
      ]);

      const browserManager = new BrowserManager(
        config.browser,
        logger,
        config.digitify.accountEmail,
      );
      registerCleanup(async () => {
        await browserManager.release();
      });

      const spinner = ora('Connecting to Digitify...').start();

      const ctx: WorkflowContext = {
        runId,
        correlationId,
        logger,
        config,
        eventBus,
        startedAt: new Date(),
      };

      const result = await runDigitifyDownloadPipeline(ctx);
      spinner.stop();

      if (result.ok) {
        const { localPath, originalFilename, sizeBytes } = result.value;
        logger.info({ action: 'cli:download-complete', localPath, originalFilename, sizeBytes });
        console.log(`\n✓ Downloaded: ${originalFilename} (${(sizeBytes / 1024).toFixed(1)} KB)`);
        console.log(`  Saved to: ${localPath}`);

        if (!options.skipRetention) {
          await runAllRetentionPolicies([
            { dir: config.storage.tempPath, maxAgeDays: config.retention.tempMaxAgeDays, extensions: ['.xlsx', '.part'], label: 'temp' },
            { dir: config.browser.debugPath, maxAgeDays: config.retention.debugMaxAgeDays, extensions: ['.png', '.html', '.zip'], label: 'debug' },
          ], logger);
        }

        process.exit(0);
      } else {
        logger.error({ action: 'cli:fatal', error: result.error.message });
        console.error(`\n✗ Failed: ${result.error.message}`);
        console.error(`  Debug: ${config.browser.debugPath}/${runId}/`);
        process.exit(1);
      }
    });

  return cmd;
}
