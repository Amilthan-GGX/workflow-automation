import fs from 'fs/promises';

import chalk from 'chalk';

import type { AppConfig } from '../../config/schema.js';
import type { AppLogger } from '../../utils/logger.js';

interface CheckResult {
  label: string;
  passed: boolean;
  detail: string;
}

async function isWritable(dir: string): Promise<boolean> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const testFile = `${dir}/.write-test-${Date.now()}`;
    await fs.writeFile(testFile, '');
    await fs.unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

export async function runStartupValidation(
  config: AppConfig,
  logger: AppLogger,
  options: { requireBrowser?: boolean } = {},
): Promise<boolean> {
  const checks: CheckResult[] = [];

  checks.push({
    label: 'NODE_ENV valid',
    passed: ['development', 'production', 'test'].includes(config.nodeEnv),
    detail: config.nodeEnv,
  });

  const tempWritable = await isWritable(config.storage.tempPath);
  checks.push({ label: 'storage/temp writable', passed: tempWritable, detail: config.storage.tempPath });

  if (options.requireBrowser) {
    const sessionSecretSet = !!process.env['BROWSER_SESSION_SECRET'];
    const keyLength = (process.env['BROWSER_SESSION_SECRET'] ?? '').length;
    const secretRequired = config.nodeEnv === 'production';

    checks.push({
      label: 'BROWSER_SESSION_SECRET set',
      passed: sessionSecretSet || !secretRequired,
      detail: sessionSecretSet
        ? `${keyLength} chars`
        : secretRequired
          ? 'NOT SET'
          : 'optional in development (CDP/Chrome profile)',
    });

    checks.push({
      label: 'DIGITIFY_BASE_URL configured',
      passed: !!config.digitify.baseUrl,
      detail: config.digitify.baseUrl,
    });

    const debugWritable = await isWritable(config.browser.debugPath);
    checks.push({
      label: 'storage/debug writable',
      passed: debugWritable,
      detail: config.browser.debugPath,
    });

    checks.push({
      label: 'browser retryMax sane (1–10)',
      passed: config.browser.retryMax >= 1 && config.browser.retryMax <= 10,
      detail: String(config.browser.retryMax),
    });
  }

  const failed = checks.filter((c) => !c.passed);
  const passed = checks.filter((c) => c.passed);

  if (process.stdout.isTTY) {
    console.log(chalk.bold('\n📋 Startup Validation'));
    checks.forEach((c) => {
      const icon = c.passed ? chalk.green('✓') : chalk.red('✗');
      const label = c.passed ? chalk.white(c.label) : chalk.red(c.label);
      const detail = chalk.gray(`(${c.detail})`);
      console.log(`  ${icon} ${label} ${detail}`);
    });
    console.log('');
  }

  logger.info({
    action: 'startup:config-fingerprint',
    env: config.nodeEnv,
    logLevel: config.logLevel,
    headless: config.browser.headless,
    eventsEnabled: config.events.enabled,
    sessionSecretSet: !!process.env['BROWSER_SESSION_SECRET'],
    checklist: { passed: passed.length, failed: failed.length },
  });

  if (failed.length > 0) {
    logger.error({ action: 'startup:validation-failed', failedChecks: failed.map((c) => c.label) });
    if (process.stdout.isTTY) {
      console.error(chalk.red(`\n✗ Startup validation failed. Fix ${failed.length} issue(s) above.\n`));
    }
    return false;
  }

  logger.info({ action: 'startup:validation-passed', checks: checks.length });
  return true;
}
