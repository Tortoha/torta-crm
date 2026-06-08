import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from '@phosphor-icons/react';
import Header from './Elements/Header.jsx';
import { API_BASE } from './api.js';
import { syncLang } from './i18n.js';
import { syncTheme } from './theme.js';
import { Section, FieldCard, SearchableCombobox, SegmentSwitch } from './Pages/Project/ProjectSettings.jsx';
import { LANGUAGES } from './locales/languages.js';
import './Style/App.css';

// Public preferences page (reachable from the landing gear, no auth required).
// Same bulk-style as Settings → Profile, but only Language + Theme.
export default function Preferences() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [language, setLanguage] = useState((i18n.language || 'en').slice(0, 2));
  const [theme, setTheme] = useState(
    () => (typeof document !== 'undefined' && document.documentElement.dataset.themePref) || 'system'
  );

  // Best-effort: load current values + detect login (for DB persist). No redirect.
  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j) return;
        setUser(j);
        if (j.language) setLanguage(j.language);
        if (j.theme)    setTheme(j.theme);
      })
      .catch(() => {});
  }, []);

  // localStorage always (instant, works logged-out); DB too when logged in so it
  // follows the account (api.js re-applies /api/me theme + language on every load).
  const persist = (patch) => {
    if (!user) return;
    fetch(`${API_BASE}/api/settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {});
  };
  const pickLanguage = (v) => { setLanguage(v); syncLang(v);  persist({ language: v }); };
  const pickTheme    = (v) => { setTheme(v);    syncTheme(v); persist({ theme: v }); };

  return (
    <>
      <Header user={user} landing />
      <div className="pref-page">
        <div className="pref-inner">
          <h1 className="crm-page-title">{t('settings.preferences.title')}</h1>
          <div className="bulk-settings">
            <Section icon={<SlidersHorizontal weight="duotone" />}
              title={t('settings.preferences.title')} subtitle={t('settings.preferences.subtitle')}>

              <FieldCard label={t('settings.preferences.language')}
                hint={t('settings.preferences.languageHint')}>
                <SearchableCombobox value={language}
                  options={LANGUAGES.map(l => ({ value: l.value, label: l.label }))}
                  onChange={pickLanguage} searchPlaceholder={t('common.search')} />
              </FieldCard>

              <FieldCard label={t('settings.preferences.theme')}
                hint={t('settings.preferences.themeHint')}>
                <SegmentSwitch value={theme}
                  options={[
                    { value: 'system', label: t('settings.preferences.system') },
                    { value: 'light',  label: t('settings.preferences.light') },
                    { value: 'dark',   label: t('settings.preferences.dark') },
                  ]}
                  onChange={pickTheme} />
              </FieldCard>

            </Section>
          </div>
        </div>
      </div>
    </>
  );
}
