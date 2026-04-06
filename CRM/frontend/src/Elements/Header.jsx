import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretDown, GearSix, SignOut, List } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import '../Style/Header.css';

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

function OrgSwitcher({ project }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleOpen = async () => {
    if (!loaded) {
      const r = await fetch(`${API_BASE}/api/orgs`, { credentials: 'include' });
      if (r.ok) setOrgs(await r.json());
      setLoaded(true);
    }
    setOpen(v => !v);
  };

  return (
    <div className="hdr-switcher" ref={wrapRef}>
      <div className="hdr-switcher-btn">
        <button className="hdr-switcher-name" onClick={() => navigate(`/org/${project?.org_slug}`)} type="button">
          {project?.org_name || '…'}
        </button>
        <button className="hdr-switcher-arrow" onClick={handleOpen} type="button" aria-label="Show organizations">
          <CaretDown className={`hdr-switcher-chevron${open ? ' hdr-switcher-chevron--open' : ''}`} />
        </button>
      </div>
      <div className={`hdr-switcher-drop${open ? ' hdr-switcher-drop--open' : ''}`}>
        <div className="hdr-switcher-list">
          {orgs.map(org => (
            <button
              key={org.id}
              className={`hdr-switcher-item${org.id === project?.org_id ? ' hdr-switcher-item--active' : ''}`}
              onClick={() => { setOpen(false); navigate(`/org/${org.slug}`); }}
              type="button"
            >{org.name}</button>
          ))}
          <div className="hdr-switcher-sep" />
          <button className="hdr-switcher-item hdr-switcher-item--muted" onClick={() => { setOpen(false); navigate('/dashboard'); }} type="button">
            All organizations
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectSwitcher({ project }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleOpen = async () => {
    if (!loaded && project?.org_id) {
      const r = await fetch(`${API_BASE}/api/orgs/${project.org_id}/projects`, { credentials: 'include' });
      if (r.ok) setProjects(await r.json());
      setLoaded(true);
    }
    setOpen(v => !v);
  };

  return (
    <div className="hdr-switcher" ref={wrapRef}>
      <div className="hdr-switcher-btn">
        <button className="hdr-switcher-name" onClick={() => navigate(`/project/${project?.api_key}/dashboard`)} type="button">
          {project?.name || '…'}
        </button>
        <button className="hdr-switcher-arrow" onClick={handleOpen} type="button" aria-label="Show projects">
          <CaretDown className={`hdr-switcher-chevron${open ? ' hdr-switcher-chevron--open' : ''}`} />
        </button>
      </div>
      <div className={`hdr-switcher-drop${open ? ' hdr-switcher-drop--open' : ''}`}>
        <div className="hdr-switcher-list">
          {projects.map(p => (
            <button
              key={p.id}
              className={`hdr-switcher-item${p.id === project?.id ? ' hdr-switcher-item--active' : ''}`}
              onClick={() => { setOpen(false); navigate(`/project/${p.api_key}/dashboard`); }}
              type="button"
            >{p.name}</button>
          ))}
          <div className="hdr-switcher-sep" />
          <button className="hdr-switcher-item hdr-switcher-item--muted" onClick={() => { setOpen(false); navigate(`/org/${project?.org_slug}`); }} type="button">
            All projects
          </button>
        </div>
      </div>
    </div>
  );
}

function UserMenu({ user, project }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const logout = async () => {
    await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
    navigate('/');
  };

  return (
    <div className="hdr-user" ref={wrapRef}>
      <button className="hdr-avatar-btn" onClick={() => setOpen(v => !v)} type="button" aria-label="User menu">
        <InitialsAvatar name={user?.name} size={28} />
      </button>
      <div className={`hdr-user-drop${open ? ' hdr-user-drop--open' : ''}`}>
        <div className="hdr-user-menu">
          <div className="hdr-user-info">
            <InitialsAvatar name={user?.name} size={34} />
            <div className="hdr-user-details">
              <span className="hdr-user-fullname">{user?.name}</span>
              <span className="hdr-user-email">{user?.email}</span>
            </div>
          </div>
          <div className="hdr-user-sep" />
          <button className="hdr-drop-item" onClick={() => { setOpen(false); navigate(project ? `/project/${project.api_key}/settings` : '/dashboard'); }} type="button">
            <GearSix className="hdr-drop-icon" /> Settings
          </button>
          <button className="hdr-drop-item hdr-drop-item--danger" onClick={logout} type="button">
            <SignOut className="hdr-drop-icon" /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}

function Header({ user, project, sidebarOpen, onToggleSidebar }) {
  return (
    <header className="crm-header">
      <div className="hdr-left">
        <button className="hdr-toggle-btn" onClick={onToggleSidebar} type="button" aria-label="Toggle sidebar">
          <List weight="bold" className="hdr-toggle-icon" />
        </button>
        {project && (
          <>
            <OrgSwitcher project={project} />
            <span className="hdr-sep">/</span>
            <ProjectSwitcher project={project} />
          </>
        )}
      </div>
      <div className="hdr-right">
        {user && <UserMenu user={user} project={project} />}
      </div>
    </header>
  );
}

export default Header;
