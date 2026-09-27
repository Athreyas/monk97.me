#!/usr/bin/env python3
"""Static sanity check for a site's CSS + markup.

Catches the failure mode that bit this repo repeatedly: an edit that eats a
closing brace silently swallows every rule after it. The page still loads,
the stylesheet still returns 200, and only a screenshot reveals it.
"""
import re, sys, pathlib

FAIL = 0

def check(site_dir, css_name):
    global FAIL
    d = pathlib.Path(site_dir)
    css = (d / 'assets' / css_name).read_text()
    html = "\n".join(p.read_text() for p in d.glob('*.html'))
    js = "\n".join(p.read_text() for p in (d / 'assets').glob('*.js'))
    name = d.name

    # 1. braces
    stripped = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'),
                      css, flags=re.S)
    depth = stripped.count('{') - stripped.count('}')
    if depth:
        line, d2 = None, 0
        for i, l in enumerate(stripped.split('\n'), 1):
            b = d2; d2 += l.count('{') - l.count('}')
            if b == 0 and d2 > 0: line = i
            if d2 == 0: line = None
        print(f"  [{name}] FAIL unbalanced braces ({depth:+d}); "
              f"rule opened at line {line} is never closed")
        FAIL = 1
    else:
        print(f"  [{name}] ok   braces balanced")

    # 2. custom properties
    defined = set(re.findall(r'^\s+(--[a-z0-9-]+)\s*:', css, re.M))
    # only flag a var() with no fallback — var(--x, y) degrades safely
    used = {m.group(1) for m in re.finditer(r'var\(\s*(--[a-z0-9-]+)\s*([,)])', css)
            if m.group(2) == ')'}
    missing = sorted(used - defined)
    print(f"  [{name}] {'FAIL' if missing else 'ok  '} custom properties"
          + (f" — undefined: {', '.join(missing)}" if missing else ""))
    if missing: FAIL = 1

    # 3. classes referenced by markup or scripts but never styled
    cls = set()
    for m in re.findall(r'class="([^"]+)"', html): cls |= set(m.split())
    for m in re.findall(r"el\('[a-z]+',\s*'([^']+)'", js): cls |= set(m.split())
    for m in re.findall(r"classList\.(?:add|toggle)\('([^']+)'", js): cls |= set(m.split())
    cls = {c for c in cls if not c.startswith('s-')}
    styled = set(re.findall(r'\.([a-zA-Z][\w-]*)', css))
    orphan = sorted(c for c in cls if c not in styled)
    print(f"  [{name}] {'warn' if orphan else 'ok  '} classes"
          + (f" — unstyled (cosmetic): {', '.join(orphan)}" if orphan
             else f" ({len(cls)} checked)"))

print("css sanity")
check('sites/lab', 'lab.css')
check('sites/root', 'site.css')
sys.exit(FAIL)
