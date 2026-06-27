// Single source of truth for the CRM console's supported UI languages.
// `label` is the language's own native name (shown untranslated in the picker).
//
// Add a language in two steps, no other code change:
//   1. append a line here, and
//   2. drop a locales/{value}/ folder with the translated *.json fragments.
// i18n.js globs locales/*/*.json and auto-registers whatever folders exist;
// fallbackLng:'en' covers any key a language hasn't translated yet.
export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'kk', label: 'Қазақша' },
];

export const SUPPORTED_LANGS = LANGUAGES.map((l) => l.value);
