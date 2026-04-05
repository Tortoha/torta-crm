import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { CaretDown, GearSix, SignOut } from '@phosphor-icons/react';
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

/* ── User avatar menu ── */
function UserMenu({ user, project }) {
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
          <CaretDown className={`hdr-combo-chevron${open ? ' hdr-combo-chevron--open' : ''}`} />
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
            <button className="api-drop-item" onClick={() => { setOpen(false); navigate(project ? `/project/${project.api_key}/settings` : '/dashboard'); }}>
              <GearSix className="api-drop-icon" /> Settings
            </button>
            <button className="api-drop-item api-drop-item--danger" onClick={logout}>
              <SignOut className="api-drop-icon" /> Log out
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ── Header ── */
function Header({ user, project }) {
  return (
    <header className="crm-header">
      <nav className="hdr-breadcrumb">
        <Link to="/dashboard" className="hdr-breadcrumb-link">Organizations</Link>
        {project && (
          <>
            <span className="hdr-breadcrumb-sep">/</span>
            <Link to={`/org/${project.org_slug}`} className="hdr-breadcrumb-link">
              {project.org_name}
            </Link>
            <span className="hdr-breadcrumb-sep">/</span>
            <span className="hdr-breadcrumb-current">{project.name}</span>
          </>
        )}
      </nav>
      {user && <UserMenu user={user} project={project} />}
    </header>
  );
}

export default Header;
