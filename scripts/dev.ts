import { execSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { config as loadDotenv } from 'dotenv';

loadDotenv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';

const cdpUrl = (process.env['BROWSER_CDP_URL'] ?? 'http://127.0.0.1:9222').replace(/\/$/, '');
const launchLog = path.join(root, 'storage', 'temp', 'chrome-cdp-launch.log');

async function isCdpReady(): Promise<boolean> {
  try {
    const res = await fetch(`${cdpUrl}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

function isChromeRunning(): boolean {
  if (isWin) {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/NH'], { encoding: 'utf8' });
    return (r.stdout ?? '').toLowerCase().includes('chrome.exe');
  }
  const r = spawnSync('pgrep', ['-x', 'Google Chrome'], { encoding: 'utf8' });
  return r.status === 0;
}

async function killChrome(): Promise<void> {
  if (isWin) {
    spawnSync('taskkill', ['/F', '/IM', 'chrome.exe'], { encoding: 'utf8' });
  } else {
    spawnSync('pkill', ['-x', 'Google Chrome'], { encoding: 'utf8' });
  }
  await new Promise((r) => setTimeout(r, 2000));
}

function findChromeWin(): string {
  const candidates = [
    path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Google Chrome not found. Install Chrome or check the path in scripts/dev.ts');
  return found;
}

function startChromeCdp(): void {
  fs.mkdirSync(path.dirname(launchLog), { recursive: true });
  fs.writeFileSync(launchLog, `--- launch ${new Date().toISOString()} ---\n`);

  if (isWin) {
    const chromePath = findChromeWin();
    const port = process.env['BROWSER_CDP_PORT'] ?? '9222';
    const profile = process.env['BROWSER_CHROME_PROFILE'] ?? 'Default';
    const rawDataDir = process.env['BROWSER_CHROME_USER_DATA_DIR'] ?? './storage/browser/chrome-cdp-data';
    const userDataDir = path.isAbsolute(rawDataDir) ? rawDataDir : path.join(root, rawDataDir);
    const startUrl = process.env['DIGITIFY_BASE_URL'] ?? 'https://desk.digitify.app/payment';

    fs.appendFileSync(launchLog, `chrome: ${chromePath}\nprofile: ${userDataDir}/${profile}\n`);

    const child = spawn(
      chromePath,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        `--profile-directory=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        startUrl,
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    fs.appendFileSync(launchLog, `pid: ${child.pid}\n`);
    return;
  }

  const script = path.join(__dirname, 'launch-chrome-cdp.sh');
  const logFd = fs.openSync(launchLog, 'a');
  spawn('bash', [script], { detached: true, stdio: ['ignore', logFd, logFd], cwd: root }).unref();
}

async function waitForCdp(maxSeconds = 90): Promise<void> {
  for (let i = 0; i < maxSeconds; i++) {
    if (await isCdpReady()) {
      console.log(`CDP ready at ${cdpUrl}`);
      return;
    }

    if (i >= 4 && isChromeRunning() && fs.existsSync(launchLog)) {
      const log = fs.readFileSync(launchLog, 'utf8');
      if (/Quit ALL Chrome|Chrome is running but CDP/i.test(log)) {
        throw new Error(
          'Chrome is open without CDP on port 9222.\n' +
            '  Quit all Chrome (Task Manager -> end chrome.exe), then run: npm run dev\n' +
            `  Log: ${launchLog}`,
        );
      }
    }

    if (i === 0 || (i + 1) % 5 === 0) {
      process.stdout.write(`  waiting for CDP (${i + 1}s)…\n`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const logHint = fs.existsSync(launchLog)
    ? `\n  Launch log: ${launchLog}`
    : '';
  throw new Error(
    `CDP did not start on ${cdpUrl}.\n` +
      '  1. Quit all Chrome windows (Task Manager -> end chrome.exe)\n' +
      '  2. Run: npm run chrome:cdp:win\n' +
      '  3. Then: npm run dev' +
      logHint,
  );
}

if (await isCdpReady()) {
  console.log(`CDP already running at ${cdpUrl} — reusing session`);
} else {
  if (isChromeRunning()) {
    console.log('Chrome is running without CDP — closing it and relaunching with CDP…');
    await killChrome();
  } else {
    console.log('Starting Chrome with CDP…');
  }
  startChromeCdp();
  await waitForCdp();
}

await new Promise((r) => setTimeout(r, 1500));
execSync('npx tsx scripts/open-digitify.ts', { cwd: root, stdio: 'inherit' });
