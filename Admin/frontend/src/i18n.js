// i18n runtime — mirror of CRM/frontend/src/i18n.js, trimmed to the admin's
// two languages (en / ru). Each feature area owns one fragment file per
// language (locales/{lang}/{area}.json), keyed under a distinct top-level
// namespace ({ nav: {...} }, { users: {...} }). All fragments merge into the
// single 'translation' namespace, so a component calls t('users.title').
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGS } from './locales/languages.js';

export { SUPPORTED_LANGS };
const LS_KEY = 'adm_lang';

// LAZY glob: every locales/{lang}/{area}.json is a separate dynamic import, so
// the inactive language ships zero JSON in the entry chunk. We load only the
// active language (plus English as the fallback) at startup.
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

i18n
  .use(initReactI18next)
  .init({
    resources: {},
    lng: initial,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

// Resolves once the active language (and the English fallback) are loaded —
// main.jsx defers the first paint until this settles so the UI never flashes
// raw keys.
export const i18nReady = (async () => {
  await ensureLang(initial);
  if (initial !== 'en') await ensureLang('en');
})();

// Switch language live and remember it locally. The DB write is done separately
// by the Settings page (and the chosen language is re-applied from /api/me on
// load by api.js).
export async function syncLang(lang) {
  if (!lang || !SUPPORTED_LANGS.includes(lang)) return;
  await ensureLang(lang);
  if (i18n.language !== lang) i18n.changeLanguage(lang);
  localStorage.setItem(LS_KEY, lang);
}

export default i18n;
