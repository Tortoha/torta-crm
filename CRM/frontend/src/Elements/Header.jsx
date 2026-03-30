import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDownIcon, KeyIcon,
  Cog6ToothIcon, ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/solid';
import { API_BASE } from '../api.js';
import '../Style/Header.css';

/* ── Utility: initials avatar ── */
function InitialsAvatar({ name, size = 30 }) {
  const initials = (name || '?')
    .split(' ').filter(Boolean)
    .map(w => w[0].toUpperCase()).slice(0, 2).join('');
  const palette = ['#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f43f5e', '#3b82f6'];
  const bg = palette[(name?.charCodeAt(0) ?? 0) % palette.length];
  return (
    <div
      className="hdr-avatar"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

/* ── Project switcher (ApiComboBox) ── */
function ApiComboBox() {
  const [keys,    setKeys]    = useState([]);
  const [active,  setActive]  = useState(null);
  const [open,    setOpen]    = useState(false);
  const [hovered, setHovered] = useState(null);

  const listRef  = useRef(null);
  const itemRefs = useRef({});
  const wrapRef  = useRef(null);
  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });

  const loadKeys = () => {
    fetch(`${API_BASE}/api/api-keys`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        setKeys(data);
        setActive(data.find(k => k.is_selected) || data[0] || null);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadKeys();
    window.addEventListener('api-keys-changed', loadKeys);
    window.addEventListener('api-key-switched',  loadKeys);
    return () => {
      window.removeEventListener('api-keys-changed', loadKeys);
      window.removeEventListener('api-key-switched',  loadKeys);
    };
  }, []);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const activeId  = active?.id ?? null;
  const currentId = hovered ?? activeId;

  useLayoutEffect(() => {
    const container = listRef.current;
    const el = currentId != null ? itemRefs.current[currentId] : null;
    if (!container || !el || !open) { setInd(p => ({ ...p, opacity: 0 })); return; }
    const cr = container.getBoundingClientRect();
    const ir = el.getBoundingClientRect();
    setInd({ opacity: 1, y: ir.top - cr.top, h: ir.height });
  }, [currentId, open]);

  const switchKey = async (k) => {
    setActive(k);
    setOpen(false);
    try {
      await fetch(`${API_BASE}/api/api-keys/switch`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key_id: k.id }),
      });
      loadKeys();
      window.dispatchEvent(new CustomEvent('api-key-switched', { detail: k }));
    } catch { loadKeys(); }
  };

  if (!active) return null;

  const activeKey = keys.find(k => k.id === active.id);
  const userRole  = activeKey?.user_role || null;

  return (
    <div className="hdr-combo" ref={wrapRef}>
      <div className={`hdr-combo-block${open ? ' hdr-combo-block--open' : ''}`}>

        <button className="hdr-combo-trigger" onClick={() => setOpen(v => !v)} type="button">
          <KeyIcon className="hdr-combo-icon" />
          <span className="hdr-combo-label">{active.name}</span>
          {userRole && <span className="hdr-combo-role">{userRole}</span>}
          <ChevronDownIcon className={`hdr-combo-chevron${open ? ' hdr-combo-chevron--open' : ''}`} />
        </button>

        <div className={`hdr-combo-list-wrap${open ? ' hdr-combo-list-wrap--open' : ''}`}>
          <div className="hdr-combo-list" ref={listRef}>
            <div
              className="hdr-combo-indicator"
              style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }}
            />
            {keys.map(k => (
              <div
                key={k.id}
                ref={el => { if (el) itemRefs.current[k.id] = el; else delete itemRefs.current[k.id]; }}
                className={`hdr-combo-item-wrap${currentId === k.id ? ' hdr-combo-item-wrap--current' : ''}`}
                onMouseEnter={() => setHovered(k.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <button className="hdr-combo-item" onClick={() => switchKey(k)} type="button">
                  <span className="hdr-combo-item-name">{k.name}</span>
                  <span className="hdr-combo-item-key">
                    {k.api_key.slice(0, 8)}…{k.api_key.slice(-4)}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

/* ── User avatar menu ── */
function UserMenu({ user }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const logout = async () => {
    await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
    navigate('/');
  };

  return (
    <div className="hdr-user" ref={wrapRef}>
      <div className={`hdr-combo-block hdr-user-block${open ? ' hdr-combo-block--open' : ''}`}>

        <button className="hdr-user-trigger" onClick={() => setOpen(v => !v)} type="button">
          <InitialsAvatar name={user?.name} size={28} />
          <span className="hdr-user-name">{user?.name || 'User'}</span>
          <ChevronDownIcon className={`hdr-combo-chevron${open ? ' hdr-combo-chevron--open' : ''}`} />
        </button>

        <div className={`hdr-combo-list-wrap${open ? ' hdr-combo-list-wrap--open' : ''}`}>
          <div className="hdr-user-menu">
            <div className="hdr-user-info">
              <InitialsAvatar name={user?.name} size={36} />
              <div className="hdr-user-details">
                <span className="hdr-user-fullname">{user?.name}</span>
                <span className="hdr-user-email">{user?.email}</span>
              </div>
            </div>
            <div className="hdr-user-divider" />
            <button className="api-drop-item" onClick={() => { setOpen(false); navigate('/settings'); }}>
              <Cog6ToothIcon className="api-drop-icon" /> Settings
            </button>
            <button className="api-drop-item api-drop-item--danger" onClick={logout}>
              <ArrowRightOnRectangleIcon className="api-drop-icon" /> Log out
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ── Header ── */
function Header({ user }) {
  return (
    <header className="crm-header">
      <ApiComboBox />
      {user && <UserMenu user={user} />}
    </header>
  );
}

export default Header;
