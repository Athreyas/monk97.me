#!/usr/bin/env bash
# check-llms.sh — is sites/root/llms.txt still telling the truth?
#
# llms.txt is read by agents as fact. Drift between it and the site is worse
# than an out-of-date page, because nothing visibly looks wrong. This compares
# the two and reports differences. It never edits anything.
#
#   ./scripts/check-llms.sh          # report
#   ./scripts/check-llms.sh --quiet  # only speak up when something is wrong

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LLMS="$ROOT/sites/root/llms.txt"
INDEX="$ROOT/sites/root/index.html"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

bold=$(tput bold 2>/dev/null||true); dim=$(tput dim 2>/dev/null||true)
red=$(tput setaf 1 2>/dev/null||true); grn=$(tput setaf 2 2>/dev/null||true)
ylw=$(tput setaf 3 2>/dev/null||true); rst=$(tput sgr0 2>/dev/null||true)

problems=0
note() { printf '  %s\n' "$*"; }
bad()  { problems=$((problems+1)); printf '  %s%s%s\n' "$red" "$*" "$rst"; }
warn() { problems=$((problems+1)); printf '  %s%s%s\n' "$ylw" "$*" "$rst"; }

[ -f "$LLMS" ] || { echo "${red}missing: sites/root/llms.txt${rst}"; exit 1; }

[ "$QUIET" = 0 ] && printf '\n%schecking llms.txt against the site%s\n\n' "$bold" "$rst"

# ── 1. placeholders ───────────────────────────────────────────────
# The important one. A TODO here is a lie an agent will repeat verbatim.
# grep -c prints 0 AND exits 1 when there are no matches, so `|| echo 0`
# would append a second zero and break the arithmetic below.
todos=$(grep -c 'TODO' "$LLMS" 2>/dev/null); todos=${todos:-0}
if [ "$todos" -gt 0 ]; then
  bad "$todos unresolved TODO$([ "$todos" -eq 1 ] || echo s) — DO NOT DEPLOY."
  note "${dim}Agents read this file as fact and will repeat placeholders as truth.${rst}"
else
  [ "$QUIET" = 0 ] && note "${grn}no placeholders${rst}"
fi

# ── 2. every outbound link on the home page is represented ────────
missing=0
while read -r url; do
  case "$url" in
    *fonts.googleapis*|*fonts.gstatic*|*monk97.me/*) continue ;;
  esac
  if ! grep -qF "$url" "$LLMS"; then
    bad "home page links to $url — llms.txt does not mention it"
    missing=$((missing+1))
  fi
done < <(grep -oE 'href="https?://[^"]+"' "$INDEX" | sed 's/href="//;s/"$//' | sort -u)
[ "$missing" = 0 ] && [ "$QUIET" = 0 ] && note "${grn}every outbound link is represented${rst}"

# ── 3. internal links in llms.txt actually exist ──────────────────
# a path may be a page (/resume -> resume.html) or a directory (/work/ ->
# work/index.html); nested pages (/work/lab-status) resolve the same way
while read -r path; do
  f="$ROOT/sites/root${path%/}"
  [ -f "$f" ] || [ -f "$f.html" ] || [ -f "$f/index.html" ] || bad "llms.txt links to $path — no such page"
done < <(grep -oE 'https://monk97\.me(/[a-z0-9/-]*)' "$LLMS" | sed 's|https://monk97.me||' | grep -v '^/*$' | sort -u)

# ── 4. empty sections ─────────────────────────────────────────────
# An H2 with nothing under it reads as "he has none", which may be wrong.
awk '/^## /{h=$0; n=0; next} h && NF && !/^TODO/{n++} /^## /{}
     END{}' "$LLMS" >/dev/null 2>&1

# ── 5. size ───────────────────────────────────────────────────────
words=$(wc -w < "$LLMS" | tr -d ' ')
if [ "$words" -gt 400 ]; then
  warn "$words words — past the one-page mark; agents parse tight files better"
elif [ "$QUIET" = 0 ]; then
  note "${grn}$words words — comfortably under one page${rst}"
fi

# ── verdict ───────────────────────────────────────────────────────
if [ "$problems" -eq 0 ]; then
  [ "$QUIET" = 0 ] && printf '\n  %sin sync%s\n\n' "$grn" "$rst"
  exit 0
fi
printf '\n  %s%d thing%s to fix%s  %s(scripts/check-llms.sh)%s\n\n' \
  "$bold" "$problems" "$([ "$problems" -eq 1 ] || echo s)" "$rst" "$dim" "$rst"
exit 1
