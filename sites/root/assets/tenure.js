/* tenure.js — keeps /resume's tenures true without anyone editing them.
 *
 * Months are counted inclusively, both end months (Nov–Dec is 2M), the
 * same rule the hand-written figures follow. Without data-to the span runs
 * to the current month.
 *
 *   <span data-from="2021-12">4Y 11M</span>         text becomes the tenure
 *   <div class="svc__fill" data-from="2017-01" data-to="2021-12">
 *                                                    width becomes a share
 *                                                    of the longest bar
 *
 * The markup carries correct values as of the last edit, so a page without
 * JavaScript (or a crawler) reads something true, just not this month's.
 */
(function () {
  'use strict';

  function ym(s) { var p = s.split('-'); return +p[0] * 12 + (+p[1] - 1); }

  var now = new Date();
  var thisMonth = now.getFullYear() * 12 + now.getMonth();

  function months(el) {
    var to = el.getAttribute('data-to');
    return (to ? ym(to) : thisMonth) - ym(el.getAttribute('data-from')) + 1;
  }

  function label(n) {
    var y = Math.floor(n / 12), m = n % 12, out = [];
    if (y) out.push(y + 'Y');
    if (m) out.push(m + 'M');
    return out.join(' ');
  }

  var bars = [], longest = 0;
  Array.prototype.forEach.call(document.querySelectorAll('[data-from]'), function (el) {
    var n = months(el);
    if (n < 1) return;                       /* a clock in the past: leave the markup */
    if (el.classList.contains('svc__fill')) { bars.push([el, n]); longest = Math.max(longest, n); }
    else el.textContent = label(n);
  });
  bars.forEach(function (b) {
    b[0].style.width = Math.max(1, Math.round(100 * b[1] / longest)) + '%';
  });
})();
