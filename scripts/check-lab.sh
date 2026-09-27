#!/usr/bin/env bash
# check-lab.sh — is lab.monk97.me reachable, and by whom?
#
# Run it from anywhere. It checks each layer separately, because
# "can I reach it" and "can a stranger reach it" are different questions
# and the answer you care about is usually the second one.
#
#   ./scripts/check-lab.sh

set -uo pipefail

HOST="${1:-lab.monk97.me}"

bold=$(tput bold 2>/dev/null || true); dim=$(tput dim 2>/dev/null || true)
red=$(tput setaf 1 2>/dev/null || true); grn=$(tput setaf 2 2>/dev/null || true)
ylw=$(tput setaf 3 2>/dev/null || true); rst=$(tput sgr0 2>/dev/null || true)

say() { printf '%s\n' "$*"; }
hdr() { printf '\n%s%s%s\n' "$bold" "$1" "$rst"; }

hdr "checking $HOST"

# ── 1. what the outside world sees ────────────────────────────────
# Asking public resolvers directly bypasses anything your own network
# is doing. This is the authoritative answer for "can a stranger find it".
hdr "1. public DNS  (what a stranger's resolver returns)"
PUBLIC=""
for r in 1.1.1.1 8.8.8.8 9.9.9.9; do
  ans=$(dig +short +time=3 +tries=1 "$HOST" A "@$r" 2>/dev/null | grep -E '^[0-9]' | tr '\n' ' ')
  if [ -n "$ans" ]; then
    say "   $r  →  ${grn}${ans}${rst}"
    PUBLIC="$ans"
  else
    say "   $r  →  ${dim}no record${rst}"
  fi
done

# ── 2. what YOU see ───────────────────────────────────────────────
# Differs from the above when split-horizon DNS is working: your
# resolver should hand back the internal address, not Cloudflare's.
hdr "2. your resolver  (what this machine returns)"
LOCAL=$(dig +short +time=3 +tries=1 "$HOST" A 2>/dev/null | grep -E '^[0-9]' | tr '\n' ' ')
if [ -n "$LOCAL" ]; then
  say "   →  ${grn}${LOCAL}${rst}"
else
  say "   →  ${dim}no record${rst}"
fi

# ── 3. is your way in switched on ─────────────────────────────────
hdr "3. tailscale  (your way in)"
TS_BIN=""
for c in tailscale /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
  command -v "$c" >/dev/null 2>&1 && { TS_BIN="$c"; break; }
  [ -x "$c" ] && { TS_BIN="$c"; break; }
done
TS_UP=0
if [ -n "$TS_BIN" ]; then
  if "$TS_BIN" status >/dev/null 2>&1; then
    say "   →  ${grn}connected${rst}"; TS_UP=1
  else
    say "   →  ${ylw}$("$TS_BIN" status 2>&1 | head -1)${rst}"
  fi
else
  say "   →  ${dim}tailscale not found on this machine${rst}"
fi

# ── 4. does it actually answer ────────────────────────────────────
hdr "4. https  (does anything answer)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://$HOST" 2>/dev/null)
if [ "$CODE" = "000" ] || [ -z "$CODE" ]; then
  say "   →  ${dim}no response${rst}"
else
  say "   →  HTTP ${CODE}"
  # Which page came back? The public placeholder announces itself.
  if curl -s --max-time 8 "https://$HOST" 2>/dev/null | grep -qi 'wrong side of the door'; then
    say "   →  ${ylw}this is the PUBLIC placeholder page${rst}"
  else
    say "   →  ${grn}this is not the placeholder — looks like the real service${rst}"
  fi
fi

# ── verdict ───────────────────────────────────────────────────────
hdr "verdict"
if [ -z "$PUBLIC" ]; then
  say "   ${grn}INVISIBLE${rst} — no public DNS record."
  say "   ${dim}No stranger can reach this host. Not firewalled, not 403'd:${rst}"
  say "   ${dim}the name does not resolve, so there is nothing to connect to.${rst}"
  [ -z "$LOCAL" ] && say "   ${dim}You cannot reach it either right now.${rst}"
  [ "$TS_UP" = "0" ] && say "   ${dim}Start Tailscale to get back in.${rst}"
else
  say "   ${ylw}PUBLISHED${rst} — the name resolves publicly to: $PUBLIC"
  if [ -n "$LOCAL" ] && [ "$LOCAL" != "$PUBLIC" ]; then
    say "   ${grn}Split-horizon is working${rst} — you get $LOCAL, strangers get $PUBLIC"
  elif [ -n "$LOCAL" ]; then
    say "   ${red}Split-horizon is NOT working${rst} — you are being sent to the"
    say "   ${red}public address too. Your internal DNS override is missing.${rst}"
  fi
fi

cat <<'NOTE'

  ── to check as a true outsider ──
  The DNS checks above already answer it: they query public resolvers
  directly, so your own network cannot skew them.

  If you want to see the page the way a stranger would:
    • phone with wifi OFF, on cellular — the simplest real outsider
    • https://dnschecker.org/#A/lab.monk97.me — DNS from ~20 countries
NOTE
