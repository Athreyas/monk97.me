/* Theme: three states — auto (follow the OS), light, dark.
 *
 * Loaded WITHOUT defer, in <head>, on purpose: it has to write
 * data-theme before the first paint or the page flashes the wrong
 * colours on load. It is small enough that blocking costs nothing.
 */
(function () {
  var KEY = 'monk97:theme';
  var root = document.documentElement;

  root.classList.add('js');   /* lets CSS know reveals are safe to hide */

  var saved;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }

  if (saved === 'light' || saved === 'dark') {
    root.setAttribute('data-theme', saved);
  } else {
    root.removeAttribute('data-theme');   /* auto */
  }

  /* Motion preference, set via `settings motion`. Applied here for the same
     reason as the theme: after first paint is too late. */
  try {
    var m = localStorage.getItem('monk97:motion');
    if (m === 'reduced') root.setAttribute('data-motion', 'reduced');
  } catch (e) {}

  /* Shared with site.js, which owns the button in the rail. */
  window.__theme = {
    KEY: KEY,
    order: ['auto', 'light', 'dark'],
    get: function () {
      return root.getAttribute('data-theme') || 'auto';
    },
    set: function (mode) {
      if (mode === 'auto') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', mode);
      try {
        if (mode === 'auto') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, mode);
      } catch (e) { /* private window — the choice just won't persist */ }
    },
    next: function () {
      var o = this.order;
      var i = o.indexOf(this.get());
      var mode = o[(i + 1) % o.length];
      this.set(mode);
      return mode;
    }
  };
})();
