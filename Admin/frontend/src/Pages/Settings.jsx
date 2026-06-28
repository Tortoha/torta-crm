// Admin Settings — mirrors the CRM Settings "bulk-style" page, trimmed to what
// the admin console needs: a read-only Account block + Preferences (interface
// language EN/RU + theme System/Light/Dark). Save-on-change, no Save button.
//
// The admin is a regular crm_user, so language + theme persist to the SAME
// crm_settings row via PUT /api/settings — and api.js re-applies them from
// /api/me on every load, so the choice follows the account.

import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, UserCircle } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { syncLang } from '../i18n.js';
import { syncTheme } from '../theme.js';
import { LANGUAGES } from '../locales/languages.js';
import { Section, FieldCard, SegmentSwitch } from '../Utils/SettingsControls.jsx';
import '../Style/Authentication.css';
import '../Style/Products.css';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { user } = useOutletContext();
  const [language, setLanguage] = useState((i18n.language || 'en').slice(0, 2));
  const [theme, setTheme] = useState(
    () => (typeof document !== 'undefined' && document.documentElement.dataset.themePref) || 'system'
  );

  // syncLang/syncTheme apply the change instantly (localStorage); the DB write
  // makes it follow the account across devices/browsers.
  const persist = (patch) => {
    fetch(`${API_BASE}/api/settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {});
  };
  const pickLanguage = (v) => { setLanguage(v); syncLang(v);  persist({ language: v }); };
  const pickTheme    = (v) => { setTheme(v);    syncTheme(v); persist({ theme: v }); };

  const ro = { color: 'var(--muted)', fontSize: 14 };

  return (
    <>
      <h1 className="crm-page-title">{t('settings.title')}</h1>

      <div className="bulk-settings">
        <Section icon={<UserCircle weight="duotone" />}
          title={t('settings.account.title')} subtitle={t('settings.account.subtitle')}>
          <FieldCard label={t('settings.account.name')}>
            <span style={ro}>{user?.name || '—'}</span>
          </FieldCard>
          <FieldCard label={t('settings.account.email')}>
            <span style={ro}>{user?.email || '—'}</span>
          </FieldCard>
        </Section>

        <Section icon={<SlidersHorizontal weight="duotone" />}
          title={t('settings.preferences.title')} subtitle={t('settings.preferences.subtitle')}>
          <FieldCard label={t('settings.preferences.language')} hint={t('settings.preferences.languageHint')}>
            <SegmentSwitch value={language}
              options={LANGUAGES.map(l => ({ value: l.value, label: l.label }))}
              onChange={pickLanguage} />
          </FieldCard>
          <FieldCard label={t('settings.preferences.theme')} hint={t('settings.preferences.themeHint')}>
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
    </>
  );
}
