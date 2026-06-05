/**
 * Poll Chrome DevTools Protocol endpoint until ready or timeout.
 */
export async function waitForCdp(
  cdpUrl: string,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<boolean> {
  const base = cdpUrl.replace(/\/$/, '');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function isCdpReady(cdpUrl: string): Promise<boolean> {
  return waitForCdp(cdpUrl, 3000, 300);
}
