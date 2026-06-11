import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGS } from './locales/languages.js';

export { SUPPORTED_LANGS };
const LS_KEY = 'crm_lang';

// Each feature area owns one fragment file per language (locales/{lang}/{area}.json),
// each keyed under a distinct top-level namespace ({ nav: {...} }, { products: {...} }).
//
// LAZY glob (NOT eager): every locales/{lang}/{area}.json is a separate dynamic
// import, so the bundler ships ZERO translation JSON in the entry chunk. We fetch
// only the ACTIVE language's fragments (plus English as the fallback) at startup,
// and pull other languages on demand when the user switches. The old `eager: true`
// bundled all 7 languages (~2.5 MB of JSON) into the main chunk on every page load,
// including the public landing — the single biggest source of unused JS.
const modules = import.meta.glob('./locales/*/*.json');

async function loadLang(lang) {
  const dict = {};
  await Promise.all(
    Object.entries(modules)
      .filter(([path]) => path.split('/')[2] === lang)   // ./locales/<lang>/<area>.json
      .map(async ([, loader]) => {
        const mod = await loader();
        Object.assign(dict, mod.default || mod);
      })
  );
  return dict;
}

const _loaded = new Set();
async function ensureLang(lang) {
  if (!lang || _loaded.has(lang)) return;
  const dict = await loadLang(lang);
  i18n.addResourceBundle(lang, 'translation', dict, true, true);
  _loaded.add(lang);
}

const stored = localStorage.getItem(LS_KEY);
const initial = SUPPORTED_LANGS.includes(stored) ? stored : 'en';

// Init synchronously with NO resources (useSuspense:false → components render
// immediately). The active-language bundle is added by i18nReady below, which
// main.jsx awaits before the first paint, so the UI never flashes raw keys.
i18n
  .use(initReactI18next)
  .init({
    resources: {},
    lng: initial,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

// Resolves once the active language (and the English fallback) are loaded.
// main.jsx defers render() until this settles.
export const i18nReady = (async () => {
  await ensureLang(initial);
  if (initial !== 'en') await ensureLang('en');   // fallback bundle for missing keys
})();

// Switch language live and remember it locally. The DB write is done separately
// by the Settings page (and the chosen language is re-applied from /api/me on load).
// Async now (loads the target language's fragments on demand) — every caller is
// fire-and-forget, so the change simply applies as soon as the bundle arrives.
export async function syncLang(lang) {
  if (!lang || !SUPPORTED_LANGS.includes(lang)) return;
  await ensureLang(lang);
  if (i18n.language !== lang) i18n.changeLanguage(lang);
  localStorage.setItem(LS_KEY, lang);
}

export default i18n;
