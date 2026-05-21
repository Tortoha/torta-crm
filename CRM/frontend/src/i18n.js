import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGS = ['en', 'ru', 'kk'];
const LS_KEY = 'crm_lang';

// Each feature area owns one fragment file per language (locales/{lang}/{area}.json),
// each keyed under a distinct top-level namespace ({ nav: {...} }, { products: {...} }).
// Vite eagerly bundles them all; we shallow-merge into one resource per language so
// `t('area.key')` works everywhere. No central file to edit when adding an area.
function loadResources(glob) {
  const out = {};
  for (const mod of Object.values(glob)) Object.assign(out, mod.default || mod);
  return out;
}

const en = loadResources(import.meta.glob('./locales/en/*.json', { eager: true }));
const ru = loadResources(import.meta.glob('./locales/ru/*.json', { eager: true }));

const stored = localStorage.getItem(LS_KEY);
const initial = SUPPORTED_LANGS.includes(stored) ? stored : 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ru: { translation: ru } },
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
