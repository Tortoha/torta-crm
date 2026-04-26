import { useEffect, useState } from 'react';
import { Trash, DesktopTower, DeviceMobile, SignOut, Check, Warning } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import '../../Style/Settings.css';

// ── Helpers ──────────────────────────────────────────────────────────
function detectDevice(ua) {
  if (!ua) return { kind: 'desktop', label: 'Unknown device' };
  const lower = ua.toLowerCase();
  if (/(iphone|android|mobile)/.test(lower)) {
    return { kind: 'mobile', label: 'Mobile' };
  }
  return { kind: 'desktop', label: 'Desktop' };
}

function detectBrowser(ua) {
  if (!ua) return 'Unknown browser';
  if (/edg\//i.test(ua))     return 'Edge';
  if (/chrome/i.test(ua))    return 'Chrome';
  if (/firefox/i.test(ua))   return 'Firefox';
  if (/safari/i.test(ua))    return 'Safari';
  return 'Browser';
}

function detectOS(ua) {
  if (!ua) return '';
  if (/windows/i.test(ua))  return 'Windows';
  if (/mac os/i.test(ua))   return 'macOS';
  if (/iphone|ipad/i.test(ua)) return 'iOS';
  if (/android/i.test(ua))  return 'Android';
  if (/linux/i.test(ua))    return 'Linux';
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

function Security() {
  const [sessions, setSessions]   = useState(null);
  const [busy,     setBusy]       = useState(null);   // session id being revoked
  const [confirmAll, setConfirmAll] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, { credentials: 'include' });
      if (!res.ok) throw 0;
      setSessions(await res.json());
    } catch {
      setSessions([]);
    }
  };

  useEffect(() => { load(); }, []);

  const revoke = async (id) => {
    setBusy(id);
    try {
      await fetch(`${API_BASE}/api/sessions/${id}`, {
        method: 'DELETE', credentials: 'include',
      });
      setSessions(prev => (prev || []).filter(s => s.id !== id));
    } finally { setBusy(null); }
  };

  const logoutAll = async () => {
    setBusy('all');
    try {
      await fetch(`${API_BASE}/api/logout-all`, {
        method: 'POST', credentials: 'include',
      });
      // After logout-all, even THIS tab's refresh is gone — redirect to login
      window.location.href = '/login';
    } finally { setBusy(null); }
  };

  if (sessions === null) {
    return (
      <>
        <h1 className="crm-page-title">Security</h1>
        <p className="crm-placeholder">Loading sessions…</p>
      </>
    );
  }

  return (
    <>
      <h1 className="crm-page-title">Security</h1>

      <section className="bk-section" style={{ marginBottom: 16 }}>
        <div className="bk-section-head">
          <h2 className="bk-section-title">Active sessions</h2>
          {sessions.length > 1 && (
            confirmAll ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="auth-btn-check" type="button"
                        onClick={() => setConfirmAll(false)}>
                  Cancel
                </button>
                <button className="auth-btn-danger" type="button"
                        onClick={logoutAll} disabled={busy === 'all'}>
                  <SignOut size={14} /> Confirm: log out everywhere
                </button>
              </div>
            ) : (
              <button className="auth-btn-danger" type="button"
                      onClick={() => setConfirmAll(true)}>
                <SignOut size={14} /> Log out from all devices
              </button>
            )
          )}
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px 0' }}>
          Each row is a device where you're logged in. Revoking ends that session
          immediately — the device will be asked to log in again on its next request.
        </p>

        {sessions.length === 0 ? (
          <p className="crm-placeholder">No active sessions found.</p>
        ) : (
          <div className="bk-cfg-list">
            {sessions.map(s => {
              const dev = detectDevice(s.user_agent);
              const Icon = dev.kind === 'mobile' ? DeviceMobile : DesktopTower;
              const browser = detectBrowser(s.user_agent);
              const os      = detectOS(s.user_agent);
              return (
                <div key={s.id} className="bk-cfg-row">
                  <div className="bk-cfg-row-main">
                    <div className="bk-cfg-img bk-cfg-img--empty">
                      <Icon size={20} />
                    </div>
                    <div className="bk-cfg-info">
                      <div className="bk-cfg-name">
                        {browser}{os ? ` · ${os}` : ''} {s.label ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {s.label}</span> : null}
                        {s.is_current && (
                          <span className="auth-badge-enabled" style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 999 }}>
                            <Check size={11} /> This device
                          </span>
                        )}
                      </div>
                      <div className="bk-cfg-meta">
                        {s.ip && <span>{s.ip}</span>}
                        {s.last_used_at && <><span>·</span><span>last used {relativeTime(s.last_used_at)}</span></>}
                        <span>·</span>
                        <span>signed in {relativeTime(s.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="bk-cfg-actions">
                    {!s.is_current && (
                      <button className="crm-icon-btn crm-icon-btn--danger"
                              type="button" title="Revoke session"
                              disabled={busy === s.id}
                              onClick={() => revoke(s.id)}>
                        <Trash size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="bk-section">
        <div className="bk-section-head">
          <h2 className="bk-section-title">
            <Warning size={16} weight="fill" style={{ color: 'var(--accent)', marginRight: 6, verticalAlign: 'middle' }} />
            What is a session?
          </h2>
        </div>
        <p style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          A session is created every time you sign in (email code, Google, etc).
          Each session lives in a short-lived access token (15 minutes) plus a long-lived
          refresh token (30 days). Your browser silently swaps an expired access token
          for a new one — you stay logged in transparently. If you suspect someone has
          access to your account, log out from all devices and change your password.
        </p>
      </section>
    </>
  );
}

export default Security;
