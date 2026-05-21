// Security — bulk-style (mirrors Project Settings: Section + FieldCard).
// Active sessions list + log-out-everywhere + a short "what is a session" note.

import { useEffect, useState } from 'react';
import { Trash, DesktopTower, DeviceMobile, SignOut, Check, ShieldCheck, Info } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { Section, FieldCard } from '../Project/ProjectSettings.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';
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
function relativeTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)        return 'just now';
  if (diff < 3600)      return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Security() {
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
      <h1 className="crm-page-title">Security</h1>

      <div className="bulk-settings">
        <Section icon={<ShieldCheck weight="duotone" />} title="Active sessions"
          subtitle="Every device where you're signed in. Revoking ends that session immediately.">

          {sessions === null ? (
            <div className="crm-placeholder">Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div className="crm-placeholder">No active sessions found.</div>
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
                          <span className="auth-badge-enabled sett-session-badge"><Check size={11} /> This device</span>
                        )}
                      </span>
                      <span className="sett-session-meta">
                        {s.ip && <>{s.ip} · </>}
                        {s.last_used_at && <>last used {relativeTime(s.last_used_at)} · </>}
                        signed in {relativeTime(s.created_at)}
                      </span>
                    </div>
                    {!s.is_current && (
                      <button className="crm-icon-btn crm-icon-btn--danger" type="button"
                        title="Revoke session" disabled={busy === s.id} onClick={() => revoke(s.id)}>
                        <Trash size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {sessions && sessions.length > 1 && (
            <FieldCard label="Log out everywhere"
              hint="Ends every other session and signs this device out too.">
              {confirmAll ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="auth-btn-check" type="button" onClick={() => setConfirmAll(false)}>Cancel</button>
                  <button className="auth-btn-danger" type="button" onClick={logoutAll} disabled={busy === 'all'}>
                    <SignOut size={14} /> Confirm — log out everywhere
                  </button>
                </div>
              ) : (
                <button className="auth-btn-danger" type="button" onClick={() => setConfirmAll(true)}>
                  <SignOut size={14} /> Log out from all devices
                </button>
              )}
            </FieldCard>
          )}
        </Section>

        <Section icon={<Info weight="duotone" />} title="About sessions"
          subtitle="How staying logged in works.">
          <p className="sett-about-text">
            A session is created every time you sign in (email code, Google, etc). Each one is a
            short-lived access token (15 min) plus a long-lived refresh token (30 days) — your
            browser silently swaps an expired access token for a new one, so you stay logged in
            transparently. If you suspect someone has access to your account, log out from all
            devices and change your password.
          </p>
        </Section>
      </div>
    </>
  );
}
