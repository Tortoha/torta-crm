// Account settings — bulk-style (mirrors Project Settings: Section + FieldCard,
// save-on-change, toast). Profile (photo / name / email) + Preferences
// (language / theme). Currency lives on the project & org, not the user account,
// so it's intentionally not here.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, UserCircle, SlidersHorizontal } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { syncLang } from '../../i18n.js';
import AvatarCropModal from '../../Elements/AvatarCropModal.jsx';
import { Section, FieldCard, SegmentSwitch, SearchableCombobox } from '../Project/ProjectSettings.jsx';
import '../../Style/Authentication.css';   // auth-toast / auth-btn-check
import '../../Style/Products.css';           // bulk-* / cpm-* / crm-input
import '../../Style/Settings.css';

// Language names are shown in their own language — not translated.
const LANGUAGES = [
  { value: 'en', label: 'English'  },
  { value: 'ru', label: 'Русский'  },
  { value: 'kk', label: 'Қазақша'  },
];

function InitialsAvatar({ name, size = 56 }) {
  const initials = (name || '?').split(' ').filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('');
  const palette = ['#0071E3', '#8b5cf6', '#06b6d4', '#10b981', '#f43f5e', '#3b82f6', '#d946ef', '#eab308'];
  const bg = palette[(name?.charCodeAt(0) ?? 0) % palette.length];
  return (
    <div className="sett-avatar-initials" style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const { updateUser } = useOutletContext() || {};
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  const [name, setName]         = useState('');
  const [language, setLanguage] = useState('en');
  const [theme, setTheme]       = useState('light');

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarImgFailed, setAvatarImgFailed] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const avatarInputRef = useRef();

  const [toast, setToast] = useState('');
  const tref = useRef(null);
  const showToast = useCallback((m) => {
    setToast(m);
    if (tref.current) clearTimeout(tref.current);
    tref.current = setTimeout(() => setToast(''), 2400);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/settings`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j) { setData(j); setName(j.name || ''); setLanguage(j.language || 'en'); setTheme(j.theme || 'light'); }
      })
      .finally(() => setLoading(false));
  }, []);

  const savePrefs = async (patch) => {
    const r = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    showToast(r.ok ? t('common.saved') : t('common.saveFailed'));
    return r.ok;
  };

  // Debounced name save (skip first run so mounting doesn't re-PUT the loaded value).
  const firstName = useRef(true);
  useEffect(() => {
    if (firstName.current) { firstName.current = false; return; }
    const v = name.trim();
    if (!v) return;
    const t = setTimeout(async () => {
      if (await savePrefs({ name: v })) { setData(p => ({ ...p, name: v })); updateUser?.({ name: v }); }
    }, 500);
    return () => clearTimeout(t);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickLanguage = (v) => { setLanguage(v); syncLang(v); savePrefs({ language: v }); };
  const pickTheme    = (v) => { setTheme(v); savePrefs({ theme: v }); };

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropFile(file);
    e.target.value = '';
  };

  const uploadCroppedBlob = async (blob) => {
    setCropFile(null);
    setAvatarUploading(true);
    const form = new FormData();
    form.append('file', blob, 'avatar.webp');
    try {
      const res  = await fetch(`${API_BASE}/api/upload/avatar`, { method: 'POST', credentials: 'include', body: form });
      const json = await res.json();
      if (!res.ok) { showToast(json.detail || t('settings.profile.uploadFailed')); return; }
      const bustedUrl = json.url + '?v=' + Date.now();
      setData(prev => ({ ...prev, avatar_url: bustedUrl }));
      setAvatarImgFailed(false);
      updateUser?.({ avatar_url: bustedUrl });
      showToast(t('settings.profile.photoUpdated'));
    } catch { showToast(t('common.networkError')); }
    finally { setAvatarUploading(false); }
  };

  if (loading) return <div className="crm-placeholder" style={{ marginTop: 40 }}>{t('common.loading')}</div>;

  return (
    <>
      <h1 className="crm-page-title">{t('settings.title')}</h1>

      <div className="bulk-settings">
        <Section icon={<UserCircle weight="duotone" />} title={t('settings.profile.title')}
          subtitle={t('settings.profile.subtitle')}>

          <FieldCard label={t('settings.profile.photo')} hint={t('settings.profile.photoHint')}>
            <div className="sett-photo-row">
              {data?.avatar_url && !avatarImgFailed
                ? <img src={data.avatar_url} alt="" className="sett-avatar-img2" onError={() => setAvatarImgFailed(true)} />
                : <InitialsAvatar name={data?.name} size={56} />}
              <button type="button" className="auth-btn-check" disabled={avatarUploading}
                onClick={() => avatarInputRef.current?.click()}>
                <Camera weight="bold" /> {avatarUploading ? t('settings.profile.uploading') : t('settings.profile.changePhoto')}
              </button>
              <input ref={avatarInputRef} type="file" accept="image/*"
                style={{ display: 'none' }} onChange={handleAvatarChange} />
            </div>
          </FieldCard>

          <FieldCard label={t('settings.profile.displayName')} hint={t('settings.profile.displayNameHint')}>
            <input className="crm-input" style={{ maxWidth: 360 }} value={name} maxLength={80}
              placeholder={t('settings.profile.namePlaceholder')} onChange={e => setName(e.target.value)} />
          </FieldCard>

          <FieldCard label={t('settings.profile.email')} hint={t('settings.profile.emailHint')}>
            <input className="crm-input" style={{ maxWidth: 360, opacity: 0.6 }}
              value={data?.email || ''} readOnly tabIndex={-1} />
          </FieldCard>
        </Section>

        <Section icon={<SlidersHorizontal weight="duotone" />} title={t('settings.preferences.title')}
          subtitle={t('settings.preferences.subtitle')}>

          <FieldCard label={t('settings.preferences.language')} hint={t('settings.preferences.languageHint')}>
            <div style={{ maxWidth: 240 }}>
              <SearchableCombobox value={language}
                options={LANGUAGES.map(l => ({ value: l.value, label: l.label }))}
                onChange={pickLanguage} searchPlaceholder={t('common.search')} />
            </div>
          </FieldCard>

          <FieldCard label={t('settings.preferences.theme')} hint={t('settings.preferences.themeHint')}>
            <SegmentSwitch value={theme}
              options={[{ value: 'light', label: t('settings.preferences.light') }, { value: 'dark', label: t('settings.preferences.dark') }, { value: 'system', label: t('settings.preferences.system') }]}
              onChange={pickTheme} />
          </FieldCard>
        </Section>
      </div>

      {cropFile && <AvatarCropModal file={cropFile} onSave={uploadCroppedBlob} onClose={() => setCropFile(null)} />}
      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}
