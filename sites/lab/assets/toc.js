/* toc.js — the right-edge page navigator.
 *
 * Collapsed it is a column of ticks, one per section, the current one lit.
 * Hovering (or focusing) it reveals the labels; clicking jumps. It is an
 * orientation device first and a navigation device second — on a long page
 * the lit tick answers "where am I" without any interaction at all.
 *
 * Opt in per section with data-toc; the value is the label, or its text is
 * used when the attribute is empty:
 *     <section id="services" data-toc="SERVICE HEALTH">
 *     <h2 class="doc__h" data-toc>CAPABILITIES</h2>
 *
 * Sections are read once on load, then re-read when the page's own scripts
 * finish painting (the lab renders its sections from a feed, so they are not
 * in the DOM yet when this runs).
 */
(function () {
  'use strict';

  var MIN_ITEMS = 2;          /* one tick is not a navigator */
  var HIDE_BELOW = 1100;      /* no room beside the column under this width */

  var nav = null, links = [], targets = [], raf = 0;

  function slug(s, i) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section-' + i;
  }

  function collect() {
    var out = [];
    var nodes = document.querySelectorAll('[data-toc]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.hidden || !el.offsetParent) continue;        /* not shown, not listed */
      var label = (el.getAttribute('data-toc') || el.textContent || '').trim();
      if (!label) continue;
      if (!el.id) el.id = slug(label, i);
      out.push({ el: el, id: el.id, label: label });
    }
    return out;
  }

  function build(items) {
    var list = document.createElement('ul');
    list.className = 'toc__list';
    links = [];
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'toc__item';
      var a = document.createElement('a');
      a.className = 'toc__link';
      a.href = '#' + it.id;
      var tick = document.createElement('span');
      tick.className = 'toc__tick';
      tick.setAttribute('aria-hidden', 'true');
      var lab = document.createElement('span');
      lab.className = 'toc__label';
      lab.textContent = it.label;
      a.appendChild(lab); a.appendChild(tick);
      li.appendChild(a); list.appendChild(li);
      links.push(a);
    });

    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'toc';
      nav.setAttribute('aria-label', 'On this page');
      document.body.appendChild(nav);
    }
    nav.textContent = '';
    nav.appendChild(list);
    targets = items.map(function (i) { return i.el; });

    /* let the browser own the scroll: honours prefers-reduced-motion via CSS
       scroll-behavior, and keeps the URL hash for free */
    links.forEach(function (a, i) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var el = targets[i];
        if (!el) return;
        el.scrollIntoView({ block: 'start' });
        history.replaceState(null, '', '#' + el.id);
        mark(i);
      });
    });
  }

  function mark(active) {
    for (var i = 0; i < links.length; i++) {
      if (i === active) links[i].setAttribute('aria-current', 'true');
      else links[i].removeAttribute('aria-current');
    }
  }

  /* the current section is the last one whose top has crossed a line a third
     of the way down the viewport — the same rule the eye uses */
  function spy() {
    raf = 0;
    if (!targets.length) return;
    var line = window.innerHeight * 0.34, best = 0;
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].getBoundingClientRect().top <= line) best = i;
    }
    /* bottom of the page always lights the last one, which a pure top-edge
       rule never reaches when the final section is short */
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) best = targets.length - 1;
    mark(best);
  }

  function onScroll() { if (!raf) raf = requestAnimationFrame(spy); }

  function refresh() {
    var items = (window.innerWidth < HIDE_BELOW) ? [] : collect();
    if (items.length < MIN_ITEMS) {
      if (nav) { nav.remove(); nav = null; links = []; targets = []; }
      return;
    }
    build(items);
    spy();
  }

  function start() {
    refresh();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { refresh(); onScroll(); }, { passive: true });
    /* pages that render their own sections (the lab reads a feed) settle
       after us; re-read a few times rather than racing them */
    [400, 1200, 3000].forEach(function (ms) { setTimeout(refresh, ms); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.__toc = { refresh: refresh };
})();
