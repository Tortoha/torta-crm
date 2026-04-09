import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  Plus, X, MagnifyingGlass, SquaresFour, List, ArrowRight,
  DotsThreeOutline, PencilSimple, Copy, Gear, Trash,
} from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import '../Style/Organizations.css';

// ─── Helpers ────────────────────────────────────────────────────────────────

const isValidUrl = url => {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
};

// ─── Tilt settings ──────────────────────────────────────────────────────────

const TILT = {
  maxAngle: 18, lerp: 0.05, lerpOut: 0.07,
  scale: 1.05, perspective: 700,
  gloss: { opacity: 0.18, spread: 60 },
};

// ─── TiltCard ────────────────────────────────────────────────────────────────

function TiltCard({ project, frozen, children }) {
  const ref      = useRef(null);
  const glossRef = useRef(null);
  const rafRef   = useRef(null);
  const cur      = useRef({ rx: 0, ry: 0, x: 0, y: 0, scale: 1 });
  const tgt      = useRef({ rx: 0, ry: 0, x: 0, y: 0, scale: 1, hovered: false });
  const navigate = useNavigate();

  // Sync frozen to ref so callbacks don't go stale
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  const loop = useCallback(() => {
    const c = cur.current, t = tgt.current;
    const lf = t.hovered ? TILT.lerp : TILT.lerpOut;
    c.rx    += (t.rx    - c.rx)    * lf;
    c.ry    += (t.ry    - c.ry)    * lf;
    c.x     += (t.x     - c.x)     * lf;
    c.y     += (t.y     - c.y)     * lf;
    c.scale += (t.scale - c.scale) * lf;
    const el = ref.current;
    if (!el) return;
    el.style.transform = `perspective(${TILT.perspective}px) rotateX(${c.rx}deg) rotateY(${c.ry}deg) scale(${c.scale})`;
    if (glossRef.current) {
      glossRef.current.style.opacity = t.hovered ? '1' : '0';
      glossRef.current.style.backgroundImage = `radial-gradient(circle at ${50 + c.x * TILT.gloss.spread}% ${50 + c.y * TILT.gloss.spread}%, rgba(255,255,255,${TILT.gloss.opacity}) 0%, transparent 70%)`;
    }
    if (!t.hovered && Math.abs(c.rx) + Math.abs(c.ry) + Math.abs(c.scale - 1) * 20 < 0.05) {
      el.style.transform = '';
      cur.current = { rx: 0, ry: 0, x: 0, y: 0, scale: 1 };
      rafRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // Плавно возвращаем карточку в нейтраль когда открывается меню
  useEffect(() => {
    if (!frozen) return;
    Object.assign(tgt.current, { hovered: false, rx: 0, ry: 0, x: 0, y: 0, scale: 1 });
    if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
  }, [frozen, loop]);

  const onMouseEnter = useCallback(() => {
    if (frozenRef.current) return;
    tgt.current.hovered = true;
    tgt.current.scale   = TILT.scale;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const onMouseMove = useCallback(e => {
    if (frozenRef.current) return;
    const el = ref.current;
    if (!el) return;
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = (e.clientX - left) / width  - 0.5;
    const y = (e.clientY - top)  / height - 0.5;
    tgt.current.rx = -y * TILT.maxAngle;
    tgt.current.ry =  x * TILT.maxAngle;
    tgt.current.x  = x; tgt.current.y = y;
  }, []);

  const onMouseLeave = useCallback(() => {
    Object.assign(tgt.current, { hovered: false, rx: 0, ry: 0, x: 0, y: 0, scale: 1 });
  }, []);

  return (
    <div
      ref={ref}
      className="org-card org-card--tilt"
      onClick={() => navigate(`/project/${project.api_key}`)}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <div ref={glossRef} className="org-card-gloss" />
      {children}
    </div>
  );
}

// ─── CardMenu ────────────────────────────────────────────────────────────────

function CardMenu({ project, btnRef, onClose, onRename, onDelete }) {
  const navigate = useNavigate();
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 184) });
    }
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [btnRef, onClose]);

  if (!pos) return null;
  const stop = e => e.stopPropagation();

  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={stop} onClick={stop}>
      <button className="org-card-dropdown-item" onClick={onRename}>
        <PencilSimple className="org-card-dropdown-icon" /> Rename
      </button>
      <button className="org-card-dropdown-item" onClick={() => { navigator.clipboard.writeText(project.api_key); onClose(); }}>
        <Copy className="org-card-dropdown-icon" /> Copy Public Key
      </button>
      <button className="org-card-dropdown-item" onClick={() => { navigate(`/project/${project.api_key}/settings`); onClose(); }}>
        <Gear className="org-card-dropdown-icon" /> Settings
      </button>
      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger" onClick={onDelete}>
        <Trash className="org-card-dropdown-icon" /> Delete
      </button>
    </div>,
    document.body
  );
}

// ─── ProjectCard ─────────────────────────────────────────────────────────────

function ProjectCard({ p, onRename, onDelete }) {
  const menuBtnRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  const toggleMenu = e => { e.stopPropagation(); setMenuOpen(v => !v); };

  return (
    <TiltCard project={p} frozen={menuOpen}>
      <div className="org-card-inner">
        <button ref={menuBtnRef} className="org-card-menu-btn" onClick={toggleMenu}
          type="button" aria-label="Options">
          <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
        </button>
        <div className="org-card-name">{p.name}</div>
        <div className="org-card-meta">{p.api_key.slice(0, 16)}…</div>
        <span className={`org-card-badge${p.is_active ? '' : ' org-card-badge--inactive'}`}>
          {p.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      {menuOpen && (
        <CardMenu
          project={p}
          btnRef={menuBtnRef}
          onClose={() => setMenuOpen(false)}
          onRename={() => { setMenuOpen(false); onRename(p); }}
          onDelete={() => { setMenuOpen(false); onDelete(p.id); }}
        />
      )}
    </TiltCard>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className="hdr-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="hdr-modal">
        <div className="hdr-modal-head">
          <span className="hdr-modal-title">{title}</span>
          <button className="hdr-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X className="hdr-modal-close-icon" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

// ─── RenameModal ─────────────────────────────────────────────────────────────

function RenameModal({ project, onClose, onSaved }) {
  const [name,   setName]   = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const handleSubmit = async e => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setErr('Name is required');
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/projects/${project.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) return setErr(data.detail || 'Error');
      onSaved({ ...project, name: trimmed });
      onClose();
    } catch { setErr('Network error'); }
    finally   { setSaving(false); }
  };

  return (
    <Modal title="Rename project" onClose={onClose}>
      <form className="hdr-modal-body" onSubmit={handleSubmit}>
        <div className="hdr-modal-field">
          <h4 className="hdr-modal-label">Name</h4>
          <input className="hdr-modal-input" value={name} autoFocus maxLength={100}
            onChange={e => { setName(e.target.value); setErr(''); }} />
        </div>
        {err && <span className="hdr-modal-err">{err}</span>}
        <button className="hdr-modal-submit" type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Modal>
  );
}

// ─── CreateProjectModal ──────────────────────────────────────────────────────

function CreateProjectModal({ orgId, onClose, onCreated }) {
  const [name,   setName]   = useState('');
  const [url,    setUrl]    = useState('');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const handleSubmit = async e => {
    e.preventDefault();
    const trimName = name.trim(), trimUrl = url.trim();
    if (!trimName)           return setErr('Name is required');
    if (!isValidUrl(trimUrl)) return setErr('Enter a valid URL: http://... or https://...');
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs/${orgId}/projects`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimName, frontend_url: trimUrl }),
      });
      const data = await res.json();
      if (!res.ok) return setErr(data.detail || 'Error');
      onCreated(data);
      onClose();
    } catch { setErr('Network error'); }
    finally   { setSaving(false); }
  };

  return (
    <Modal title="New project" onClose={onClose}>
      <form className="hdr-modal-body" onSubmit={handleSubmit}>
        <div className="hdr-modal-field">
          <h4 className="hdr-modal-label">Name</h4>
          <input className="hdr-modal-input" placeholder="Project name" autoFocus maxLength={100}
            value={name} onChange={e => { setName(e.target.value); setErr(''); }} />
        </div>
        <div className="hdr-modal-field">
          <h4 className="hdr-modal-label">Frontend URL</h4>
          <input className="hdr-modal-input" placeholder="https://your-store.com" autoComplete="off"
            value={url} onChange={e => { setUrl(e.target.value); setErr(''); }} />
        </div>
        {err && <span className="hdr-modal-err">{err}</span>}
        <button className="hdr-modal-submit" type="submit" disabled={saving || !name.trim() || !isValidUrl(url.trim())}>
          {saving ? 'Creating…' : 'Create'}
        </button>
      </form>
    </Modal>
  );
}

// ─── Organizations ───────────────────────────────────────────────────────────

function Organizations() {
  const { org }  = useOutletContext();
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [search,   setSearch]   = useState('');
  const [view,     setView]     = useState('grid');

  useEffect(() => {
    if (!org) return;
    fetch(`${API_BASE}/api/orgs/${org.id}/projects`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setProjects(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [org]);

  const handleDelete = async id => {
    if (!window.confirm('Delete this project? This cannot be undone.')) return;
    try {
      await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE', credentials: 'include' });
      setProjects(prev => prev.filter(p => p.id !== id));
    } catch { /* ignore */ }
  };

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  const filtered = projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <h1 className="crm-page-title org-page-title">Projects</h1>

      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search projects…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="org-view-toggle">
          <button className={`org-view-btn${view === 'grid' ? ' org-view-btn--active' : ''}`}
            onClick={() => setView('grid')} title="Grid view" type="button">
            <SquaresFour className="org-view-icon" />
          </button>
          <button className={`org-view-btn${view === 'list' ? ' org-view-btn--active' : ''}`}
            onClick={() => setView('list')} title="List view" type="button">
            <List className="org-view-icon" />
          </button>
        </div>

        <button className="org-new-btn" onClick={() => setModal(true)} type="button">
          <Plus className="org-new-icon" /> New project
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="crm-placeholder">
          {projects.length === 0 ? 'No projects yet. Create one to get started.' : 'No projects match your search.'}
        </div>
      ) : view === 'grid' ? (
        <div className="org-grid">
          {filtered.map(p => (
            <ProjectCard key={p.id} p={p} onRename={setRenaming} onDelete={handleDelete} />
          ))}
        </div>
      ) : (
        <div className="org-table">
          <div className="org-table-head">
            <span className="org-table-th">Project</span>
            <span className="org-table-th">API Key</span>
            <span className="org-table-th">Status</span>
            <span />
          </div>
          {filtered.map(p => (
            <div key={p.id} className="org-table-row" onClick={() => navigate(`/project/${p.api_key}`)}>
              <div className="org-table-name-cell">
                <span className="org-table-name">{p.name}</span>
              </div>
              <span className="org-table-key">{p.api_key.slice(0, 16)}…</span>
              <span className={`org-table-status${p.is_active ? ' org-table-status--active' : ''}`}>
                {p.is_active ? 'Active' : 'Inactive'}
              </span>
              <div className="org-table-arrow">
                <ArrowRight className="org-table-arrow-icon" />
              </div>
            </div>
          ))}
        </div>
      )}

      {modal    && <CreateProjectModal orgId={org.id} onClose={() => setModal(false)}    onCreated={data => setProjects(prev => [data, ...prev])} />}
      {renaming && <RenameModal project={renaming}    onClose={() => setRenaming(null)}   onSaved={u => setProjects(prev => prev.map(p => p.id === u.id ? u : p))} />}
    </>
  );
}

export default Organizations