/* status.js — renders the lab health page from a sanitized feed.
   The feed carries labels, states and percentages. Nothing addressable.

   Four presentations of the same data; the choice is the visitor's and
   persists per browser. Default is `rows`. */
(function () {
  'use strict';

  var FEED     = '/api/status';   /* the Worker: latest push, or the fixture if none */
  var FALLBACK = '/status.json';  /* local preview has no Worker */
  var REFRESH = 45000;            /* page -> worker */
  var DELAYED = 10 * 60 * 1000;   /* collector pushes at least every 5m */
  var STALE   = 60 * 60 * 1000;
  var VIEW_KEY = 'monk97:labview';
  var VIEWS = ['rows', 'terminal', 'table', 'cards'];

  var $ = function (s) { return document.querySelector(s); };
  var el = function (t, c, x) {
    var n = document.createElement(t);
    if (c) n.className = c;
    if (x != null) n.textContent = x;
    return n;
  };

  var STATE_TEXT = {
    operational: 'ALL SYSTEMS OPERATIONAL',
    degraded:    'DEGRADED PERFORMANCE',
    outage:      'SERVICE DISRUPTION',
    delayed:     'AWAITING FRESH TELEMETRY',
    stale:       'NO CONTACT FROM COLLECTOR',
    error:       'STATUS FEED UNREACHABLE'
  };

  var data = null, lastAt = null, lastState = 'operational', isFixture = false;

  /* ── view preference ─────────────────────────────────────────── */

  function viewGet() {
    var v;
    try { v = localStorage.getItem(VIEW_KEY); } catch (e) { v = null; }
    return VIEWS.indexOf(v) > -1 ? v : 'rows';
  }
  function viewSet(v) {
    if (VIEWS.indexOf(v) < 0) return false;
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
    paint();
    renderViewBtn();
    return true;
  }
  function viewNext() {
    var i = VIEWS.indexOf(viewGet());
    viewSet(VIEWS[(i + 1) % VIEWS.length]);
    return viewGet();
  }

  /* ── shared bits ─────────────────────────────────────────────── */

  function ago(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    return h < 48 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
  }

  /* 90 daily buckets is too dense to read small, so pair them up — 45 ticks
     of 2 days, each taking the worse of the two so an incident can never be
     averaged away. */
  function beatBar(beats, cls) {
    var bar = el('div', 'beats' + (cls ? ' ' + cls : ''));
    bar.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < beats.length; i += 2) {
      var a = beats[i], b = beats[i + 1];
      var v = (a == null || b == null) ? (a == null ? b : a) : Math.min(a, b);
      var t = el('i', 'beat-t');
      t.setAttribute('data-b',
        v == null ? 'n' : v >= 0.999 ? 'ok' : v >= 0.9 ? 'warn' : 'bad');
      bar.appendChild(t);
    }
    return bar;
  }

  var pct = function (n) { return n.toFixed(2) + '%'; };
  var dot = function (state) { return el('span', 'dot s-' + state); };

  /* ── view: rows (default) ────────────────────────────────────── */

  function viewRows(box, d) {
    var head = el('div', 'rowsHead');
    head.appendChild(el('span', null, 'SERVICE HEALTH'));
    head.appendChild(el('span', 'rowsHead__bar', 'LAST 90 DAYS'));
    head.appendChild(el('span', 'rowsHead__pct', 'UPTIME'));
    box.appendChild(head);

    d.categories.forEach(function (c) {
      var sec = el('div', 'cat');
      var top = el('div', 'cat__top');
      top.appendChild(dot(c.state));
      top.appendChild(el('span', 'cat__name', c.label));
      top.appendChild(beatBar(c.beats));
      top.appendChild(el('span', 'cat__pct', pct(c.uptime)));
      sec.appendChild(top);

      var list = el('div', 'svcs');
      c.services.forEach(function (s) {
        var r = el('div', 'svcrow');
        r.appendChild(dot(s.state));
        r.appendChild(el('span', 'svcrow__name', s.label));
        r.appendChild(el('span', 'svcrow__pct', pct(s.uptime)));
        list.appendChild(r);
      });
      sec.appendChild(list);
      box.appendChild(sec);
    });
  }

  /* ── view: terminal ──────────────────────────────────────────── */

  function viewTerminal(box, d) {
    var t = el('div', 'term');
    t.appendChild(el('div', 'term__cmd', '$ lab status --all'));

    d.categories.forEach(function (c) {
      var g = el('div', 'term__grp');
      var up = c.services.filter(function (s) { return s.state === 'up'; }).length;

      var h = el('div', 'term__cat');
      h.appendChild(dot(c.state));
      h.appendChild(el('span', 'term__unit', c.id));
      h.appendChild(el('span', 'term__meta',
        'active (' + up + '/' + c.services.length + ')'));
      h.appendChild(el('span', 'term__pct', pct(c.uptime)));
      g.appendChild(h);

      c.services.forEach(function (s) {
        var r = el('div', 'term__svc');
        r.appendChild(el('span', 'term__name', s.label.toLowerCase()));
        r.appendChild(el('span', 'term__st', s.state));
        r.appendChild(el('span', 'term__pct', pct(s.uptime)));
        g.appendChild(r);
      });
      t.appendChild(g);
    });

    t.appendChild(el('div', 'term__foot',
      d.categories.length + ' categories, ' + d.summary.services +
      ' services, ' + d.window_days + 'd window'));
    box.appendChild(t);
  }

  /* ── view: table ─────────────────────────────────────────────── */

  function viewTable(box, d) {
    var tb = el('div', 'tbl');
    var h = el('div', 'tbl__row tbl__row--head');
    ['SERVICE', 'CATEGORY', 'LAST 90 DAYS', 'UPTIME'].forEach(function (x, i) {
      h.appendChild(el('span', 'tbl__c tbl__c--' + i, x));
    });
    tb.appendChild(h);

    d.categories.forEach(function (c) {
      c.services.forEach(function (s) {
        var r = el('div', 'tbl__row');
        var n = el('span', 'tbl__c tbl__c--0');
        n.appendChild(dot(s.state));
        n.appendChild(el('span', null, s.label));
        r.appendChild(n);
        r.appendChild(el('span', 'tbl__c tbl__c--1', c.label));
        var b = el('span', 'tbl__c tbl__c--2');
        b.appendChild(beatBar(s.beats, 'beats--sm'));
        r.appendChild(b);
        r.appendChild(el('span', 'tbl__c tbl__c--3', pct(s.uptime)));
        tb.appendChild(r);
      });
    });
    box.appendChild(tb);
  }

  /* ── view: cards ─────────────────────────────────────────────── */

  function viewCards(box, d) {
    var grid = el('div', 'cards');
    d.categories.forEach(function (c) {
      var k = el('div', 'card');
      var h = el('div', 'card__h');
      h.appendChild(dot(c.state));
      h.appendChild(el('span', 'card__name', c.label));
      k.appendChild(h);

      k.appendChild(el('div', 'card__n', pct(c.uptime)));
      k.appendChild(beatBar(c.beats, 'beats--wide'));
      k.appendChild(el('div', 'card__meta',
        c.services.length + ' services · all operational'));

      var chips = el('div', 'card__chips');
      c.services.forEach(function (s) {
        chips.appendChild(el('span', 'chip', s.label));
      });
      k.appendChild(chips);
      grid.appendChild(k);
    });
    box.appendChild(grid);
  }

  var RENDER = {
    rows: viewRows, terminal: viewTerminal, table: viewTable, cards: viewCards
  };

  /* ── chrome ──────────────────────────────────────────────────── */

  function effectiveState(feedState, age) {
    if (isFixture)     return feedState;
    if (age > STALE)   return 'stale';
    if (age > DELAYED) return 'delayed';
    return feedState;
  }

  function paintStat() {
    var box = $('.cats__live');
    if (!box) return;
    var age = lastAt ? (Date.now() - lastAt.getTime()) : Infinity;
    var st  = lastAt ? effectiveState(lastState, age) : lastState;
    box.setAttribute('data-state', st);
    $('[data-stat-text]').textContent = STATE_TEXT[st] || STATE_TEXT.error;
    /* never let sample numbers pass as measured ones */
    $('[data-stat-age]').textContent =
      isFixture ? '· sample data, collector not yet connected'
                : (lastAt ? '· ' + ago(age) : '');
  }

  function vitals(sum, win) {
    var box = $('[data-vitals]');
    box.textContent = '';
    [[sum.services, 'SERVICES'], [sum.nodes, 'NODES'],
     [sum.uptime.toFixed(2) + '%', win + '-DAY'],
     [sum.gpus, sum.gpus === 1 ? 'GPU' : 'GPUS']].forEach(function (v) {
      var d = el('div', 'vital');
      d.appendChild(el('div', 'vital__n', String(v[0])));
      d.appendChild(el('div', 'vital__k', v[1]));
      box.appendChild(d);
    });
  }

  /* host vitals — a quiet strip of meters, not a dashboard */
  function hostStats(h) {
    var box = $('[data-host]');
    if (!box) return;
    if (!h) { box.hidden = true; return; }
    box.textContent = '';
    var meter = function (k, pct, v) {
      var m = el('div', 'meter');
      m.appendChild(el('span', 'meter__k', k));
      var bar = el('span', 'meter__bar'); bar.setAttribute('aria-hidden', 'true');
      var fill = el('i', 'meter__fill'); fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      if (pct >= 90) fill.setAttribute('data-hot', '1');
      bar.appendChild(fill); m.appendChild(bar);
      m.appendChild(el('span', 'meter__v', v));
      return m;
    };
    /* a code block: `$ host`, then CPU + GPU on one line, DISK + MEM on the next */
    box.appendChild(el('div', 'host__cmd', '$ host --vitals'));
    var row = el('div', 'host__row');
    row.appendChild(meter('CPU',  h.cpu_pct,  h.cpu_pct.toFixed(0) + '%'));
    if (h.gpu) row.appendChild(meter('GPU', h.gpu.util_pct, h.gpu.util_pct.toFixed(0) + '% \u00b7 ' + h.gpu.temp_c + '\u00b0C'));
    else row.appendChild(meter('LOAD', Math.min(100, 100 * h.load1 / Math.max(1, h.cores)), h.load1.toFixed(2)));
    row.appendChild(meter('DISK', h.disk_pct, h.disk_pct.toFixed(0) + '%'));
    row.appendChild(meter('MEM',  h.mem_pct,  h.mem_used_gb.toFixed(0) + ' / ' + h.mem_total_gb.toFixed(0) + ' GB'));
    box.appendChild(row);
    var bits = ['load ' + h.load1.toFixed(2) + ' on ' + h.cores + ' cores', 'up ' + h.uptime_days + 'd'];
    if (h.gpu && h.gpu.model) bits.push(h.gpu.model + ' \u00b7 ' + h.gpu.mem_pct.toFixed(0) + '% vram');
    box.appendChild(el('div', 'host__line', '# ' + bits.join('  \u00b7  ')));
    box.hidden = false;
  }

  /* host spec — what the box is, under what it is doing. Static between
     pushes, so it is rendered from whatever the feed last carried. */
  function hostSpec(rows) {
    var box = $('[data-spec]');
    if (!box) return;
    if (!rows || !rows.length) { box.hidden = true; return; }
    box.textContent = '';
    box.appendChild(el('div', 'host__cmd', '$ host --spec'));
    var grid = el('div', 'spec__grid');
    rows.forEach(function (r) {
      if (!r || !r.k || !r.v) return;
      grid.appendChild(el('span', 'spec__k', r.k));
      grid.appendChild(el('span', 'spec__v', r.v));
    });
    box.appendChild(grid);
    box.hidden = false;
  }

  function incidents(list) {
    var wrap = $('[data-inc]'), box = $('[data-inc-list]');
    if (!list || !list.length) { wrap.hidden = true; return; }
    box.textContent = '';
    list.forEach(function (i) {
      var r = el('div', 'incrow');
      r.appendChild(el('span', 'incrow__date', i.date));
      r.appendChild(el('span', 'incrow__title', i.title));
      var m = i.duration_min;
      r.appendChild(el('span', 'incrow__dur',
        m >= 1440 ? (Math.round(m / 144) / 10) + 'd'
        : m >= 60 ? (Math.round(m / 6) / 10) + 'h' : m + 'm'));
      box.appendChild(r);
    });
    wrap.hidden = false;
  }

  function paint() {
    if (!data) return;
    var box = $('[data-cats]');
    var v = viewGet();
    box.textContent = '';
    box.setAttribute('data-view', v);
    (RENDER[v] || viewRows)(box, data);
  }

  function render(d) {
    data = d;
    lastAt = new Date(d.generated_at);
    lastState = d.summary.state;
    isFixture = d.fixture === true;
    vitals(d.summary, d.window_days);
    hostStats(d.host);
    hostSpec(d.spec);
    paint();
    incidents(d.incidents);
    paintStat();
  }

  function load() {
    var get = function (u) {
      return fetch(u, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    };
    get(FEED)
      .catch(function () { return get(FALLBACK); })
      .then(render)
      .catch(function () {
        lastState = 'error'; lastAt = null; paintStat();
        var box = $('[data-cats]');
        if (box && !box.firstChild) {
          box.appendChild(el('p', 'skel', 'service health is not reachable right now.'));
        }
      });
  }

  /* ── controls ────────────────────────────────────────────────── */

  /* the theme button is owned by the shared engine (site.js) */

  var viewBtn = $('.viewsw'), viewVal = $('.viewsw__val');
  function renderViewBtn() {
    if (!viewBtn) return;
    if (viewVal) viewVal.textContent = viewGet();
    viewBtn.setAttribute('aria-label', 'Layout: ' + viewGet() + '. Activate to change.');
  }
  if (viewBtn) {
    renderViewBtn();
    viewBtn.addEventListener('click', function () { viewNext(); });
  }

  var rail = $('.rail');
  if (rail) {
  }

  /* the console reaches these */
  window.__labView = { get: viewGet, set: viewSet, next: viewNext, all: VIEWS };

  load();
  setInterval(load, REFRESH);
  setInterval(paintStat, 1000);
})();
