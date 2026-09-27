#!/usr/bin/env python3
"""Rewrite /assets/*.css and *.js references in each site's HTML to carry a
short content hash (?v=abcd1234).

Pages serves assets with max-age=14400, so a browser keeps a stylesheet for
four hours while the HTML updates instantly — a deploy then shows new markup
with old styles. A hash in the URL makes every changed asset a new URL, at
the edge and in the browser. Run before every deploy; idempotent.
"""
import hashlib, pathlib, re, sys

SITES = ['sites/root', 'sites/lab']
REF = re.compile(r'(?P<pre>(?:href|src)=")(?P<path>/assets/[\w./-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(?P<post>")')

changed = 0
for site in SITES:
    root = pathlib.Path(site)
    def stamp(m):
        f = root / m.group('path').lstrip('/')
        if not f.exists():
            print(f'  !! {site}: {m.group("path")} referenced but missing', file=sys.stderr)
            return m.group(0)
        h = hashlib.sha256(f.read_bytes()).hexdigest()[:8]
        return f'{m.group("pre")}{m.group("path")}?v={h}{m.group("post")}'
    for html in root.glob('*.html'):
        before = html.read_text()
        after = REF.sub(stamp, before)
        if after != before:
            html.write_text(after); changed += 1
            print(f'  stamped {html}')
print(f'{changed} file(s) updated')
