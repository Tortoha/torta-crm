import { useEffect, useRef, useState } from 'react';
import { Camera, Check, UserCircle } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import '../Style/Settings.css';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'kk', label: 'Қазақша' },
];

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'KZT', label: 'KZT — Tenge' },
  { value: 'RUB', label: 'RUB — Ruble' },
];

function InitialsAvatar({ name, size = 80 }) {
  const initials = (name || '?')
    .split(' ').filter(Boolean)
    .map(w => w[0].toUpperCase()).slice(0, 2).join('');
  const palette = ['#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f43f5e', '#3b82f6', '#d946ef', '#eab308'];
  const bg = palette[(name?.charCodeAt(0) ?? 0) % palette.length];
  return (
    <div
      className="sett-avatar-initials"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

function Settings() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  // Profile
  const [name, setName]         = useState('');
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState('');

  // Preferences
  const [language, setLanguage] = useState('en');
  const [currency, setCurrency] = useState('USD');
  const [theme, setTheme]       = useState('light');
  const [prefSaved, setPrefSaved] = useState(false);
  const [prefError, setPrefError] = useState('');

  // Avatar
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError]         = useState('');
  const avatarInputRef = useRef();

  const load = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/settings`, { credentials: 'include' });
      const json = await res.json();
      setData(json);
      setName(json.name || '');
      setLanguage(json.language || 'en');
      setCurrency(json.currency || 'USD');
      setTheme(json.theme || 'light');
    } catch { /* network */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const saveName = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setNameError('Name cannot be empty');
    setNameError('');
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      const d = await res.json();
      return setNameError(d.detail || 'Error');
    }
    setData(prev => ({ ...prev, name: name.trim() }));
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  };

  const savePrefs = async (e) => {
    e.preventDefault();
    setPrefError('');
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language, currency, theme }),
    });
    if (!res.ok) {
      const d = await res.json();
      return setPrefError(d.detail || 'Error');
    }
    setPrefSaved(true);
    setTimeout(() => setPrefSaved(false), 2000);
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError('');
    setAvatarUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res  = await fetch(`${API_BASE}/api/upload/avatar`, {
        method: 'POST', credentials: 'include', body: form,
      });
      const json = await res.json();
      if (!res.ok) return setAvatarError(json.detail || 'Upload failed');
      setData(prev => ({ ...prev, avatar_url: json.url }));
    } catch { setAvatarError('Network error'); }
    finally { setAvatarUploading(false); e.target.value = ''; }
  };

  if (loading) return <div className="crm-placeholder sett-loading">Loading…</div>;

  return (
    <>
      <h1 className="crm-page-title">Settings</h1>

      <div className="sett-layout">

        {/* ── Profile ── */}
        <section className="crm-section">
          <h2 className="crm-section-title">Profile</h2>

          <div className="crm-card sett-profile-card">

            {/* Avatar block */}
            <div className="sett-avatar-block">
              <div className="sett-avatar-wrap">
                {data?.avatar_url ? (
                  <img
                    src={`${API_BASE}${data.avatar_url}`}
                    alt="avatar"
                    className="sett-avatar-img"
                  />
                ) : (
                  <InitialsAvatar name={data?.name} size={80} />
                )}
                <button
                  type="button"
                  className="sett-avatar-overlay"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  title="Change photo"
                >
                  <Camera className="sett-avatar-cam-icon" />
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="sett-hidden-input"
                  onChange={handleAvatarChange}
                />
              </div>
              <div className="sett-avatar-info">
                <span className="sett-avatar-name">{data?.name}</span>
                <span className="sett-avatar-email">{data?.email}</span>
                {data?.role && (
                  <span className="crm-badge crm-badge--gray sett-avatar-role">{data.role}</span>
                )}
              </div>
            </div>

            {avatarError && <span className="crm-form-error">{avatarError}</span>}
            {avatarUploading && <span className="sett-uploading">Uploading…</span>}

            <div className="sett-divider" />

            {/* Name form */}
            <form className="sett-form" onSubmit={saveName}>
              <label className="sett-label">Display name</label>
              <div className="sett-field-row">
                <input
                  className="crm-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={80}
                  placeholder="Your name"
                />
                <button
                  className={`crm-submit-btn sett-save-btn${nameSaved ? ' sett-save-btn--saved' : ''}`}
                  type="submit"
                >
                  {nameSaved ? <><Check className="sett-check-icon" />Saved</> : 'Save'}
                </button>
              </div>
              {nameError && <span className="crm-form-error">{nameError}</span>}
            </form>

            {/* Email — read only */}
            <div className="sett-form">
              <label className="sett-label">Email address</label>
              <input
                className="crm-input sett-input-readonly"
                value={data?.email || ''}
                readOnly
                tabIndex={-1}
              />
              <span className="sett-hint">Email cannot be changed.</span>
            </div>

          </div>
        </section>

        {/* ── Preferences ── */}
        <section className="crm-section2">
          <h2 className="crm-section-title">Preferences</h2>

          <div className="crm-card sett-prefs-card">
            <form className="sett-prefs-form" onSubmit={savePrefs}>

              <div className="sett-pref-row">
                <div className="sett-pref-label-block">
                  <span className="sett-label">Language</span>
                  <span className="sett-hint">Interface language for your account.</span>
                </div>
                <select
                  className="crm-input crm-input-select sett-select"
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                >
                  {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>

              <div className="sett-pref-divider" />

              <div className="sett-pref-row">
                <div className="sett-pref-label-block">
                  <span className="sett-label">Currency</span>
                  <span className="sett-hint">Used for revenue and analytics display.</span>
                </div>
                <select
                  className="crm-input crm-input-select sett-select"
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              <div className="sett-pref-divider" />

              <div className="sett-pref-row">
                <div className="sett-pref-label-block">
                  <span className="sett-label">Theme</span>
                  <span className="sett-hint">Choose your preferred appearance.</span>
                </div>
                <div className="sett-theme-row">
                  {['light', 'dark', 'system'].map(t => (
                    <button
                      key={t}
                      type="button"
                      className={`sett-theme-btn${theme === t ? ' sett-theme-btn--active' : ''}`}
                      onClick={() => setTheme(t)}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {prefError && <span className="crm-form-error">{prefError}</span>}

              <div className="sett-prefs-footer">
                <button
                  className={`crm-submit-btn sett-save-btn${prefSaved ? ' sett-save-btn--saved' : ''}`}
                  type="submit"
                >
                  {prefSaved ? <><Check className="sett-check-icon" />Saved</> : 'Save preferences'}
                </button>
              </div>

            </form>
          </div>
        </section>

      </div>
    </>
  );
}

export default Settings;
