// Security — bulk-section headers (icon + title), but full-width content:
// the sessions list is a list (not a 2-col field grid), and the
// log-out-everywhere action lives in the section header, right-aligned.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash, DesktopTower, DeviceMobile, SignOut, Check, ShieldCheck, Info } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import '../../Style/Authentication.css';
import '../../Style/Products.css';   // bulk-section-* + crm-icon-btn
import '../../Style/Settings.css';

function detectDevice(ua) {
  if (ua && /(iphone|android|mobile)/i.test(ua)) return { kind: 'mobile' };
  return { kind: 'desktop' };
}
function detectBrowser(ua) {
  if (!ua) return 'Unknown browser';
  if (/edg\//i.test(ua))   return 'Edge';
  if (/chrome/i.test(ua))  return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua))  return 'Safari';
  return 'Browser';
}
function detectOS(ua) {
  if (!ua) return '';
  if (/windows/i.test(ua))      return 'Windows';
  if (/mac os/i.test(ua))       return 'macOS';
  if (/iphone|ipad/i.test(ua))  return 'iOS';
  if (/android/i.test(ua))      return 'Android';
  if (/linux/i.test(ua))        return 'Linux';
  return '';
}
function relativeTime(iso, t) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)        return t('security.time.justNow');
  if (diff < 3600)      return t('security.time.minAgo', { n: Math.floor(diff / 60) });
  if (diff < 86400)     return t('security.time.hAgo',   { n: Math.floor(diff / 3600) });
  if (diff < 86400 * 7) return t('security.time.dAgo',   { n: Math.floor(diff / 86400) });
  return new Date(iso).toLocaleDateString();
}

export default function Security() {
  const { t } = useTranslation();
  const [sessions, setSessions]     = useState(null);
  const [busy, setBusy]             = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, { credentials: 'include' });
      setSessions(res.ok ? await res.json() : []);
    } catch { setSessions([]); }
  };
  useEffect(() => { load(); }, []);

  const revoke = async (id) => {
    setBusy(id);
    try {
      await fetch(`${API_BASE}/api/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
      setSessions(prev => (prev || []).filter(s => s.id !== id));
    } finally { setBusy(null); }
  };

  const logoutAll = async () => {
    setBusy('all');
    try {
      await fetch(`${API_BASE}/api/logout-all`, { method: 'POST', credentials: 'include' });
      window.location.href = '/login';
    } finally { setBusy(null); }
  };

  return (
    <>
      <h1 className="crm-page-title">{t('security.title')}</h1>

      <div className="bulk-settings">
        <section className="bulk-section">
          <header className="bulk-section-head">
            <div className="bulk-section-icon"><ShieldCheck weight="duotone" /></div>
            <div className="bulk-section-text">
              <h2 className="bulk-section-title">{t('security.sessions.title')}</h2>
              <p className="bulk-section-sub">{t('security.sessions.subtitle')}</p>
            </div>
            {sessions && sessions.length > 1 && (
              confirmAll ? (
                <div className="sett-sec-actions">
                  <button className="auth-btn-check" type="button" onClick={() => setConfirmAll(false)}>{t('common.cancel')}</button>
                  <button className="auth-btn-danger" type="button" onClick={logoutAll} disabled={busy === 'all'}>
                    <SignOut size={14} /> {t('common.confirm')}
                  </button>
                </div>
              ) : (
                <button className="auth-btn-danger" type="button" onClick={() => setConfirmAll(true)}>
                  <SignOut size={14} /> {t('security.sessions.logoutEverywhere')}
                </button>
              )
            )}
          </header>

          {sessions === null ? (
            <div className="crm-placeholder">{t('security.sessions.loading')}</div>
          ) : sessions.length === 0 ? (
            <div className="crm-placeholder">{t('security.sessions.empty')}</div>
          ) : (
            <div className="sett-sessions">
              {sessions.map(s => {
                const Icon = detectDevice(s.user_agent).kind === 'mobile' ? DeviceMobile : DesktopTower;
                const os = detectOS(s.user_agent);
                return (
                  <div key={s.id} className="sett-session-row">
                    <div className="sett-session-icon"><Icon size={20} /></div>
                    <div className="sett-session-info">
                      <span className="sett-session-name">
                        {detectBrowser(s.user_agent)}{os ? ` · ${os}` : ''}
                        {s.is_current && (
                          <span className="auth-badge-enabled sett-session-badge"><Check size={11} /> {t('security.sessions.thisDevice')}</span>
                        )}
                      </span>
                      <span className="sett-session-meta">
                        {s.ip && <>{s.ip} · </>}
                        {s.last_used_at && <>{t('security.sessions.lastUsed', { time: relativeTime(s.last_used_at, t) })} · </>}
                        {t('security.sessions.signedIn', { time: relativeTime(s.created_at, t) })}
                      </span>
                    </div>
                    {!s.is_current && (
                      <button className="crm-icon-btn crm-icon-btn--danger" type="button"
                        title={t('security.sessions.revoke')} disabled={busy === s.id} onClick={() => revoke(s.id)}>
                        <Trash size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="bulk-section">
          <header className="bulk-section-head">
            <div className="bulk-section-icon"><Info weight="duotone" /></div>
            <div className="bulk-section-text">
              <h2 className="bulk-section-title">{t('security.about.title')}</h2>
              <p className="bulk-section-sub">{t('security.about.subtitle')}</p>
            </div>
          </header>
          <p className="sett-about-text">{t('security.about.text')}</p>
        </section>
      </div>
    </>
  );
}
