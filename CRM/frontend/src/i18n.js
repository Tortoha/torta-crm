import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGS } from './locales/languages.js';

export { SUPPORTED_LANGS };
const LS_KEY = 'crm_lang';

// Each feature area owns one fragment file per language (locales/{lang}/{area}.json),
// each keyed under a distinct top-level namespace ({ nav: {...} }, { products: {...} }).
// Vite eagerly bundles every locales/*/*.json; we group fragments by language folder
// and shallow-merge each language into one resource. Adding a language = drop a
// locales/{lang}/ folder + one line in locales/languages.js — no edit needed here.
const modules = import.meta.glob('./locales/*/*.json', { eager: true });
const byLang = {};
for (const [path, mod] of Object.entries(modules)) {
  const lang = path.split('/')[2];            // ./locales/<lang>/<area>.json
  if (!byLang[lang]) byLang[lang] = {};
  Object.assign(byLang[lang], mod.default || mod);
}
const resources = Object.fromEntries(
  Object.entries(byLang).map(([lang, dict]) => [lang, { translation: dict }]),
);

const stored = localStorage.getItem(LS_KEY);
const initial = SUPPORTED_LANGS.includes(stored) ? stored : 'en';

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initial,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

// Switch language live and remember it locally. The DB write is done separately
// by the Settings page (and the chosen language is re-applied from /api/me on load).
export function syncLang(lang) {
  if (!lang || !SUPPORTED_LANGS.includes(lang)) return;
  if (i18n.language !== lang) i18n.changeLanguage(lang);
  localStorage.setItem(LS_KEY, lang);
}

export default i18n;
