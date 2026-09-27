/* monk97.me — rail, section navigation, reveals, prompt.
 *
 * All of this is enhancement. With JS off the page is a plain, complete,
 * scrollable document and every link still works.
 */
(function () {
  'use strict';

  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var sections = $$('[data-nav]');
  var currentIdx = 0;

  /* ── the rail: a status line that tracks where you are ─────────── */

  var rail = $('.rail');
  var railSeg = $('.rail__seg');


  /* ── left rail: continuous progress + one tick per section ─────── */

  var progress = $('.progress');
  var fill = $('.progress__fill');
  var ticks = [];

  var jumpTo = function (i) {
    if (!sections[i]) return;
    currentIdx = i;
    sections[i].scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  };

  if (progress && sections.length > 1) {
    /* Ticks are the navigation: visible, clickable, and they double as a
     * map of how much page is left. No modal, no keyboard shortcut to learn. */
    sections.forEach(function (sec, i) {
      var t = document.createElement('button');
      t.type = 'button';
      t.className = 'progress__tick';
      t.setAttribute('aria-label', 'Jump to ' + sec.getAttribute('data-nav'));
      t.innerHTML = '<span class="progress__tip">' + sec.getAttribute('data-nav') + '</span>';
      t.addEventListener('click', function () { jumpTo(i); });
      progress.appendChild(t);
      ticks.push(t);
    });

    var placeTicks = function () {
      var docH = document.documentElement.scrollHeight;
      sections.forEach(function (sec, i) {
        var top = sec.getBoundingClientRect().top + window.scrollY;
        ticks[i].style.top = Math.min(98, (top / docH) * 100) + '%';
      });
    };
    placeTicks();
    window.addEventListener('resize', placeTicks, { passive: true });
    window.addEventListener('load', placeTicks);
  }

  if (fill) {
    var ticking = false;
    var paint = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var pct = max > 0 ? (window.scrollY / max) * 100 : 0;
      fill.style.height = Math.min(100, Math.max(0, pct)) + '%';
      ticking = false;
    };
    paint();
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(paint); }
    }, { passive: true });
    window.addEventListener('resize', paint, { passive: true });
  }

  /* ── which section owns the viewport ───────────────────────────── */

  if (sections.length && 'IntersectionObserver' in window) {
    var current = null;
    var watcher = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        currentIdx = sections.indexOf(e.target);
        ticks.forEach(function (t, i) { t.classList.toggle('is-here', i === currentIdx); });

        var path = e.target.getAttribute('data-path');
        if (railSeg && path !== null && path !== current) {
          current = path;
          railSeg.style.opacity = '0';
          setTimeout(function () {
            railSeg.textContent = path;
            railSeg.style.opacity = '1';
          }, still ? 0 : 130);
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    sections.forEach(function (s) { watcher.observe(s); });
  }

  /* ── reveals: once, on entry, never on a timer ─────────────────── */

  var reveals = $$('.reveal');
  if (reveals.length) {
    if (still || !('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      var revealer = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('is-in');
          obs.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
      reveals.forEach(function (el) { revealer.observe(el); });

      /* Failsafe. Hidden AND on screen is a blank page, which is a far worse
       * failure than an animation that skipped. */
      var sweep = function () {
        reveals.forEach(function (el) {
          if (el.classList.contains('is-in')) return;
          var r = el.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in');
        });
      };
      window.addEventListener('load', sweep);
      setTimeout(sweep, 2500);
    }
  }

  /* ── theme ─────────────────────────────────────────────────────── */

  var themeBtn = $('.theme');
  var themeVal = $('.theme__val');
  var renderTheme = function () {
    if (!themeBtn || !window.__theme) return;
    var mode = window.__theme.get();
    if (themeVal) themeVal.textContent = mode;
    themeBtn.setAttribute('aria-label', 'Colour theme: ' + mode + '. Activate to change.');
  };
  if (themeBtn && window.__theme) {
    renderTheme();
    themeBtn.addEventListener('click', function () { window.__theme.next(); renderTheme(); });
  }

  /* ── the typed line ────────────────────────────────────────────── */

  var typed = $('#term-text');
  if (typed && window.PHRASES && window.PHRASES.length > 1 && !still) {
    var P = window.PHRASES;
    var idx = 0, n = P[0].length, erasing = true, alive = true;
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { alive = es[0].isIntersecting; }).observe(typed);
    }

    wait(2400).then(function step() {
      if (!alive) return wait(600).then(step);
      if (erasing) {
        n -= 1;
        typed.textContent = P[idx].slice(0, n);
        if (n === 0) { erasing = false; idx = (idx + 1) % P.length; return wait(400).then(step); }
        return wait(28).then(step);
      }
      n += 1;
      typed.textContent = P[idx].slice(0, n);
      if (n === P[idx].length) { erasing = true; return wait(2400).then(step); }
      return wait(55).then(step);
    });
  }

  /* ── the prompt ────────────────────────────────────────────────── */
  /* Opens on "/" — the same key that opens search almost everywhere,
   * so it is guessable without being announced. */

  var HISTORY = [];
  var histPos = 0;

  var con = $('.console');
  var input = con && $('.console__in', con);
  var out   = con && $('.console__out', con);

  var openConsole = function () {
    if (!con) return;
    con.classList.add('is-open');
    con.setAttribute('aria-hidden', 'false');
    input.focus();
  };
  var closeConsole = function () {
    if (!con) return;
    con.classList.remove('is-open');
    con.setAttribute('aria-hidden', 'true');
    input.value = '';
    input.blur();
  };
  var print = function (html) {
    out.innerHTML += (out.innerHTML ? '\n' : '') + html;
    out.scrollTop = out.scrollHeight;
  };
  var esc = function (s) {
    return String(s).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; });
  };

  var openLink = function (which) {
    var el = $('[data-link="' + which + '"]');
    if (!el) { print(which + ': no link on this page.'); return; }
    print('→ ' + which);
    window.open(el.href, '_blank', 'noopener');
  };

  var BOOTED = Date.now();

  var MAN = {
    ls:       'ls — list the sections of this page.',
    cd:       'cd <section> — scroll to one. `cd` alone goes to the top.',
    whoami:   'whoami — what your browser volunteered about you. Not much.',
    home:     'home — back to the front page.',
    resume:   'resume — the long version, on its own page.',
    theme:    'theme [auto|light|dark] — no argument cycles.',
    settings: 'settings [name] [value] — theme and motion. No argument lists them; `settings reset` clears.',
    lab:      'lab — live service health for the home lab. Opens in a new tab.',
    neofetch: 'neofetch — the obligatory one.',
    uptime:   'uptime — how long this tab has been open, and how long the domain has.',
    source:   'source — this site is static files. Go and read them.',
    echo:     'echo <words> — says them back. That is the whole feature.',
    history:  'history — what you have typed. Up and down arrows work too.',
    man:      'man <command> — you are doing it.',
    weather:  'weather — conditions where you are. Geolocated from your IP by wttr.in; nothing is stored.',
    fortune:  'fortune — a dry line, chosen at random.',
    whois:    'whois — the registration facts, such as they are.',
    contact:  'contact — the fastest way to reach a human here.',
    hire:     'hire — contact, with the subtext made text.',
    ask:      'ask <question> — not wired up yet. It will be.',
    cowsay:   'cowsay <words> — a cow says them. Load-bearing.',
    tree:     'tree — what is actually on this domain.',
    ping:     'ping — times a real round trip to this page.',
    sudo:     'sudo — no.'
  };

  /* Rotating, deliberately dry. Nothing here needs a setup. */
  var FORTUNES = [
    'it works on my machine, and my machine is in the next room.',
    'every system is temporary. some are just temporary for longer.',
    'the documentation was written by someone who had already solved it.',
    'there are two hard problems, and the third is off-by-one.',
    'a backup you have never restored is a rumour.',
    'the outage is never in the part you rewrote.',
    'nothing is as permanent as a temporary fix that works.'
  ];

  var allNames = function () {
    var X = window.__extraCommands || {};
    var names = Object.keys(COMMANDS);
    Object.keys(X).forEach(function (k) {
      if (k.indexOf('__') !== 0 && typeof X[k] === 'function' && names.indexOf(k) < 0) names.push(k);
    });
    return names.sort();
  };

  var COMMANDS = {
    help: function () {
      print('  ' + allNames().join('  '));
      print('  <span class="console__dim">`man &lt;command&gt;` for detail · ↑ ↓ for history · tab completes</span>');
    },
    ls: function () {
      print(sections.map(function (s) { return s.getAttribute('data-nav'); }).join('  ') || '(nothing here)');
    },
    cd: function (arg) {
      if (!arg) { jumpTo(0); return print('→ top'); }
      var names = sections.map(function (s) { return s.getAttribute('data-nav'); });
      var i = names.indexOf(String(arg).replace(/^\/+/, ''));
      if (i < 0) return print('cd: no section named ' + esc(arg) + '. try `ls`.');
      jumpTo(i);
      print('→ ' + esc(arg));
    },
    pwd: function () { print(location.hostname + location.pathname); },
    whoami: function () {
      print('you, mostly. only what your browser volunteered:');
      print('  ' + (navigator.language || '??') + ' · ' +
            Intl.DateTimeFormat().resolvedOptions().timeZone +
            ' · theme=' + (window.__theme ? window.__theme.get() : '?'));
    },
    date: function () { print(new Date().toString()); },
    uptime: function () {
      var secs = Math.round((Date.now() - BOOTED) / 1000);
      var days = Math.floor((Date.now() - new Date('2026-01-01T00:00:00Z')) / 86400000);
      print('this tab: ' + secs + 's · this domain: ' + days + ' days, give or take');
    },
    neofetch: function () {
      print(
        '  <span class="console__accent">   ___   </span>   visitor@monk97\n' +
        '  <span class="console__accent">  / _ \\  </span>   ' + '-'.repeat(14) + '\n' +
        '  <span class="console__accent"> | | | | </span>   host    monk97.me\n' +
        '  <span class="console__accent"> | |_| | </span>   shell   ' + (navigator.platform || 'browser') + '\n' +
        '  <span class="console__accent">  \\___/  </span>   theme   ' + (window.__theme ? window.__theme.get() : '?') + '\n' +
        '  <span class="console__accent">         </span>   uptime  ' + Math.round((Date.now() - BOOTED) / 1000) + 's\n' +
        '  <span class="console__accent">         </span>   stack   html, css, and some opinions'
      );
    },
    echo: function (arg, rest) { print(esc(rest || arg || '')); },
    source: function () {
      print('static files, all of them. view-source works, and so does this:');
      var gh = $('[data-link="github"]');
      if (gh) print('  <a href="' + gh.href + '" target="_blank" rel="noopener">' + esc(gh.href) + '</a>');
    },
    home: function () {
      var H = (window.__site && window.__site.home) || '';   /* another host, or this one */
      if (!H && location.pathname === '/') { jumpTo(0); return print('already home.'); }
      print('going home…');
      setTimeout(function () { location.href = H + '/'; }, 350);
    },
    resume: function () {
      var H = (window.__site && window.__site.home) || '';
      if (!H && location.pathname.indexOf('/resume') === 0) return print('you are looking at it.');
      print('opening resume…');
      setTimeout(function () { location.href = H + '/resume'; }, 350);
    },
    github:   function () { openLink('github'); },
    linkedin: function () { openLink('linkedin'); },
    email:    function () { openLink('email'); },
    lab: function () {
      if (location.hostname.indexOf('lab.') === 0) return print('you are in it.');
      print('opening lab.monk97.me\u2026');
      print('  <span class="console__dim">live service health for the home lab.</span>');
      setTimeout(function () {
        window.open('https://lab.monk97.me', '_blank', 'noopener');
      }, 300);
    },

    /* One place to change how the site behaves, rather than a command each. */
    settings: function (arg, all) {
      /* the dispatcher hands us (parts[1], everything-after-the-command) */
      var rest = (all || '').split(/\s+/)[1] || '';
      var MOTION = 'monk97:motion';
      var root = document.documentElement;
      var pad = function (v) { return (v + '        ').slice(0, 8); };

      var motionGet = function () {
        return root.getAttribute('data-motion') || 'auto';
      };
      var motionSet = function (v) {
        if (v === 'auto') root.removeAttribute('data-motion');
        else root.setAttribute('data-motion', v);
        try {
          if (v === 'auto') localStorage.removeItem(MOTION);
          else localStorage.setItem(MOTION, v);
        } catch (e) {}
      };

      var show = function () {
        print('  <span class="console__dim">setting   value    options</span>');
        print('  theme     ' + pad(window.__theme ? window.__theme.get() : 'auto')
              + ' auto light dark');
        print('  motion    ' + pad(motionGet()) + ' auto reduced');
        if (window.__labView)
          print('  view      ' + pad(window.__labView.get()) + ' ' + window.__labView.all.join(' '));
        print('  <span class="console__dim">`settings &lt;name&gt; &lt;value&gt;` to change \u00b7 '
              + '`settings reset` to clear</span>');
      };

      if (!arg) return show();

      if (arg === 'reset') {
        if (window.__theme) { window.__theme.set('auto'); renderTheme(); }
        motionSet('auto');
        return print('settings cleared. back to following your system.');
      }
      if (arg === 'theme') {
        if (!rest) return print('theme=' + (window.__theme ? window.__theme.get() : 'auto'));
        if (['auto', 'light', 'dark'].indexOf(rest) < 0)
          return print('theme takes auto, light or dark.');
        window.__theme.set(rest); renderTheme();
        return print('theme=' + rest);
      }
      if (arg === 'view' && window.__labView) {
        if (!rest) return print('view=' + window.__labView.get());
        if (!window.__labView.set(rest)) return print('view takes: ' + window.__labView.all.join(', '));
        return print('view=' + rest);
      }
      if (arg === 'motion') {
        if (!rest) return print('motion=' + motionGet());
        if (['auto', 'reduced'].indexOf(rest) < 0)
          return print('motion takes auto or reduced.');
        motionSet(rest);
        return print('motion=' + rest + (rest === 'reduced'
          ? ' \u2014 animations off.' : ' \u2014 following your system.'));
      }
      print('no such setting: ' + arg);
      show();
    },

    theme: function (arg) {
      if (!window.__theme) return;
      if (['auto', 'light', 'dark'].indexOf(arg) > -1) window.__theme.set(arg);
      else window.__theme.next();
      renderTheme();
      print('theme=' + window.__theme.get());
    },
    history: function () {
      if (!HISTORY.length) return print('(nothing yet)');
      HISTORY.forEach(function (h, i) { print('  ' + (i + 1) + '  ' + esc(h)); });
    },
    man: function (arg) {
      if (!arg) return print('what manual page do you want?');
      var k = String(arg).toLowerCase();
      /* MAN entries are plain text and contain angle brackets — escape them,
       * or `cd <section>` prints as `cd` with the argument eaten as a tag. */
      var XM = (window.__extraCommands || {}).__man || {};
      if (XM[k]) return print(esc(XM[k]));
      print(MAN[k] ? esc(MAN[k])
                   : (COMMANDS[k] ? 'no manual entry for ' + esc(k) + '. it does what it says.'
                                  : 'no manual entry for ' + esc(k)));
    },
    coffee: function () { print('brewing… <span class="console__dim">(418)</span>'); },

    fortune: function () { print(FORTUNES[Math.floor(Math.random() * FORTUNES.length)]); },

    whois: function () {
      print('domain    monk97.me');
      print('status    active, and finally pointing at something');
      print('serving   static files, no framework, no build step');
      print('registrar <span class="console__dim">between me and the registrar</span>');
    },

    tree: function () {
      print('monk97.me\n' +
            '├── /            this page\n' +
            '├── /resume      the long version\n' +
            '└── lab.         live service health <span class=\"console__dim\">(`lab`)</span>');
    },

    ping: function () {
      /* A real measurement, not a fake one — time a request to this page. */
      var t0 = performance.now();
      fetch(location.pathname, { method: 'HEAD', cache: 'no-store' })
        .then(function () {
          print('round trip: ' + Math.round(performance.now() - t0) + 'ms — you and this page are on speaking terms.');
        })
        .catch(function () { print('no reply. which is odd, since you are reading this.'); });
    },

    cowsay: function (arg, rest) {
      var say = (rest || arg || 'moo').slice(0, 40);
      var bar = '_'.repeat(say.length + 2);
      print(' ' + bar + '\n< ' + esc(say) + ' >\n ' + '-'.repeat(say.length + 2) +
            '\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||');
    },

    contact: function () {
      var e = $('[data-link="email"]');
      print('email is the fastest. I read it, eventually.');
      if (e) print('  <a href="' + e.href + '">' + esc(e.href.replace('mailto:', '')) + '</a>');
      print('  <span class="console__dim">`resume` for the long version · `linkedin` if you must</span>');
    },

    hire: function () {
      print('flattering. the short version is on this page, the long version is `resume`.');
      COMMANDS.contact();
    },

    ask: function (arg, rest) {
      var q = (rest || arg || '').trim();
      if (!q) return print('ask what? <span class="console__dim">(e.g. `ask what do you work on`)</span>');
      print('not wired up yet — there is no model behind this prompt. <span class="console__dim">soon.</span>');
      print('in the meantime, `contact` reaches an actual human.');
    },

    weather: function () {
      /* Two hops: geojs resolves the visitor's IP to coordinates, Open-Meteo
       * turns those into conditions. Both send CORS headers and need no key.
       *
       * wttr.in was the obvious choice and does not work here — it sniffs
       * User-Agent and hands browsers a full HTML page instead of a line,
       * and fetch() cannot spoof User-Agent.
       *
       * The tradeoff, plainly: the visitor's IP reaches geojs. There is no
       * way to report someone's local weather without something learning
       * roughly where they are. Nothing is stored on this end.
       */
      var CODES = {
        0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
        45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle',
        55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
        61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain',
        67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow',
        77: 'snow grains', 80: 'showers', 81: 'showers', 82: 'heavy showers',
        85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm',
        96: 'thunderstorm with hail', 99: 'thunderstorm with hail'
      };

      print('checking…');
      var done = false;
      var giveUp = setTimeout(function () {
        if (!done) { done = true; print('weather: the sky did not answer in time.'); }
      }, 8000);

      fetch('https://get.geojs.io/v1/ip/geo.json')
        .then(function (r) { return r.ok ? r.json() : Promise.reject(0); })
        .then(function (g) {
          var lat = parseFloat(g.latitude), lon = parseFloat(g.longitude);
          if (!isFinite(lat) || !isFinite(lon)) return Promise.reject(0);
          var where = g.city || g.region || 'wherever you are';
          return fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat +
                       '&longitude=' + lon + '&current=temperature_2m,weather_code')
            .then(function (r) { return r.ok ? r.json() : Promise.reject(0); })
            .then(function (d) {
              var c = d && d.current;
              if (!c) return Promise.reject(0);
              if (done) return;
              done = true; clearTimeout(giveUp);
              print(esc(where) + ': ' + Math.round(c.temperature_2m) + '°C, ' +
                    (CODES[c.weather_code] || 'weather of some kind'));
            });
        })
        .catch(function () {
          if (done) return;
          done = true; clearTimeout(giveUp);
          print('weather: could not reach the sky.');
        });
    },

    sudo:  function () { print('nice try.'); },
    clear: function () { out.innerHTML = ''; },
    exit:  function () { closeConsole(); }
  };

  if (con) {
    var run = function (raw) {
      var line = raw.trim().replace(/^\/+/, '');
      if (!line) return;
      print('<span class="console__echo">$</span> ' + esc(line));
      var parts = line.split(/\s+/);
      var cmd = parts[0].toLowerCase();
      /* A page may add commands, override built-ins, or claim words the
       * engine doesn't know (the lab's seal does). Same engine everywhere;
       * only the extras differ. */
      var X = window.__extraCommands || {};
      var api = { print: print, close: closeConsole, esc: esc };
      var notFound = function () { print(esc(cmd) + ': not found. try `help`.'); };
      if (typeof X[cmd] === 'function' && cmd.indexOf('__') !== 0) X[cmd](parts[1], parts.slice(1).join(' '), api);
      else if (COMMANDS[cmd]) COMMANDS[cmd](parts[1], parts.slice(1).join(' '));
      else if (typeof X.__fallback === 'function') {
        Promise.resolve(X.__fallback(cmd, api)).then(function (handled) { if (!handled) notFound(); });
      }
      else notFound();
    };

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var v = input.value.trim();
        if (v) { HISTORY.push(v); histPos = HISTORY.length; }
        run(input.value);
        input.value = '';
        return;
      }
      if (e.key === 'Escape') { closeConsole(); return; }

      /* up / down walk what you have typed, like any shell */
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (histPos > 0) { histPos -= 1; input.value = HISTORY[histPos]; }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (histPos < HISTORY.length - 1) { histPos += 1; input.value = HISTORY[histPos]; }
        else { histPos = HISTORY.length; input.value = ''; }
        return;
      }

      /* tab completes a command prefix; ambiguous prefixes list the options */
      if (e.key === 'Tab') {
        e.preventDefault();
        var typedSoFar = input.value.trim().toLowerCase();
        if (!typedSoFar) return;
        var hits = allNames().filter(function (c) { return c.indexOf(typedSoFar) === 0; });
        if (hits.length === 1) input.value = hits[0] + ' ';
        else if (hits.length > 1) print('  ' + hits.join('  '));
      }
    });

    $$('[data-console-close]').forEach(function (el) { el.addEventListener('click', closeConsole); });

    /* for the headless check in scripts/check-prompt.mjs */
    window.__prompt = { run: run, names: allNames };
  }

  /* ── keys ──────────────────────────────────────────────────────── */

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || e.target.isContentEditable) return;
    if (con && con.classList.contains('is-open')) return;

    if (e.key === '/') { e.preventDefault(); openConsole(); return; }
    if (e.key === 'j') { e.preventDefault(); jumpTo(Math.min(currentIdx + 1, sections.length - 1)); return; }
    if (e.key === 'k') { e.preventDefault(); jumpTo(Math.max(currentIdx - 1, 0)); return; }
    if (e.key === 'g') { e.preventDefault(); jumpTo(0); return; }
    if (e.key === 'G') { e.preventDefault(); jumpTo(sections.length - 1); return; }
  });
})();
