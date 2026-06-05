/**
 * UAT: Digitify payment-page export → storage/inbox
 * Run: npm run digitify:uat-download
 *
 * Uses Chrome profile Default (nihas.n@gogox.com) when BROWSER_CHROME_PROFILE=Default.
 * Quit Google Chrome completely before running.
 */
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

import { getConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { BrowserManager } from '../services/browser/browserManager.js';
import { SessionManager } from '../services/browser/sessionManager.js';
import { usesChromeProfile, usesCdp } from '../services/browser/chromeProfile.js';
import { DigitifyClient } from '../modules/digitify/digitifyClient.js';
import type { BrowserSession } from '../modules/digitify/types.js';
import { ensureDir } from '../services/fileSystem/fileService.js';
import { isCdpReady } from '../utils/cdpHealth.js';

const config = getConfig();
const logger = createLogger('digitify-uat');

async function main(): Promise<void> {
  const paymentUrl = config.digitify.baseUrl;
  const inboxDir = config.storage.inboxPath;
  const chromeMode = usesChromeProfile(config.browser.chromeProfile);
  const cdpMode = usesCdp(config.browser.cdpUrl);

  console.log(chalk.bold.blue('\nDigitify UAT — export download\n'));
  console.log(chalk.gray(`  URL:    ${paymentUrl}`));
  console.log(chalk.gray(`  Inbox:  ${inboxDir}`));
  if (cdpMode) {
    const cdpUrl = config.browser.cdpUrl!;
    console.log(chalk.green(`  Mode:   CDP attach → ${cdpUrl}`));
    const ready = await isCdpReady(cdpUrl);
    if (!ready) {
      console.error(chalk.red('\n  CDP not reachable. In another terminal run:\n'));
      console.error(chalk.white('    npm run chrome:cdp\n'));
      console.error(chalk.gray('  First time only (Chrome quit): npm run chrome:sync-profile\n'));
      process.exit(1);
    }
    console.log(chalk.gray('  CDP OK — attached to debug Chrome\n'));
  } else if (chromeMode) {
    console.log(
      chalk.yellow(
        `  Chrome: profile "${config.browser.chromeProfile}" (allowlist: ${config.browser.chromeProfileAllowlist.join(', ')})`,
      ),
    );
    if (config.digitify.accountEmail) {
      console.log(chalk.gray(`  Account: ${config.digitify.accountEmail}`));
    }
    console.log(chalk.yellow('  → Quit Google Chrome completely, then run.\n'));
    console.log(
      chalk.gray('  Tip: use CDP instead — npm run chrome:cdp + BROWSER_CDP_URL in .env\n'),
    );
  } else {
    console.log('');
  }

  await ensureDir(inboxDir);

  const sessionManager = new SessionManager(config.browser.sessionPath, logger);
  let session: BrowserSession | undefined;

  if (!chromeMode && !cdpMode && (await sessionManager.exists())) {
    const loaded = await sessionManager.load();
    if (loaded.ok) session = loaded.value;
  }

  const browserManager = new BrowserManager(
    { ...config.browser, headless: false },
    logger,
    config.digitify.accountEmail,
  );

  const contextResult = await browserManager.acquire(session ? { session } : {});
  if (!contextResult.ok) {
    console.error(chalk.red(contextResult.error.message));
    process.exit(1);
  }

  const context = contextResult.value;
  const runId = `uat-${Date.now()}`;
  const client = new DigitifyClient(context, config, runId, logger);

  try {
    const loginResult = await client.login();
    if (!loginResult.ok) {
      console.error(chalk.red(`Login failed: ${loginResult.error.message}`));
      process.exit(1);
    }

    console.log(chalk.green(`✓ Session ready (${loginResult.value.sessionLoadedFrom})\n`));

    const navResult = await client.navigateToAdvance();
    if (!navResult.ok) {
      console.error(chalk.red(`Navigate failed: ${navResult.error.message}`));
      process.exit(1);
    }

    console.log(chalk.cyan('Status filter → download…\n'));

    const downloadResult = await client.downloadTrips({
      dateRangeDays: config.digitify.downloadDateRangeDays,
    });
    if (!downloadResult.ok) {
      console.error(chalk.red(`Download failed: ${downloadResult.error.message}`));
      process.exit(1);
    }

    const { localPath, originalFilename, sizeBytes } = downloadResult.value;
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10);
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    const destName = `${datePart}_${timePart}_${originalFilename}`;
    const destPath = path.join(inboxDir, destName);

    await fs.rename(localPath, destPath);

    console.log(chalk.green.bold('✓ UAT download OK\n'));
    console.log(chalk.white(`  File: ${destPath}`));
    console.log(chalk.gray(`  Size: ${sizeBytes} bytes\n`));
  } finally {
    await client.close();
    await browserManager.release();
  }
}

main().catch((e) => {
  console.error(chalk.red(String(e)));
  process.exit(1);
});
