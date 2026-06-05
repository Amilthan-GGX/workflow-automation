import os from 'os';
import path from 'path';

export function resolveChromeUserDataDir(configured?: string): string {
  const raw = configured?.trim();
  if (!raw) {
    throw new Error('BROWSER_CHROME_USER_DATA_DIR is required when BROWSER_CHROME_PROFILE is set.');
  }
  if (raw.startsWith('~/')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

/** Rejects profiles not listed in BROWSER_CHROME_PROFILE_ALLOWLIST. */
export function assertAllowedChromeProfile(
  profileDirectory: string,
  allowlist: readonly string[],
): void {
  if (allowlist.length === 0) {
    throw new Error('BROWSER_CHROME_PROFILE_ALLOWLIST must list at least one allowed profile.');
  }
  if (!allowlist.includes(profileDirectory)) {
    throw new Error(
      `BROWSER_CHROME_PROFILE "${profileDirectory}" is not in BROWSER_CHROME_PROFILE_ALLOWLIST ` +
        `(${allowlist.join(', ')}). Refusing to launch — other profiles must not be touched.`,
    );
  }
}

export function usesChromeProfile(chromeProfile?: string): boolean {
  return !!chromeProfile?.trim();
}

export function usesCdp(cdpUrl?: string): boolean {
  return !!cdpUrl?.trim();
}

/** Chrome profile or CDP — real browser session, not Playwright ephemeral. */
export function usesRealChromeSession(chromeProfile?: string, cdpUrl?: string): boolean {
  return usesCdp(cdpUrl) || usesChromeProfile(chromeProfile);
}
