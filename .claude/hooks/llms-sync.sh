#!/usr/bin/env bash
# Fires after any Edit/Write. If the edited file was site content, checks
# whether llms.txt still agrees with it.
#
# llms.txt is a parallel source of truth that agents read as fact, so drift
# there is silent — nothing looks broken. This makes it noisy instead.
#
# Cheap and non-blocking: prints only when something is off, always exits 0.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

path=$(cat | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$path" ] || exit 0

case "$path" in
  */sites/root/llms.txt)                      exit 0 ;;  # editing it is not drift
  */sites/*|*/internal/lab-dashboard/apps.js) ;;         # site content — check it
  *)                                          exit 0 ;;
esac

if ! out=$("$ROOT/scripts/check-llms.sh" --quiet 2>&1); then
  printf 'llms.txt may be out of sync with this change:\n%s\n' "$out"
fi
exit 0
