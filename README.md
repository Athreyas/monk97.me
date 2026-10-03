# monk97.me

A personal site, a public status page for a home lab, and the collector that
feeds it. Static HTML and stdlib Python — no framework, no build step.

Live: **[monk97.me](https://monk97.me)** · **[lab.monk97.me](https://lab.monk97.me)**

## Layout

    sites/root/      monk97.me — landing page, résumé, selected work, projects
    sites/lab/       lab.monk97.me — status page + the Worker in front of it
    collector/       labpush — runs inside the network, pushes out
    scripts/         local preview, fixture generator, pre-deploy checks
    deploy/lab/      wrangler config for the lab Pages project

## How the status page gets its data

The page is static. A collector inside the network pushes to the edge; the
page reads whatever landed last.

    host ──POST /api/ingest (bearer)──► KV ──GET /api/status──► page
                                         └─ falls back to the shipped fixture

Two properties are deliberate:

- **Nothing addressable is published.** Public labels are constants in
  `collector/publish-map.json`, never derived from a monitor's real name. A
  service that is not in the map is not published — fail closed.
- **The edge refuses to publish an address even by mistake.** `_worker.js`
  walks every string in a push and rejects the whole document if any value
  looks like an IP, port, URL or internal hostname. The collector applies the
  same rule to itself before sending.

The repo therefore contains no host, port or address. Docs that do are in a
separate private repo.

## Local preview

    ./scripts/serve.sh           # monk97.me on :8080
    ./scripts/serve.sh lab 8081  # lab.monk97.me on :8081

`serve.sh` mirrors Cloudflare Pages' routing (extensionless URLs, custom 404)
so links behave locally the way they will in production.

## Checks

    python3 scripts/make-fixture.py    # regenerate the sample feed
    python3 scripts/check-css.py       # every class in the HTML has a rule
    node    scripts/check-render.mjs   # each status view actually draws
    python3 scripts/stamp-assets.py    # content-hash asset URLs (before deploy)

## Deploy

    (cd deploy/lab && npx wrangler pages deploy --branch=production)

Run `stamp-assets.py` first — Pages caches assets for four hours, so an
unstamped deploy serves new markup against stale CSS.
