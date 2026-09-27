/* lab.monk97.me — the thin edge in front of the static page.
 *
 *   GET  /api/status   latest collector push from KV, or the shipped fixture
 *   POST /api/ingest   the collector, with a bearer token, replaces it
 *   *                  static assets, untouched
 *
 * The feed carries labels, states and numbers. A push is refused outright
 * if anything in it looks like an address — the page must never be able to
 * publish one even if the collector is misconfigured.
 */
const LEAK = /\b(?:\d{1,3}\.){3}\d{1,3}\b|\.lab\.monk97\.me|\.lab\b|https?:\/\/|:\d{2,5}\b|\.local\b|\.ts\.net\b/i;
const MAX_BYTES = 64 * 1024;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/status') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method' }, 405);
      const latest = await env.LAB_STATUS.get('latest');
      if (latest) return new Response(latest, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-lab-source': 'collector' },
      });
      const fx = await env.ASSETS.fetch(new Request(new URL('/status.json', url), { method: 'GET' }));
      return new Response(fx.body, {
        status: fx.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-lab-source': 'fixture' },
      });
    }

    if (url.pathname === '/api/ingest') {
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      const auth = request.headers.get('authorization') || '';
      const token = env.INGEST_TOKEN || '';
      if (!token || !auth.startsWith('Bearer ') || !timingSafeEqual(auth.slice(7), token))
        return json({ error: 'unauthorized' }, 401);

      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: 'too large' }, 413);
      let doc;
      try { doc = JSON.parse(text); } catch { return json({ error: 'not json' }, 400); }
      if (doc.v !== 1 || !doc.summary || !Array.isArray(doc.categories) || !doc.generated_at)
        return json({ error: 'shape' }, 422);
      if (doc.fixture) return json({ error: 'fixture flag not allowed on a real push' }, 422);
      // walk every string in the document; refuse the whole push on the first address-like value
      const stack = [doc];
      while (stack.length) {
        const v = stack.pop();
        if (typeof v === 'string') { if (LEAK.test(v)) return json({ error: 'refused: value looks addressable' }, 422); }
        else if (v && typeof v === 'object') for (const k in v) stack.push(v[k]);
      }
      await env.LAB_STATUS.put('latest', text, { metadata: { at: doc.generated_at } });
      return json({ ok: true, at: doc.generated_at });
    }

    return env.ASSETS.fetch(request);
  },
};
