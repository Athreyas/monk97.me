/* lab.monk97.me — what this page adds to the shared prompt.
 *
 * The prompt itself (open on "/", help, man, history, tab, every common
 * command) is site.js, the same file the root site runs. This file only
 * registers the lab's extras: the layout switch, a couple of overrides,
 * and the one thing that is deliberately not documented — the prompt will
 * unseal a destination if you type the right word into it. See
 * scripts/seal.mjs for what that is and, more importantly, what it isn't.
 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var state = $('.waiting');

  /* tells the shared engine where "home" is from here */
  window.__site = { name: 'lab', home: 'https://monk97.me' };

  /* ── unsealing ─────────────────────────────────────────────────── */

  var hex2buf = function (hex) {
    var b = new Uint8Array(hex.length / 2);
    for (var i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
    return b;
  };

  var sha = function (bytes) {
    return crypto.subtle.digest('SHA-256', bytes).then(function (d) { return new Uint8Array(d); });
  };

  /* keystream(key, n) — sha256(key || counter), concatenated. Mirrors seal.mjs. */
  var keystream = function (key, n) {
    var out = new Uint8Array(n);
    var written = 0, counter = 0;
    var step = function () {
      if (written >= n) return Promise.resolve(out);
      var seed = new Uint8Array(key.length + 1);
      seed.set(key, 0);
      seed[key.length] = counter++;
      return sha(seed).then(function (block) {
        var take = Math.min(block.length, n - written);
        out.set(block.subarray(0, take), written);
        written += take;
        return step();
      });
    };
    return step();
  };

  var unseal = function (word) {
    if (!window.__sealed || !window.crypto || !crypto.subtle) return Promise.resolve(null);
    var cipher = hex2buf(window.__sealed);
    return sha(new TextEncoder().encode(word.toLowerCase()))
      .then(function (key) { return keystream(key, cipher.length); })
      .then(function (ks) {
        var plain = new Uint8Array(cipher.length);
        for (var i = 0; i < cipher.length; i++) plain[i] = cipher[i] ^ ks[i];
        var text = new TextDecoder().decode(plain);
        return text.slice(0, 3) === 'ts:' ? text.slice(3) : null;   /* magic check */
      })
      .catch(function () { return null; });
  };

  /* ── the waiting state ─────────────────────────────────────────── */

  /* A timestamp, not a flag. A bare '1' can never expire, so it strands the
   * page in a waiting state for the rest of the browser session with no way
   * out. Storing when we left lets the state go stale on its own. */
  var PENDING = 'monk97:lab:pending';
  var PENDING_TTL = 3 * 60 * 1000;    /* after three minutes it means nothing */

  var goWaiting = function () {
    if (!state) return;
    state.hidden = false;
    try { sessionStorage.setItem(PENDING, String(Date.now())); } catch (e) {}
  };
  var clearWaiting = function () {
    if (state) state.hidden = true;
    try { sessionStorage.removeItem(PENDING); } catch (e) {}
  };

  /* ── extras for the shared prompt ──────────────────────────────── */

  var VIEWS = function () { return window.__labView; };

  window.__extraCommands = {
    /* layout is the visitor's choice and sticks per browser */
    view: function (arg, rest, api) {
      var V = VIEWS();
      if (!V) return api.print('view is unavailable.');
      if (!arg) { V.next(); return api.print('view=' + V.get()); }
      if (!V.set(arg)) return api.print('view takes: ' + V.all.join(', '));
      api.print('view=' + V.get());
    },

    /* here, `ls` lists the ways to look at the page rather than sections */
    ls: function (arg, rest, api) {
      var V = VIEWS();
      api.print(V ? V.all.map(function (v) { return v === V.get() ? v + '*' : v; }).join('  ')
                  : '(nothing here)');
      api.print('  <span class="console__dim">`view &lt;name&gt;` to switch · * is current</span>');
    },

    tree: function (arg, rest, api) {
      api.print('lab.monk97.me\n' +
                '├── /            this page — live service health\n' +
                '└── monk97.me    <span class="console__dim">the way back (`home`)</span>');
    },

    /* Anything unrecognised gets tried against the seal before it is
     * refused, so a wrong guess and a wrong command look identical. */
    __fallback: function (word, api) {
      return unseal(word).then(function (url) {
        if (!url) return false;
        api.print('authenticating…');
        goWaiting();
        setTimeout(function () { window.location.href = url; }, 500);
        return true;
      });
    },

    __man: {
      view: 'view [rows|terminal|table|cards] — how the health data is laid out. No argument cycles.',
      ls:   'ls — the available layouts; the current one is starred.',
      tree: 'tree — there is not much of one.'
    }
  };

  /* ── coming back ───────────────────────────────────────────────── */
  /* If you left for the login and returned, you are probably waiting for
   * DNS to start answering with the internal address. Say so, and offer a
   * cache-busting reload — that is the only lever a page has here. */

  try {
    var since = parseInt(sessionStorage.getItem(PENDING), 10);
    /* Show it once, then forget it. A plain reload should come back clean;
     * only `retry` re-arms it, because that is the one case where you are
     * knowingly still waiting. */
    if (since && Date.now() - since < PENDING_TTL && state) state.hidden = false;
    if (since) sessionStorage.removeItem(PENDING);
  } catch (e) {}

  var retry = $('.waiting__retry');
  if (retry) {
    retry.addEventListener('click', function () {
      try { sessionStorage.setItem(PENDING, String(Date.now())); } catch (e) {}
      location.replace(location.pathname + '?t=' + Date.now());
    });
  }
  var dismiss = $('.waiting__dismiss');
  if (dismiss) dismiss.addEventListener('click', clearWaiting);
})();
