#!/usr/bin/env bash
# One-time sync: copy gogox Chrome profile (Default) into project automation dir.
# Quit Chrome (Cmd+Q) before running: npm run chrome:sync-profile
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

read_env_var() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 || true)"
  [[ -n "$line" ]] || return 0
  line="${line#*=}"
  if [[ "$line" == \"*\" ]]; then line="${line:1:${#line}-2}"; fi
  printf '%s' "$line"
}

PROFILE="$(read_env_var BROWSER_CHROME_PROFILE)"
PROFILE="${PROFILE:-Default}"
ALLOWLIST="$(read_env_var BROWSER_CHROME_PROFILE_ALLOWLIST)"
ALLOWLIST="${ALLOWLIST:-Default}"

if [[ "$ALLOWLIST" != *"$PROFILE"* ]]; then
  echo "Refusing to sync profile \"$PROFILE\" — not in allowlist ($ALLOWLIST)" >&2
  exit 1
fi

SRC_HOME="${HOME}/Library/Application Support/Google/Chrome"
SRC="${SRC_HOME}/${PROFILE}"
DST_ROOT="$(read_env_var BROWSER_CHROME_USER_DATA_DIR)"
DST_ROOT="${DST_ROOT:-$ROOT/storage/browser/chrome-cdp-data}"
DST_ROOT="${DST_ROOT/#\~/$HOME}"
[[ "$DST_ROOT" != /* ]] && DST_ROOT="$ROOT/$DST_ROOT"
DST="${DST_ROOT}/${PROFILE}"

if pgrep -xq "Google Chrome"; then
  echo "Quit Google Chrome (Cmd+Q), then run again." >&2
  exit 1
fi

if [[ ! -d "$SRC" ]]; then
  echo "Source profile not found: $SRC" >&2
  exit 1
fi

mkdir -p "$DST_ROOT"
rm -rf "$DST"
echo "Syncing Chrome profile \"${PROFILE}\" ..."
cp -R "$SRC" "$DST"
echo "Done: $DST"
echo "Next: npm run chrome:cdp  (terminal 1), then npm run digitify:uat-download"
