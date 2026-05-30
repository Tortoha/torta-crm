import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CaretDown, GearSix, SignOut, MagnifyingGlass, Plus, BookOpen, Tag, List } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import Modal from './Modal.jsx';
import CreateProductModal from '../Pages/Project/Products/CreateProductModal.jsx';
import NotificationsBell from './NotificationsBell.jsx';
import { encodeId } from '../Utils/hashids.js';
import { DynamicBlock } from '../Utils/DynamicBlock.js';
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

/* ── Avatar with photo fallback ──
   Renders the initials OR the photo — never both stacked. Stacking
   caused a 1-pixel orange halo to peek around the photo's circular
   edge. Now: if there's no URL or the photo failed to load, show
   initials. Otherwise show the photo alone. `onError` switches back
   to initials when the URL 404s / is blocked / times out. The `key`
   on the img forces a remount whenever the URL changes (e.g. after
   logout → re-login with a different account). */
function UserAvatar({ user, size = 28 }) {
  const url = user?.avatar_url || null;
  const [imgFailed, setImgFailed] = useState(false);
  // Reset failure state when the URL changes (new login, avatar update).
  useEffect(() => { setImgFailed(false); }, [url]);

  if (!url || imgFailed) {
    return <InitialsAvatar name={user?.name} size={size} />;
  }
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

/* ── Org switcher ── */
function OrgSwitcher({ project, org: orgProp }) {
  const navigate  = useNavigate();
  const { t }     = useTranslation();
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
    if (!name) return setErr(t('header.form.nameRequired'));
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || t('header.form.error')); return; }
      setOrgs(prev => [data, ...prev]);
      closeModal();
      navigate(`/org/${data.slug}`);
    } catch { setErr(t('common.networkError')); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="hdr-switcher" ref={wrapRef}>
        <div className="hdr-switcher-btn">
          <button className="hdr-switcher-name" onClick={() => navigate(`/org/${orgSlug}`)} type="button">
            {orgName}
          </button>
          <button className="hdr-switcher-arrow" onClick={handleOpen} type="button" aria-label={t('header.org.showOrganizations')}>
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
                placeholder={t('header.org.searchPlaceholder')}
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
                ? <span className="hdr-switcher-empty">{t('header.switcher.noResults')}</span>
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
              {t('header.org.allOrganizations')}
            </button>

            <div className="hdr-switcher-sep" />

            <button className="hdr-switcher-new" onClick={openModal} type="button">
              <Plus className="hdr-switcher-new-icon" />
              {t('header.org.newOrganization')}
            </button>
          </div>
        </div>
      </div>

      {modal && (
        <Modal title={t('header.org.modalTitle')} onClose={closeModal} maxWidth={400}>
          <form onSubmit={createOrg}>
            <div className="hdr-modal-field">
              <h4 className="hdr-modal-label">{t('header.org.nameLabel')}</h4>
              <input
                className="hdr-modal-input"
                placeholder={t('header.org.namePlaceholder')}
                value={newName}
                onChange={e => { setNewName(e.target.value); setErr(''); }}
                autoFocus
                maxLength={100}
              />
            </div>
            {err && <span className="hdr-modal-err">{err}</span>}
            <button className="hdr-modal-submit" type="submit" disabled={saving || !newName.trim()}>
              {saving ? t('header.form.creating') : t('header.form.create')}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ── Project switcher ── */
function ProjectSwitcher({ project }) {
  const navigate   = useNavigate();
  const { t }      = useTranslation();
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
    if (!name) return setErr(t('header.form.nameRequired'));
    if (!url)  return setErr(t('header.form.frontendUrlRequired'));
    if (!isValidUrl(url)) return setErr(t('header.form.invalidUrl'));
    setSaving(true); setErr('');
    try {
      // Send the merchant's browser TZ so booking slot times default to their
      // real operating timezone (not UTC). Backend seeds booking_settings.timezone.
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const res  = await fetch(`${API_BASE}/api/orgs/${project.org_id}/projects`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, frontend_url: url, timezone: browserTz }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || t('header.form.error')); return; }
      setProjects(prev => [data, ...prev]);
      closeModal();
      navigate(`/project/${data.api_key}`);
    } catch { setErr(t('common.networkError')); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="hdr-switcher" ref={wrapRef}>
        <div className="hdr-switcher-btn">
          <button className="hdr-switcher-name" onClick={() => navigate(`/project/${project?.api_key}`)} type="button">
            {project?.name || '…'}
          </button>
          <button className="hdr-switcher-arrow" onClick={handleOpen} type="button" aria-label={t('header.project.showProjects')}>
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
                placeholder={t('header.project.searchPlaceholder')}
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
                ? <span className="hdr-switcher-empty">{t('header.switcher.noResults')}</span>
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
              {t('header.project.newProject')}
            </button>
          </div>
        </div>
      </div>

      {modal && (
        <Modal title={t('header.project.modalTitle')} onClose={closeModal} maxWidth={400}>
          <form onSubmit={createProject}>
            <div className="hdr-modal-field">
              <h4 className="hdr-modal-label">{t('header.project.nameLabel')}</h4>
              <input
                className="hdr-modal-input"
                placeholder={t('header.project.namePlaceholder')}
                value={newName}
                onChange={e => { setNewName(e.target.value); setErr(''); }}
                autoFocus
                maxLength={100}
              />
            </div>
            <div className="hdr-modal-field">
              <h4 className="hdr-modal-label">{t('header.project.urlLabel')}</h4>
              <input
                className="hdr-modal-input"
                placeholder={t('header.project.urlPlaceholder')}
                value={newUrl}
                onChange={e => { setNewUrl(e.target.value); setErr(''); }}
                autoComplete="off"
              />
            </div>
            {err && <span className="hdr-modal-err">{err}</span>}
            <button className="hdr-modal-submit" type="submit" disabled={saving || !newName.trim() || !isValidUrl(newUrl.trim())}>
              {saving ? t('header.form.creating') : t('header.form.create')}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ── User menu ── */
function UserMenu({ user, project }) {
  const navigate = useNavigate();
  const { t }    = useTranslation();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(null);
  const wrapRef = useRef(null);
  // Sliding indicator across the Settings / Pricing rows (follows hover).
  const { indRef, setItemRef } = DynamicBlock(hovered, open);

  useEffect(() => {
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const logout = async () => {
    // Wrap the fetch — if the server is down or the request is blocked,
    // we STILL want to navigate away (the user clicked Log out, they
    // expect SOMETHING to happen). Without the catch, an exception here
    // bubbles up and the navigation below never runs.
    try {
      await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.warn('Logout request failed; navigating anyway', e);
    }
    // Force a hard reload of /. The two-case dance is because assigning
    // `location.href = '/'` while already on / doesn't always trigger a
    // navigation in every browser — it can be treated as same-URL and
    // skipped. `reload()` guarantees the page re-mounts so /api/me runs
    // fresh and the header redraws with no user.
    if (window.location.pathname === '/') {
      window.location.reload();
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className="hdr-user" ref={wrapRef}>
      <button className="hdr-avatar-btn" onClick={() => setOpen(v => !v)} type="button" aria-label={t('header.userMenu.ariaLabel')}>
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
          <div className="hdr-um-dyn" onMouseLeave={() => setHovered(null)}>
            <div ref={indRef}
                 className={`hdr-sw-indicator${hovered === 'logout' ? ' hdr-sw-indicator--danger' : ''}`} />
            <button ref={setItemRef('settings')} className="hdr-drop-item"
                    onMouseEnter={() => setHovered('settings')}
                    onClick={() => { setOpen(false); navigate('/settings/account'); }} type="button">
              <GearSix className="hdr-drop-icon" /> {t('header.userMenu.settings')}
            </button>
            <button ref={setItemRef('pricing')} className="hdr-drop-item"
                    onMouseEnter={() => setHovered('pricing')}
                    onClick={() => { setOpen(false); navigate('/pricing'); }} type="button">
              <Tag className="hdr-drop-icon" /> {t('header.userMenu.pricing', { defaultValue: 'Pricing' })}
            </button>
            <button ref={setItemRef('logout')} className="hdr-drop-item hdr-drop-item--danger"
                    onMouseEnter={() => setHovered('logout')}
                    onClick={logout} type="button">
              <SignOut className="hdr-drop-icon" /> {t('header.userMenu.logout')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Product breadcrumb with dropdown ── */
function ProductSwitcherCrumb({ project, productContext }) {
  const navigate  = useNavigate();
  const { t }     = useTranslation();
  const [open,     setOpen]    = useState(false);
  const [products, setProducts] = useState([]);
  const [loaded,   setLoaded]  = useState(false);
  const [query,    setQuery]   = useState('');
  const [modal,    setModal]   = useState(false);
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

  const openModal  = () => { setOpen(false); setModal(true); };
  const closeModal = () => { setModal(false); };

  const handleCreated = (data) => {
    setModal(false);
    setLoaded(false);
    navigate(`/product/${encodeId(data.id)}`);
  };

  return (
    <>
      <div className="hdr-switcher" ref={wrapRef}>
        <div className="hdr-switcher-btn">
          <button className="hdr-switcher-name hdr-product-crumb" type="button"
            onClick={() => navigate(`/product/${productContext.hash}`)}>
            {productContext.name || t('header.product.fallbackName')}
          </button>
          <button className="hdr-switcher-arrow" type="button" aria-label={t('header.product.showProducts')}
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
                placeholder={t('header.product.searchPlaceholder')}
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            <div className="hdr-sw-items" ref={itemsEl}>
              <div className="hdr-sw-indicator"
                style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }} />
              {filtered.length === 0
                ? <span className="hdr-switcher-empty">{t('header.switcher.noResults')}</span>
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
              {t('header.product.allProducts')}
            </button>

            <div className="hdr-switcher-sep" />

            <button className="hdr-switcher-new" type="button" onClick={openModal}>
              <Plus className="hdr-switcher-new-icon" />
              {t('header.product.newProduct')}
            </button>
          </div>
        </div>
      </div>

      <CreateProductModal
        open={modal}
        pq={`?project_id=${project.id}`}
        onClose={closeModal}
        onCreated={handleCreated} />
    </>
  );
}

/* ── Landing nav tabs (Pricing + Docs) ──
   Hover-tracking Dynamic Block — same pattern as .auth-tab-* in the CRM.
   Indicator slides between tabs as the cursor moves; falls back to the
   active tab when the cursor leaves. The Docs tab carries `?from=landing`
   so the DocsLayout knows to render the landing-style Header (instead of
   the in-app one) when the user arrives from this nav. */
function HeaderLandingNav() {
  const { t }      = useTranslation();
  const navigate   = useNavigate();
  const location   = useLocation();
  const indRef     = useRef(null);
  const btnRefs    = useRef({});
  const [hovered, setHovered] = useState(null);

  const tabs = useMemo(() => [
    { key: 'pricing', label: t('header.nav.pricing'), to: '/pricing', Icon: Tag },
    // Query param routes Docs through DocsLayout's landing-header branch.
    { key: 'docs',    label: t('header.nav.docs'),    to: '/docs/getting-started?from=landing', Icon: BookOpen },
  ], [t]);

  // Which tab is "active" — match by pathname prefix.
  const activeKey = (() => {
    if (location.pathname.startsWith('/pricing')) return 'pricing';
    if (location.pathname.startsWith('/docs'))    return 'docs';
    return null;
  })();
  const curTab = hovered ?? activeKey;

  // Slide the indicator. Direct DOM mutation inside rAF — keeps the
  // sliding cheap and the indicator opacity at 0 until the first measure
  // so there's no flicker on first paint.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = curTab ? btnRefs.current[curTab] : null;
      if (!ind) return;
      if (!el) { ind.style.opacity = '0'; return; }
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curTab, activeKey]);

  return (
    <nav className="hdr-landing-nav" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="hdr-landing-nav-ind" />
      {tabs.map(({ key, label, to, Icon }) => (
        <button key={key}
          ref={el => { btnRefs.current[key] = el; }}
          /* `curTab === key` (not `activeKey`) so hovering also flips the
             text colour to accent — matches how .auth-tab in the CRM
             tracks the indicator AND the text simultaneously. */
          className={`hdr-landing-nav-tab${curTab === key ? ' hdr-landing-nav-tab--active' : ''}`}
          onMouseEnter={() => setHovered(key)}
          onClick={() => navigate(to)}
          type="button">
          <Icon className="hdr-landing-nav-icon" weight="bold" />
          {label}
        </button>
      ))}
    </nav>
  );
}

/* ── Settings gear → navigates to the /preferences page ── */
function HeaderSettingsButton() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <button className="hdr-settings-btn" onClick={() => navigate('/preferences')} type="button"
      aria-label={t('settings.preferences.title')}>
      <GearSix className="hdr-settings-icon" />
    </button>
  );
}

/* ── Header ── */
function Header({ user, project, org, productContext, settingsMode, docsMode, landing, onMobileNavToggle }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t }    = useTranslation();
  // The .crm-header--landing modifier centres the header inside a 1400px
  // column. That's right for the actual Landing page (the page content
  // sits in the same column underneath), but WRONG on /docs where the
  // page below uses the full-width Sidebar+Main layout — the centred
  // logo ends up misaligned with the sidebar's left edge. So on docs we
  // skip the modifier even when the landing prop is on.
  const landingWide = landing && !location.pathname.startsWith('/docs');
  // Hamburger button visible only on tablet/mobile (<1024px via CSS) — and
  // only inside layouts that have a sidebar to open. Landing has no sidebar.
  const showHamburger = !!onMobileNavToggle && !landing;
  return (
    <header className={`crm-header${landingWide ? ' crm-header--landing' : ''}`}>
      <div className="hdr-left">
        {showHamburger && (
          <button className="hdr-hamburger" onClick={onMobileNavToggle} type="button"
                  aria-label={t('header.openMenu', 'Open menu')}>
            <List className="hdr-hamburger-icon" weight="bold" />
          </button>
        )}
        <button className="hdr-brand" onClick={() => navigate(landing ? '/' : (user ? '/dashboard' : '/'))} type="button">
          <svg className="hdr-brand-logo" viewBox="0 0 3070 3070" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3061.91 1516.01C3065.95 1523.01 3067.97 1526.51 3068.76 1530.22C3069.46 1533.51 3069.46 1536.91 3068.76 1540.2C3067.97 1543.92 3065.95 1547.42 3061.91 1554.41L2316.09 2846.23C2312.05 2853.22 2310.03 2856.72 2307.2 2859.27C2304.7 2861.52 2301.76 2863.22 2298.56 2864.26C2294.94 2865.43 2290.91 2865.43 2282.83 2865.43H769.002C769.001 2865.43 768.999 2865.43 768.999 2865.43C768.998 2865.43 768.997 2865.42 768.998 2865.42L1503.75 1592.81C1514.66 1573.91 1520.12 1564.46 1519.3 1556.7C1518.59 1549.94 1515.04 1543.79 1509.54 1539.8C1503.23 1535.21 1492.32 1535.21 1470.49 1535.21H1.00289C1.00227 1535.21 1.00179 1535.21 1.00179 1535.21V1535.21C1.00179 1535.22 1.00064 1535.22 1.00015 1535.22C0.999961 1535.22 0.99995 1535.21 1.00012 1535.21L757.915 224.2C761.953 217.205 763.972 213.708 766.797 211.165C769.297 208.914 772.241 207.214 775.44 206.175C779.055 205 783.093 205 791.17 205H2282.83C2290.91 205 2294.94 205 2298.56 206.175C2301.76 207.214 2304.7 208.914 2307.2 211.165C2310.03 213.708 2312.05 217.205 2316.08 224.2L3061.91 1516.01Z" fill="currentColor"/>
          </svg>
        </button>
        {/* Landing nav sits right next to the brand on the left — easier
            to scan than a centered nav floating mid-header. */}
        {landing && <HeaderLandingNav />}
        {/* Settings pages: show static "Settings" breadcrumb */}
        {settingsMode && (
          <>
            <span className="hdr-sep">/</span>
            <span className="hdr-settings-crumb">{t('nav.settings')}</span>
          </>
        )}
        {/* Docs pages: show static "Docs" breadcrumb */}
        {docsMode && (
          <>
            <span className="hdr-sep">/</span>
            <span className="hdr-settings-crumb">{t('docs.title')}</span>
          </>
        )}
        {/* Org-level pages: show org switcher */}
        {!settingsMode && org && !project && (
          <>
            <span className="hdr-sep">/</span>
            <OrgSwitcher org={org} />
          </>
        )}
        {/* Project-level pages: show org switcher + project switcher */}
        {!settingsMode && project && (
          <>
            <span className="hdr-sep">/</span>
            <OrgSwitcher project={project} />
            <span className="hdr-sep">/</span>
            <ProjectSwitcher project={project} />
          </>
        )}
        {/* Product page: show product switcher as 4th breadcrumb level */}
        {!settingsMode && project && productContext && (
          <>
            <span className="hdr-sep">/</span>
            <ProductSwitcherCrumb project={project} productContext={productContext} />
          </>
        )}
      </div>
      <div className="hdr-right">
        {landing ? (
          <>
            {/* Logged-out: settings gear (language + theme) + friendly CTA. */}
            {!user && <HeaderSettingsButton />}
            {!user && (
              <button className="hdr-cta-btn" onClick={() => navigate('/login')} type="button">
                {t('auth.home.getStarted')}
              </button>
            )}
            {/* Logged-in: just the Dashboard button + avatar (Supabase-style). */}
            {user && (
              <button className="hdr-cta-btn" onClick={() => navigate('/dashboard')} type="button">
                {t('auth.home.dashboard')}
              </button>
            )}
            {user && <UserMenu user={user} project={project} />}
          </>
        ) : (
          <>
            {user && !docsMode && (
              <button className="hdr-docs-btn" onClick={() => navigate('/docs')} type="button">
                <BookOpen className="hdr-docs-icon" weight="bold" />
                <span className="hdr-docs-label">{t('docs.title')}</span>
              </button>
            )}
            {user && <NotificationsBell />}
            {user && <UserMenu user={user} project={project} />}
          </>
        )}
      </div>
    </header>
  );
}

export default Header;
