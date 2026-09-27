#!/usr/bin/env bash
# sync-shared.sh — the prompt engine and theme bootstrap are one file each,
# owned by sites/root. The lab runs the same files; this copies them across
# so the two hosts cannot drift. Run before stamp-assets.py (it changes
# hashes). With --check it only verifies and exits non-zero on drift.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
SHARED=(site.js theme.js)
rc=0
for f in "${SHARED[@]}"; do
  src="sites/root/assets/$f"; dst="sites/lab/assets/$f"
  if [ "${1:-}" = "--check" ]; then
    if ! cmp -s "$src" "$dst"; then echo "  drift: $dst differs from $src"; rc=1; else echo "  ok   $f identical"; fi
  else
    cp "$src" "$dst"; echo "  synced $f"
  fi
done
exit $rc
