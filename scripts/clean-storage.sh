#!/usr/bin/env bash
# Wipe runtime storage for a fresh digitify:full / process:inbox run.
# Keeps browser profile + session (no re-login). Use --all-browser to clear debug traces only under storage/debug.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORAGE="$ROOT/storage"

KEEP_BROWSER=1
for arg in "$@"; do
  case "$arg" in
    --all-browser) KEEP_BROWSER=0 ;;
    -h|--help)
      echo "Usage: npm run clean:storage [-- --all-browser]"
      echo ""
      echo "Removes inbox, processed, failed, quarantine, reports, temp, debug, SQLite manifest."
      echo "Does not remove storage/browser/ (Chrome profile + session.json)."
      echo "  --all-browser  Also clears storage/debug (screenshots, Playwright traces)."
      exit 0
      ;;
  esac
done

clean_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  find "$dir" -mindepth 1 ! -name '.gitkeep' ! -name '.DS_Store' -delete 2>/dev/null || true
  touch "$dir/.gitkeep" 2>/dev/null || true
}

echo ""
echo "━━━ Cleaning storage (fresh run) ━━━"

for sub in inbox processed reports temp quarantine; do
  clean_dir "$STORAGE/$sub"
  echo "  cleared storage/$sub/"
done

clean_dir "$STORAGE/failed"
# Nested quarantine path from config default
clean_dir "$STORAGE/failed/quarantine"

if [[ "$KEEP_BROWSER" -eq 0 ]]; then
  clean_dir "$STORAGE/debug"
  echo "  cleared storage/debug/"
else
  clean_dir "$STORAGE/debug"
  echo "  cleared storage/debug/ (browser profile kept under storage/browser/)"
fi

rm -f "$STORAGE/db/orchestrator.sqlite" \
      "$STORAGE/db/orchestrator.sqlite-shm" \
      "$STORAGE/db/orchestrator.sqlite-wal" 2>/dev/null || true
echo "  reset storage/db/orchestrator.sqlite"

# Stop stray CDP Chrome from prior runs (optional, avoids profile lock confusion)
if pgrep -f "remote-debugging-port=9222" >/dev/null 2>&1; then
  echo "  stopping CDP Chrome on port 9222…"
  pkill -f "remote-debugging-port=9222" 2>/dev/null || true
fi

echo ""
echo "Done. Fresh run:"
echo "  npm run digitify:full"
echo ""
