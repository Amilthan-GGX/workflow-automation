import { chromium } from 'playwright';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const CDP_URL = process.env['BROWSER_CDP_URL'] ?? 'http://127.0.0.1:9222';
const BASE_URL = process.env['DIGITIFY_BASE_URL'] ?? 'https://desk.digitify.app/payment';

const browser = await chromium.connectOverCDP(CDP_URL, { isLocal: true, noDefaults: true });
const context = browser.contexts()[0]!;
const page = context.pages()[0] ?? await context.newPage();

if (!page.url().includes('/payment')) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
}

await page.waitForLoadState('networkidle').catch(() => undefined);

// "Access Denied" gate — click "Go to Main Page" if visible
const gateBtn = page.getByRole('button', { name: /go to main page/i });
if (await gateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
  console.log('Access Denied gate detected — clicking Go to Main Page');
  await gateBtn.click();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // now navigate to payment
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

console.log('Digitify open at', page.url());
await browser.close(); // detach playwright, Chrome stays open
