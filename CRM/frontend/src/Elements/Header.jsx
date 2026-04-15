import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CaretDown, GearSix, SignOut, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import '../Style/Header.css';

/* ── Initials avatar ── */
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

/* ── Modal overlay for create forms ── */
function CreateModal({ title, onClose, onSubmit, submitting, canSubmit, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="hdr-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hdr-modal">
        <div className="hdr-modal-head">
          <span className="hdr-modal-title">{title}</span>
          <button className="hdr-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X className="hdr-modal-close-icon" />
          </button>
        </div>
        <form className="hdr-modal-body" onSubmit={onSubmit}>
          {children}
          <button className="hdr-modal-submit" type="submit" disabled={submitting || !canSubmit}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}

/* ── Org switcher ── */
function OrgSwitcher({ project, org: orgProp }) {
  const navigate  = useNavigate();
  const [open,    setOpen]    = useState(false);
  const [orgs,    setOrgs]    = useState([]);
  const [loaded,  setLoaded]  = useState(false);
  const [query,   setQuery]   = useState('');
  const [modal,   setModal]   = useState(false);
  const [newName, setNewName] = useState('');
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');
  const wrapRef   = useRef(null);
  const searchRef = useRef(null);

  // Dynamic indicator
  const itemsEl   = useRef(null);
  const itemEls   = useRef({});
  const [hovId,   setHovId]   = useState(null);
  const [ind,     setInd]     = useState({ opacity: 0, y: 0, h: 0 });

  // Normalise: accept either a direct org object or derive from project
  const orgId   = orgProp?.id   ?? project?.org_id   ?? null;
  const orgName = orgProp?.name ?? project?.org_name ?? '…';
  const orgSlug = orgProp?.slug ?? project?.org_slug ?? '';

  const activeId = orgId;
  const curId    = hovId ?? activeId;

  const filtered = useMemo(
    () => orgs.filter(o => o.name.toLowerCase().includes(query.toLowerCase())),
    [orgs, query]
  );

  useEffect(() => {
    if (!open) { setInd(p => ({ ...p, opacity: 0 })); return; }
    const raf = requestAnimationFrame(() => {
      const el = curId != null ? itemEls.current[curId] : null;
      if (!el) { setInd(p => ({ ...p, opacity: 0 })); return; }
      setInd({ opacity: 1, y: el.offsetTop, h: el.offsetHeight });
    });
    return () => cancelAnimationFrame(raf);
  }, [curId, open, filtered]);

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
    setOpen(v => {
      if (!v) setTimeout(() => searchRef.current?.focus(), 50);
      return !v;
    });
    setQuery('');
  };

  const openModal  = () => { setOpen(false); setModal(true); setNewName(''); setErr(''); };
  const closeModal = () => { setModal(false); setNewName(''); setErr(''); };

  const createOrg = async e => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return setErr('Name is required');
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || 'Error'); return; }
      setOrgs(prev => [data, ...prev]);
      closeModal();
      navigate(`/org/${data.slug}`);
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="hdr-switcher" ref={wrapRef}>
        <div className="hdr-switcher-btn">
          <button className="hdr-switcher-name" onClick={() => navigate(`/org/${orgSlug}`)} type="button">
            {orgName}
          </button>
          <button className="hdr-switcher-arrow" onClick={handleOpen} type="button" aria-label="Show organizations">
            <CaretDown className={`hdr-switcher-chevron${open ? ' hdr-switcher-chevron--open' : ''}`} />
          </button>
        </div>

        <div className={`hdr-switcher-drop${open ? ' hdr-switcher-drop--open' : ''}`}>
          <div className="hdr-switcher-list">

            <div className="hdr-search-wrap">
              <MagnifyingGlass className="hdr-search-icon" />
              <input
                ref={searchRef}
                className="hdr-search-input"
                placeholder="Search organizations…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            <div className="hdr-sw-items" ref={itemsEl}>
              <div
                className="hdr-sw-indicator"
                style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }}
              />
              {filtered.length === 0
                ? <span className="hdr-switcher-empty">No results</span>
                : filtered.map(org => (
                  <button
                    key={org.id}
                    ref={el => { if (el) itemEls.current[org.id] = el; else delete itemEls.current[org.id]; }}
                    className={`hdr-switcher-item${curId === org.id ? ' hdr-sw-item--current' : ''}`}
                    onMouseEnter={() => setHovId(org.id)}
                    onMouseLeave={() => setHovId(null)}
                    onClick={() => { setOpen(false); navigate(`/org/${org.slug}`); }}
                    type="button"
                  >{org.name}</button>
                ))
              }
            </div>

            <div className="hdr-switcher-sep" />

            <button className="hdr-switcher-new" onClick={() => { setOpen(false); navigate('/dashboard'); }} type="button">
              All Organizations
            </button>

            <div className="hdr-switcher-sep" />

            <button className="hdr-switcher-new" onClick={openModal} type="button">
              <Plus className="hdr-switcher-new-icon" />
              New organization
            </button>
          </div>
        </div>
      </div>

      {modal && (
        <CreateModal title="New organization" onClose={closeModal} onSubmit={createOrg} submitting={saving} canSubmit={!!newName.trim()}>
          <div className="hdr-modal-field">
            <h4 className="hdr-modal-label">Name</h4>
            <input
              className="hdr-modal-input"
              placeholder="Organization name"
              value={newName}
              onChange={e => { setNewName(e.target.value); setErr(''); }}
              autoFocus
              maxLength={100}
            />
          </div>
          {err && <span className="hdr-modal-err">{err}</span>}
        </CreateModal>
      )}
    </>
  );
}

/* ── Project switcher ── */
function ProjectSwitcher({ project }) {
  const navigate   = useNavigate();
  const [open,     setOpen]    = useState(false);
  const [projects, setProjects] = useState([]);
  const [loaded,   setLoaded]  = useState(false);
  const [query,    setQuery]   = useState('');
  const [modal,    setModal]   = useState(false);
  const [newName,  setNewName] = useState('');
  const [newUrl,   setNewUrl]  = useState('');
  const [saving,   setSaving]  = useState(false);
  const [err,      setErr]     = useState('');
  const wrapRef    = useRef(null);
  const searchRef  = useRef(null);

  // Dynamic indicator
  const itemsEl  = useRef(null);
  const itemEls  = useRef({});
  const [hovId,  setHovId]  = useState(null);
  const [ind,    setInd]    = useState({ opacity: 0, y: 0, h: 0 });

  const activeId = project?.id ?? null;
  const curId    = hovId ?? activeId;

  const filtered = useMemo(
    () => projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase())),
    [projects, query]
  );

  useEffect(() => {
    if (!open) { setInd(p => ({ ...p, opacity: 0 })); return; }
    const raf = requestAnimationFrame(() => {
      const el = curId != null ? itemEls.current[curId] : null;
      if (!el) { setInd(p => ({ ...p, opacity: 0 })); return; }
      setInd({ opacity: 1, y: el.offsetTop, h: el.offsetHeight });
    });
    return () => cancelAnimationFrame(raf);
  }, [curId, open, filtered]);

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
    setOpen(v => {
      if (!v) setTimeout(() => searchRef.current?.focus(), 50);
      return !v;
    });
    setQuery('');
  };

  const openModal  = () => { setOpen(false); setModal(true); setNewName(''); setNewUrl(''); setErr(''); };
  const closeModal = () => { setModal(false); setNewName(''); setNewUrl(''); setErr(''); };

  const isValidUrl = url => {
    try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch { return false; }
  };

  const createProject = async e => {
    e.preventDefault();
    const name = newName.trim();
    const url  = newUrl.trim();
    if (!name) return setErr('Name is required');
    if (!url)  return setErr('Frontend URL is required');
    if (!isValidUrl(url)) return setErr('Enter a valid URL: http://... or https://...');
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs/${project.org_id}/projects`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, frontend_url: url }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || 'Error'); return; }
      setProjects(prev => [data, ...prev]);
      closeModal();
      navigate(`/project/${data.api_key}`);
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="hdr-switcher" ref={wrapRef}>
        <div className="hdr-switcher-btn">
          <button className="hdr-switcher-name" onClick={() => navigate(`/project/${project?.api_key}`)} type="button">
            {project?.name || '…'}
          </button>
          <button className="hdr-switcher-arrow" onClick={handleOpen} type="button" aria-label="Show projects">
            <CaretDown className={`hdr-switcher-chevron${open ? ' hdr-switcher-chevron--open' : ''}`} />
          </button>
        </div>

        <div className={`hdr-switcher-drop${open ? ' hdr-switcher-drop--open' : ''}`}>
          <div className="hdr-switcher-list">

            <div className="hdr-search-wrap">
              <MagnifyingGlass className="hdr-search-icon" />
              <input
                ref={searchRef}
                className="hdr-search-input"
                placeholder="Search projects…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            <div className="hdr-sw-items" ref={itemsEl}>
              <div
                className="hdr-sw-indicator"
                style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }}
              />
              {filtered.length === 0
                ? <span className="hdr-switcher-empty">No results</span>
                : filtered.map(p => (
                  <button
                    key={p.id}
                    ref={el => { if (el) itemEls.current[p.id] = el; else delete itemEls.current[p.id]; }}
                    className={`hdr-switcher-item${curId === p.id ? ' hdr-sw-item--current' : ''}`}
                    onMouseEnter={() => setHovId(p.id)}
                    onMouseLeave={() => setHovId(null)}
                    onClick={() => { setOpen(false); navigate(`/project/${p.api_key}`); }}
                    type="button"
                  >{p.name}</button>
                ))
              }
            </div>

            <div className="hdr-switcher-sep" />

            <button className="hdr-switcher-new" onClick={openModal} type="button">
              <Plus className="hdr-switcher-new-icon" />
              New project
            </button>
          </div>
        </div>
      </div>

      {modal && (
        <CreateModal title="New project" onClose={closeModal} onSubmit={createProject} submitting={saving} canSubmit={!!newName.trim() && isValidUrl(newUrl.trim())}>
          <div className="hdr-modal-field">
            <h4 className="hdr-modal-label">Name</h4>
            <input
              className="hdr-modal-input"
              placeholder="Project name"
              value={newName}
              onChange={e => { setNewName(e.target.value); setErr(''); }}
              autoFocus
              maxLength={100}
            />
          </div>
          <div className="hdr-modal-field">
            <h4 className="hdr-modal-label">URL</h4>
            <input
              className="hdr-modal-input"
              placeholder="The URL of your website, e.g. https://shop.com"
              value={newUrl}
              onChange={e => { setNewUrl(e.target.value); setErr(''); }}
              autoComplete="off"
            />
          </div>
          {err && <span className="hdr-modal-err">{err}</span>}
        </CreateModal>
      )}
    </>
  );
}

/* ── User menu ── */
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

/* ── Product breadcrumb with dropdown ── */
function ProductSwitcherCrumb({ project, productContext }) {
  const navigate  = useNavigate();
  const [open,     setOpen]    = useState(false);
  const [products, setProducts] = useState([]);
  const [loaded,   setLoaded]  = useState(false);
  const [query,    setQuery]   = useState('');
  const [modal,    setModal]   = useState(false);
  const [title,    setTitle]   = useState('');
  const [saving,   setSaving]  = useState(false);
  const [err,      setErr]     = useState('');
  const wrapRef   = useRef(null);
  const searchRef = useRef(null);
  const itemsEl   = useRef(null);
  const itemEls   = useRef({});

  // Dynamic indicator — tracks hovered id vs active id (matched by title)
  const [hovId, setHovId] = useState(null);
  const [ind,   setInd]   = useState({ opacity: 0, y: 0, h: 0 });

  const filtered = useMemo(
    () => products.filter(p => p.title.toLowerCase().includes(query.toLowerCase())),
    [products, query]
  );

  const activeId = useMemo(
    () => products.find(p => p.title === productContext?.name)?.id ?? null,
    [products, productContext?.name]
  );
  const curId = hovId ?? activeId;

  useEffect(() => {
    if (!open) { setInd(p => ({ ...p, opacity: 0 })); return; }
    const raf = requestAnimationFrame(() => {
      const el = curId != null ? itemEls.current[curId] : null;
      if (!el) { setInd(p => ({ ...p, opacity: 0 })); return; }
      setInd({ opacity: 1, y: el.offsetTop, h: el.offsetHeight });
    });
    return () => cancelAnimationFrame(raf);
  }, [curId, open, filtered]);

  useEffect(() => {
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleOpen = async () => {
    if (!loaded) {
      const r = await fetch(`${API_BASE}/api/products?project_id=${project.id}`, { credentials: 'include' });
      if (r.ok) setProducts(await r.json());
      setLoaded(true);
    }
    setOpen(v => {
      if (!v) setTimeout(() => searchRef.current?.focus(), 50);
      return !v;
    });
    setQuery('');
  };

  const openModal  = () => { setOpen(false); setModal(true); setTitle(''); setErr(''); };
  const closeModal = () => { setModal(false); setTitle(''); setErr(''); };

  const createProduct = async e => {
    e.preventDefault();
    if (!title.trim()) return setErr('Title is required');
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/products?project_id=${project.id}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || 'Error'); return; }
      closeModal();
      setLoaded(false); // force reload next open
      import('../Utils/hashids.js').then(({ encodeId }) => {
        navigate(`/product/${encodeId(data.id)}`);
      });
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="hdr-switcher" ref={wrapRef}>
        <div className="hdr-switcher-btn">
          <button className="hdr-switcher-name hdr-product-crumb" type="button"
            onClick={() => navigate(`/product/${productContext.hash}`)}>
            {productContext.name || 'Product'}
          </button>
          <button className="hdr-switcher-arrow" type="button" aria-label="Show products"
            onClick={handleOpen}>
            <CaretDown className={`hdr-switcher-chevron${open ? ' hdr-switcher-chevron--open' : ''}`} />
          </button>
        </div>

        <div className={`hdr-switcher-drop${open ? ' hdr-switcher-drop--open' : ''}`}>
          <div className="hdr-switcher-list">

            <div className="hdr-search-wrap">
              <MagnifyingGlass className="hdr-search-icon" />
              <input
                ref={searchRef}
                className="hdr-search-input"
                placeholder="Search products…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            <div className="hdr-sw-items" ref={itemsEl}>
              <div className="hdr-sw-indicator"
                style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }} />
              {filtered.length === 0
                ? <span className="hdr-switcher-empty">No results</span>
                : filtered.map(p => (
                    <button
                      key={p.id}
                      ref={el => { if (el) itemEls.current[p.id] = el; else delete itemEls.current[p.id]; }}
                      className={`hdr-switcher-item${curId === p.id ? ' hdr-sw-item--current' : ''}`}
                      onMouseEnter={() => setHovId(p.id)}
                      onMouseLeave={() => setHovId(null)}
                      onClick={async () => {
                        setOpen(false);
                        const { encodeId } = await import('../Utils/hashids.js');
                        navigate(`/product/${encodeId(p.id)}`);
                      }}
                      type="button"
                    >{p.title}</button>
                  ))
              }
            </div>

            <div className="hdr-switcher-sep" />

            <button className="hdr-switcher-new" type="button"
              onClick={() => { setOpen(false); navigate(`/project/${project.api_key}/products`); }}>
              All Products
            </button>

            <div className="hdr-switcher-sep" />

            <button className="hdr-switcher-new" type="button" onClick={openModal}>
              <Plus className="hdr-switcher-new-icon" />
              New product
            </button>
          </div>
        </div>
      </div>

      {modal && (
        <CreateModal title="New product" onClose={closeModal} onSubmit={createProduct}
          submitting={saving} canSubmit={!!title.trim()}>
          <div className="hdr-modal-field">
            <h4 className="hdr-modal-label">Title</h4>
            <input className="hdr-modal-input" placeholder="Product name" value={title} autoFocus
              onChange={e => { setTitle(e.target.value); setErr(''); }} maxLength={200} />
          </div>
          {err && <span className="hdr-modal-err">{err}</span>}
        </CreateModal>
      )}
    </>
  );
}

/* ── Header ── */
function Header({ user, project, org, productContext }) {
  const navigate = useNavigate();
  return (
    <header className="crm-header">
      <div className="hdr-left">
        <button className="hdr-brand" onClick={() => navigate('/dashboard')} type="button">
          <svg className="hdr-brand-logo" viewBox="0 0 3070 3070" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3061.91 1516.01C3065.95 1523.01 3067.97 1526.51 3068.76 1530.22C3069.46 1533.51 3069.46 1536.91 3068.76 1540.2C3067.97 1543.92 3065.95 1547.42 3061.91 1554.41L2316.09 2846.23C2312.05 2853.22 2310.03 2856.72 2307.2 2859.27C2304.7 2861.52 2301.76 2863.22 2298.56 2864.26C2294.94 2865.43 2290.91 2865.43 2282.83 2865.43H769.002C769.001 2865.43 768.999 2865.43 768.999 2865.43C768.998 2865.43 768.997 2865.42 768.998 2865.42L1503.75 1592.81C1514.66 1573.91 1520.12 1564.46 1519.3 1556.7C1518.59 1549.94 1515.04 1543.79 1509.54 1539.8C1503.23 1535.21 1492.32 1535.21 1470.49 1535.21H1.00289C1.00227 1535.21 1.00179 1535.21 1.00179 1535.21V1535.21C1.00179 1535.22 1.00064 1535.22 1.00015 1535.22C0.999961 1535.22 0.99995 1535.21 1.00012 1535.21L757.915 224.2C761.953 217.205 763.972 213.708 766.797 211.165C769.297 208.914 772.241 207.214 775.44 206.175C779.055 205 783.093 205 791.17 205H2282.83C2290.91 205 2294.94 205 2298.56 206.175C2301.76 207.214 2304.7 208.914 2307.2 211.165C2310.03 213.708 2312.05 217.205 2316.08 224.2L3061.91 1516.01Z" fill="currentColor"/>
          </svg>
        </button>
        {/* Org-level pages: show org switcher */}
        {org && !project && (
          <>
            <span className="hdr-sep">/</span>
            <OrgSwitcher org={org} />
          </>
        )}
        {/* Project-level pages: show org switcher + project switcher */}
        {project && (
          <>
            <span className="hdr-sep">/</span>
            <OrgSwitcher project={project} />
            <span className="hdr-sep">/</span>
            <ProjectSwitcher project={project} />
          </>
        )}
        {/* Product page: show product switcher as 4th breadcrumb level */}
        {project && productContext && (
          <>
            <span className="hdr-sep">/</span>
            <ProductSwitcherCrumb project={project} productContext={productContext} />
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
