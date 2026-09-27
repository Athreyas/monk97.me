#!/usr/bin/env bash
# serve.sh — local preview that behaves like Cloudflare Pages.
#
# Pages serves resume.html at /resume and falls back to 404.html.
# Plain `python3 -m http.server` does neither, so links look broken
# locally even when they are correct. This closes that gap.
#
#   ./scripts/serve.sh           # root site on :8080
#   ./scripts/serve.sh lab  8081 # public lab dead end
#   ./scripts/serve.sh dash 8082 # internal dashboard (never deploy this one)

set -euo pipefail
SITE="${1:-root}"
PORT="${2:-8080}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$SITE" in
  dash|internal|dashboard) DIR="$ROOT/internal/lab-dashboard" ;;
  *)                       DIR="$ROOT/sites/$SITE" ;;
esac

[ -d "$DIR" ] || { echo "no such site: $DIR" >&2; exit 1; }

echo "serving $SITE on http://127.0.0.1:$PORT  (ctrl-c to stop)"

python3 - "$DIR" "$PORT" <<'PY'
import http.server, os, socketserver, sys

directory, port = sys.argv[1], int(sys.argv[2])

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=directory, **kw)

    def translate_path(self, path):
        full = super().translate_path(path)
        # /resume -> resume.html, the way Pages does it
        if not os.path.exists(full) and not path.rstrip('/').endswith('.html'):
            candidate = full.rstrip('/') + '.html'
            if os.path.isfile(candidate):
                return candidate
        return full

    def send_error(self, code, message=None, explain=None):
        custom = os.path.join(directory, '404.html')
        if code == 404 and os.path.isfile(custom):
            body = open(custom, 'rb').read()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', port), Handler) as httpd:
    httpd.serve_forever()
PY
