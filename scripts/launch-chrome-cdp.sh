#!/usr/bin/env bash
# Launch Chrome with CDP on BROWSER_CDP_PORT (automation user-data dir — not system Chrome).
# First time: quit Chrome, run npm run chrome:sync-profile
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

read_env_var() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 || true)"
  [[ -n "$line" ]] || return 0
  line="${line#*=}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  if [[ "$line" == \"*\" ]]; then line="${line:1:${#line}-2}"; fi
  printf '%s' "$line"
}

if [[ -f "$ENV_FILE" ]]; then
  val="$(read_env_var BROWSER_CDP_PORT)"; [[ -n "$val" ]] && BROWSER_CDP_PORT="$val"
  val="$(read_env_var BROWSER_CHROME_PROFILE)"; [[ -n "$val" ]] && BROWSER_CHROME_PROFILE="$val"
  val="$(read_env_var BROWSER_CHROME_PROFILE_ALLOWLIST)"; [[ -n "$val" ]] && BROWSER_CHROME_PROFILE_ALLOWLIST="$val"
  val="$(read_env_var BROWSER_CHROME_USER_DATA_DIR)"; [[ -n "$val" ]] && BROWSER_CHROME_USER_DATA_DIR="$val"
  val="$(read_env_var DIGITIFY_BASE_URL)"; [[ -n "$val" ]] && DIGITIFY_BASE_URL="$val"
fi

PORT="${BROWSER_CDP_PORT:-9222}"
PROFILE="${BROWSER_CHROME_PROFILE:-Default}"
ALLOWLIST="${BROWSER_CHROME_PROFILE_ALLOWLIST:-Default}"
PAYMENT_URL="${DIGITIFY_BASE_URL:-https://desk.digitify.app/payment}"

if [[ "$ALLOWLIST" != *"$PROFILE"* ]]; then
  echo "Refusing to launch profile \"${PROFILE}\" — not in allowlist (${ALLOWLIST})" >&2
  exit 1
fi

USER_DATA="${BROWSER_CHROME_USER_DATA_DIR:-$ROOT/storage/browser/chrome-cdp-data}"
USER_DATA="${USER_DATA/#\~/$HOME}"
[[ "$USER_DATA" != /* ]] && USER_DATA="$ROOT/$USER_DATA"

PROFILE_DIR="${USER_DATA}/${PROFILE}"
if [[ ! -d "$PROFILE_DIR" ]]; then
  echo "Profile not found: ${PROFILE_DIR}" >&2
  echo "Run once (Chrome quit): npm run chrome:sync-profile" >&2
  exit 1
fi

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome not found at ${CHROME}" >&2
  exit 1
fi

if pgrep -xq "Google Chrome"; then
  echo "Quit Google Chrome (Cmd+Q), then run again." >&2
  exit 1
fi

echo "Starting Chrome profile \"${PROFILE}\" with CDP on port ${PORT}..."
echo "User data: ${USER_DATA}"

exec "$CHROME" \
  --remote-debugging-port="${PORT}" \
  --user-data-dir="${USER_DATA}" \
  --profile-directory="${PROFILE}" \
  --no-first-run \
  --no-default-browser-check \
  "${PAYMENT_URL}"
