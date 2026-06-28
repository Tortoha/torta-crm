// Stripped clone of CRM/frontend/src/Elements/Header.jsx:
//   keep — brand SVG, NotificationsBell (feedback / inbox pings), UserMenu
//   drop — org/project/product switchers, docs/landing modes
// Same hdr-* classes so the copied Header.css applies untouched.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SignOut, List, Gear } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import NotificationsBell from './NotificationsBell.jsx';
import '../Style/Header.css';

/* ── Initials avatar (1:1 copy from CRM) ── */
function InitialsAvatar({ name, size = 28 }) {
  const initials = (name || '?').split(' ').filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('');
  const palette = ['#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f43f5e', '#3b82f6'];
  const bg = palette[(name?.charCodeAt(0) ?? 0) % palette.length];
  return (
    <div className="hdr-avatar" style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

function UserAvatar({ user, size = 28 }) {
  const url = user?.avatar_url || null;
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [url]);
  if (!url || imgFailed) return <InitialsAvatar name={user?.name} size={size} />;
  return (
    <img
      key={url}
      src={url}
      alt=""
      className="hdr-avatar-photo"
      style={{ width: size, height: size }}
      onError={() => setImgFailed(true)}
    />
  );
}

/* ── User menu — avatar with logout dropdown ── */
function UserMenu({ user }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const logout = async () => {
    try { await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' }); }
    catch (e) { console.warn('Logout failed; navigating anyway', e); }
    if (window.location.pathname === '/login') window.location.reload();
    else window.location.href = '/login';
  };

  return (
    <div className="hdr-user" ref={wrapRef}>
      <button className="hdr-avatar-btn" onClick={() => setOpen(v => !v)} type="button" aria-label="User menu">
        <UserAvatar user={user} size={28} />
      </button>
      <div className={`hdr-user-drop${open ? ' hdr-user-drop--open' : ''}`}>
        <div className="hdr-user-menu">
          <div className="hdr-user-info">
            <UserAvatar user={user} size={34} />
            <div className="hdr-user-details">
              <span className="hdr-user-fullname">{user?.name}</span>
              <span className="hdr-user-email">{user?.email}</span>
            </div>
          </div>
          <div className="hdr-user-sep" />
          <button className="hdr-drop-item" type="button"
            onClick={() => { setOpen(false); navigate('/settings'); }}>
            <Gear className="hdr-drop-icon" /> {t('nav.settings')}
          </button>
          <button className="hdr-drop-item hdr-drop-item--danger" onClick={logout} type="button">
            <SignOut className="hdr-drop-icon" /> {t('nav.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Header ── */
export default function Header({ user, onMobileNavToggle }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <header className="crm-header">
      <div className="hdr-left">
        {onMobileNavToggle && (
          <button className="hdr-hamburger" onClick={onMobileNavToggle} type="button" aria-label="Open menu">
            <List className="hdr-hamburger-icon" weight="bold" />
          </button>
        )}
        <button className="hdr-brand" onClick={() => navigate('/')} type="button">
          {/* Same Torta logo SVG as CRM — currentColor lets dark theme flip it */}
          <svg className="hdr-brand-logo" viewBox="0 0 3070 3070" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3061.91 1516.01C3065.95 1523.01 3067.97 1526.51 3068.76 1530.22C3069.46 1533.51 3069.46 1536.91 3068.76 1540.2C3067.97 1543.92 3065.95 1547.42 3061.91 1554.41L2316.09 2846.23C2312.05 2853.22 2310.03 2856.72 2307.2 2859.27C2304.7 2861.52 2301.76 2863.22 2298.56 2864.26C2294.94 2865.43 2290.91 2865.43 2282.83 2865.43H769.002C769.001 2865.43 768.999 2865.43 768.999 2865.43C768.998 2865.43 768.997 2865.42 768.998 2865.42L1503.75 1592.81C1514.66 1573.91 1520.12 1564.46 1519.3 1556.7C1518.59 1549.94 1515.04 1543.79 1509.54 1539.8C1503.23 1535.21 1492.32 1535.21 1470.49 1535.21H1.00289C1.00227 1535.21 1.00179 1535.21 1.00179 1535.21V1535.21C1.00179 1535.22 1.00064 1535.22 1.00015 1535.22C0.999961 1535.22 0.99995 1535.21 1.00012 1535.21L757.915 224.2C761.953 217.205 763.972 213.708 766.797 211.165C769.297 208.914 772.241 207.214 775.44 206.175C779.055 205 783.093 205 791.17 205H2282.83C2290.91 205 2294.94 205 2298.56 206.175C2301.76 207.214 2304.7 208.914 2307.2 211.165C2310.03 213.708 2312.05 217.205 2316.08 224.2L3061.91 1516.01Z" fill="currentColor"/>
          </svg>
        </button>
        <span className="hdr-sep">/</span>
        <span className="hdr-settings-crumb">{t('nav.admin')}</span>
      </div>
      <div className="hdr-right">
        {user && <NotificationsBell />}
        {user && <UserMenu user={user} />}
      </div>
    </header>
  );
}
