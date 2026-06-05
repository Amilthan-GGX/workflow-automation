import Table from 'cli-table3';
import chalk from 'chalk';

import { getConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { generateRunId } from '../utils/runId.js';
import { BrowserManager } from '../services/browser/browserManager.js';
import { SessionManager } from '../services/browser/sessionManager.js';
import { validateSession } from '../modules/digitify/auth/sessionValidator.js';
import { validateAllSelectors } from '../modules/digitify/selectors/selectorValidator.js';
import { ensureDir } from '../services/fileSystem/fileService.js';

const config = getConfig();
const logger = createLogger('validate-selectors');
const runId = generateRunId();
const debugDir = `${config.browser.debugPath}/${runId}-selectors`;

const browserManager = new BrowserManager(
  { ...config.browser, headless: false },
  logger,
  config.digitify.accountEmail,
);

async function main(): Promise<void> {
  console.log(chalk.bold.blue('\n🔍 Digitify Selector Validation\n'));

  await ensureDir(debugDir);

  const contextResult = await browserManager.acquire();
  if (!contextResult.ok) {
    console.error(chalk.red('Failed to launch browser:', contextResult.error.message));
    process.exit(1);
  }

  const context = contextResult.value;
  const page = await context.newPage();

  const sessionManager = new SessionManager(config.browser.sessionPath, logger);

  // Load existing session if available
  if (await sessionManager.exists()) {
    const sessionResult = await sessionManager.load();
    if (sessionResult.ok) {
      const valid = await validateSession(
        page,
        config.digitify.baseUrl,
        config.digitify.loginUrlPaths,
        logger,
      );
      if (!valid.valid) {
        console.log(chalk.yellow('⚠  Session expired — please log in manually in the browser window'));
        console.log(chalk.gray(`   Then navigate to: ${config.digitify.baseUrl}`));
        console.log(chalk.gray('   Press Ctrl+C when ready\n'));
        await new Promise((r) => setTimeout(r, 15_000));
      }
    }
  } else {
    console.log(chalk.yellow('⚠  No session found. Browser will open — log in manually.'));
    await page.goto(config.digitify.baseUrl);
    console.log(chalk.gray('   Press Ctrl+C after logging in, or wait 30s for auto-continue\n'));
    await new Promise((r) => setTimeout(r, 30_000));
  }

  console.log(chalk.cyan('Running selector validation on current page...\n'));

  const matrix = await validateAllSelectors(page, debugDir, logger);

  // Print results table
  const table = new Table({
    head: [
      chalk.white('Selector'),
      chalk.white('Status'),
      chalk.white('Tier'),
      chalk.white('Count'),
      chalk.white('Confidence'),
      chalk.white('Note'),
    ],
    colWidths: [28, 8, 10, 7, 12, 30],
    wordWrap: true,
  });

  for (const r of matrix.results) {
    const status = r.passed ? chalk.green('PASS') : chalk.red('FAIL');
    const tier = r.matchedTier ?? chalk.gray('—');
    const count = r.matchedCount > 0 ? String(r.matchedCount) : chalk.gray('0');
    const conf =
      r.confidence === 'high' ? chalk.green('high') :
      r.confidence === 'medium' ? chalk.yellow('medium') :
      r.confidence === 'unset' ? chalk.blue('unset*') :
      chalk.red('low');
    const note = r.driftWarning
      ? chalk.yellow('⚠ drift: primary missed')
      : r.confidence === 'unset'
      ? chalk.blue('TODO: set primary selector')
      : r.error ?? '';

    table.push([r.key, status, tier, count, conf, note]);
  }

  console.log(table.toString());

  // Summary
  console.log('\n' + chalk.bold('Summary:'));
  console.log(`  ${chalk.green('✓')} Passed:        ${matrix.passed}`);
  console.log(`  ${chalk.red('✗')} Failed:        ${matrix.failed}`);
  console.log(`  ${chalk.blue('○')} Unset (TODO):  ${matrix.unset}`);
  console.log(`  ${chalk.yellow('⚠')} Drift warnings: ${matrix.driftWarnings}`);

  if (matrix.failed > 0) {
    console.log(chalk.red(`\n  Screenshots saved to: ${debugDir}/`));
  }
  if (matrix.driftWarnings > 0) {
    console.log(chalk.yellow('\n  ⚠ Drift detected — primary selectors not matching, fallbacks in use.'));
    console.log(chalk.yellow('    Update modules/digitify/selectors/advancePage.ts with current selectors.'));
  }

  console.log('');

  await page.close();
  await browserManager.release();

  process.exit(matrix.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(chalk.red('Fatal error:', String(e)));
  browserManager.release().finally(() => process.exit(1));
});
