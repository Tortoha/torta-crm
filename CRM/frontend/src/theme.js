// Theme runtime — applies light / dark / system across the whole CRM by setting
// `data-theme` ("light"|"dark") on <html>. CSS variable overrides live under
// [data-theme="dark"] in Layout.css. Mirrors the i18n syncLang pattern:
// localStorage cache for instant first paint + DB-backed preference from /api/me.

const LS_KEY = 'crm_theme';
const VALID = ['light', 'dark', 'system'];

let _mql = null;
let _listener = null;

function resolve(pref) {
  if (pref === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref === 'dark' ? 'dark' : 'light';
}

// Set the actual <html data-theme> + remember the raw preference.
export function applyTheme(pref) {
  const p = VALID.includes(pref) ? pref : 'light';
  const el = document.documentElement;
  el.dataset.theme = resolve(p);
  el.dataset.themePref = p;
}

// Switch theme live + cache it. Re-binds the OS listener only while on 'system'.
export function syncTheme(pref) {
  const p = VALID.includes(pref) ? pref : 'light';
  localStorage.setItem(LS_KEY, p);
  applyTheme(p);

  if (_mql && _listener) { _mql.removeEventListener('change', _listener); _mql = null; _listener = null; }
  if (p === 'system' && window.matchMedia) {
    _mql = window.matchMedia('(prefers-color-scheme: dark)');
    _listener = () => applyTheme('system');
    _mql.addEventListener('change', _listener);
  }
}

// Boot from the cached preference before first paint (no flash). Default 'light'
// preserves current behaviour for users who never picked a theme.
const stored = localStorage.getItem(LS_KEY);
syncTheme(VALID.includes(stored) ? stored : 'light');
