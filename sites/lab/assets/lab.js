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
  /* The sealed destination only resolves on the private network. So the
   * question after unsealing is not "who are you" but "can this machine
   * reach it". A no-cors fetch of its /ping answers that: an opaque
   * response means yes, a network error means the tunnel is down. */

  var PENDING = 'monk97:lab:pending';      /* JSON {url, since} */
  var PENDING_TTL = 3 * 60 * 1000;         /* stop watching after three minutes */
  var POLL = 5000, PROBE_TIMEOUT = 4000;
  var timer = null, watching = null;

  var probe = function (url) {
    return new Promise(function (resolve) {
      var done = false, ctl = window.AbortController ? new AbortController() : null;
      var finish = function (ok) { if (!done) { done = true; clearTimeout(t); resolve(ok); } };
      var t = setTimeout(function () { if (ctl) ctl.abort(); finish(false); }, PROBE_TIMEOUT);
      try {
        fetch(url + 'ping', { mode: 'no-cors', cache: 'no-store', signal: ctl ? ctl.signal : undefined })
          .then(function () { finish(true); }, function () { finish(false); });
      } catch (e) { finish(false); }
    });
  };

  var stop = function () { if (timer) { clearTimeout(timer); timer = null; } };
  var clearWaiting = function () {
    stop(); watching = null;
    if (state) state.hidden = true;
    try { sessionStorage.removeItem(PENDING); } catch (e) {}
  };
  var go = function (url) { clearWaiting(); window.location.href = url; };

  /* show the notice and keep asking until the tunnel comes up or we give up */
  var watch = function (url, since) {
    if (!state) return;
    watching = url; state.hidden = false;
    since = since || Date.now();
    try { sessionStorage.setItem(PENDING, JSON.stringify({ url: url, since: since })); } catch (e) {}
    var loop = function () {
      probe(url).then(function (ok) {
        if (ok) return go(url);
        if (Date.now() - since > PENDING_TTL) { stop(); return; }   /* quiet; the buttons still work */
        timer = setTimeout(loop, POLL);
      });
    };
    stop(); timer = setTimeout(loop, POLL);
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
        api.print('checking the way in…');
        probe(url).then(function (ok) {
          if (ok) { api.print('open. going in.'); setTimeout(function () { go(url); }, 300); }
          else    { api.print('not reachable from here.'); watch(url); }
        });
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
  /* A reload while waiting resumes the watch, for as long as it is fresh. */

  try {
    var saved = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
    if (saved && saved.url && Date.now() - saved.since < PENDING_TTL) {
      watch(saved.url, saved.since);
      probe(saved.url).then(function (ok) { if (ok) go(saved.url); });
    } else if (saved) {
      sessionStorage.removeItem(PENDING);
    }
  } catch (e) {}

  var retry = $('.waiting__retry');
  if (retry) retry.addEventListener('click', function () {
    if (!watching) return;
    retry.disabled = true;
    probe(watching).then(function (ok) {
      retry.disabled = false;
      if (ok) go(watching); else watch(watching);
    });
  });
  var dismiss = $('.waiting__dismiss');
  if (dismiss) dismiss.addEventListener('click', clearWaiting);
})();
