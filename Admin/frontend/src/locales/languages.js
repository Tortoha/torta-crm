// Admin panel supports two interface languages only — English and Russian.
// (The CRM also ships Kazakh; the admin console deliberately doesn't.)
export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
];

export const SUPPORTED_LANGS = LANGUAGES.map(l => l.value);
