// Theme runtime — mirrors CRM/frontend/src/theme.js but simpler:
// no DB sync (admin is single-user, no settings table for it), just
// localStorage cache + OS prefers-color-scheme.
//
// Applies `data-theme="light"|"dark"` on <html>. CSS variable overrides
// for dark live under [data-theme="dark"] in Style/index.css.

const LS_KEY = 'adm_theme';
const VALID  = ['light', 'dark', 'system'];

let _mql = null;
let _listener = null;

function resolve(pref) {
  if (pref === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref === 'dark' ? 'dark' : 'light';
}

export function applyTheme(pref) {
  const p = VALID.includes(pref) ? pref : 'system';
  const el = document.documentElement;
  el.dataset.theme = resolve(p);
  el.dataset.themePref = p;
}

export function syncTheme(pref) {
  const p = VALID.includes(pref) ? pref : 'system';
  localStorage.setItem(LS_KEY, p);
  applyTheme(p);

  if (_mql && _listener) { _mql.removeEventListener('change', _listener); _mql = null; _listener = null; }
  if (p === 'system' && window.matchMedia) {
    _mql = window.matchMedia('(prefers-color-scheme: dark)');
    _listener = () => applyTheme('system');
    _mql.addEventListener('change', _listener);
  }
}

// Boot from cache before first paint (no flash). Default follows OS.
const stored = localStorage.getItem(LS_KEY);
syncTheme(VALID.includes(stored) ? stored : 'system');
