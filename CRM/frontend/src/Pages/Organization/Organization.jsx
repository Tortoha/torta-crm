import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus, MagnifyingGlass, SquaresFour, List,
  DotsThreeOutline, PencilSimple, Copy, Gear, Trash,
  ArrowDown, SmileyMelting, Info,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import { DynamicBlock } from '../../Utils/DynamicBlock.js';
import Modal from '../../Elements/Modal.jsx';
import '../../Style/Organization.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isValidUrl = url => {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
};

const fmtDate = iso => iso
  ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—';

// ─── Tilt configs ─────────────────────────────────────────────────────────────

const TILT = {
  maxAngle: 18, lerp: 0.05, lerpOut: 0.07,
  scale: 1.05, perspective: 700,
  gloss: { opacity: 0.18, spread: 60 },
};

const ROW_TILT = {
  maxAngleX: 10, maxAngleY: 4, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.14, spread: 40 },
};

// ─── SortToggle ──────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { field: 'name', labelKey: 'org.projects.sortByName' },
  { field: 'date', labelKey: 'org.projects.sortByDate' },
];

function SortToggle({ sort, onSort }) {
  const { t } = useTranslation();
  const indRef       = useRef(null);
  const btnRefs      = useRef({});
  const [hovered, setHovered] = useState(null);

  const curField = hovered ?? sort.field;

  // Indicator follows hover, falls back to active. Re-measure when sort.field changes
  // (active button gains/loses arrow → width changes)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[curField];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curField, sort.field]);

  const DEFAULT_DIR = { name: 'asc', date: 'desc' };

  const handleClick = field => {
    onSort(prev => ({
      field,
      dir: field === prev.field ? (prev.dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[field] ?? 'asc',
    }));
  };

  return (
    <div className="org-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {SORT_OPTIONS.map(({ field, labelKey }) => {
        const active = sort.field === field;
        const isCur  = curField === field;
        return (
          <button key={field} ref={el => { btnRefs.current[field] = el; }}
            className={`org-sort-btn${isCur ? ' org-sort-btn--current' : ''}`}
            style={active ? { paddingLeft: '6px' } : undefined}
            onMouseEnter={() => setHovered(field)}
            onClick={() => handleClick(field)} type="button">
            {active && (
              <ArrowDown className="org-sort-icon"
                style={{ transform: sort.dir === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            )}
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}

// ─── Menu items ───────────────────────────────────────────────────────────────

const MENU_ITEMS = [
  { key: 'rename',   Icon: PencilSimple, labelKey: 'org.projects.menu.rename' },
  { key: 'copy',     Icon: Copy,         labelKey: 'org.projects.menu.copyKey' },
  { key: 'settings', Icon: Gear,         labelKey: 'org.projects.menu.settings' },
];

// ─── CardMenu ─────────────────────────────────────────────────────────────────

function CardMenu({ project, btnRef, onClose, onRename, onDelete }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [pos, setPos]         = useState(null);
  const [hovered, setHovered] = useState(null);
  const { indRef, setItemRef } = DynamicBlock(hovered);

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

  const actions = {
    rename:   onRename,
    copy:     () => { navigator.clipboard.writeText(project.api_key); onClose(); },
    settings: () => { navigate(`/project/${project.api_key}/settings`); onClose(); },
  };

  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>

      <div className="org-menu-block" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef} className="org-menu-indicator" />
        {MENU_ITEMS.map(({ key, Icon, labelKey }) => (
          <button key={key} ref={setItemRef(key)}
            className={`org-card-dropdown-item org-menu-item${hovered === key ? ' org-menu-item--current' : ''}`}
            onMouseEnter={() => setHovered(key)} onClick={actions[key]}>
            <Icon className="org-card-dropdown-icon" /> {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger" onClick={onDelete}>
        <Trash className="org-card-dropdown-icon" /> {t('org.projects.menu.delete')}
      </button>
    </div>,
    document.body
  );
}

// ─── ProjectCard ──────────────────────────────────────────────────────────────

function ProjectCard({ p, onRename, onDelete, canManage }) {
  const { t } = useTranslation();
  const menuBtnRef = useRef(null);
  const navigate   = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(TILT, menuOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  return (
    <div ref={ref} className="org-card org-card--tilt"
      onClick={() => navigate(`/project/${p.api_key}`)} {...handlers}>
      <div ref={glossRef} className="org-card-gloss" />
      <div className="org-card-inner">
        {canManage && (
          <button ref={menuBtnRef} className="org-card-menu-btn" type="button" aria-label={t('org.projects.options')}
            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
            <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
          </button>
        )}
        <div className="org-card-name">{p.name}</div>
        <div className="org-card-meta">{p.api_key.slice(0, 16)}…</div>
        <span className={`org-card-badge${p.is_active ? '' : ' org-card-badge--inactive'}`}>
          {p.is_active ? t('org.projects.active') : t('org.projects.inactive')}
        </span>
      </div>
      {canManage && menuOpen && (
        <CardMenu project={p} btnRef={menuBtnRef} onClose={() => setMenuOpen(false)}
          onRename={() => { setMenuOpen(false); onRename(p); }}
          onDelete={() => { setMenuOpen(false); onDelete(p.id); }} />
      )}
    </div>
  );
}

// ─── ListRow ──────────────────────────────────────────────────────────────────

function ListRow({ p, onRename, onDelete, canManage }) {
  const { t } = useTranslation();
  const menuBtnRef = useRef(null);
  const navigate   = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, menuOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  return (
    <div ref={ref} className={`org-list-row${menuOpen ? ' org-list-row--frozen' : ''}`}
      onClick={() => navigate(`/project/${p.api_key}`)} {...handlers}>
      <div ref={glossRef} className="org-list-gloss" />
      <span className="org-list-name">{p.name}</span>
      <span className="org-list-key">{p.api_key.slice(0, 16)}…</span>
      <span className="org-list-status-cell">
        <span className={`org-card-badge${p.is_active ? '' : ' org-card-badge--inactive'}`}>
          {p.is_active ? t('org.projects.active') : t('org.projects.inactive')}
        </span>
      </span>
      <span className="org-list-created">{fmtDate(p.created_at)}</span>
      {canManage && (
        <button ref={menuBtnRef} className="org-list-menu-btn" type="button" aria-label={t('org.projects.options')}
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
          <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
        </button>
      )}
      {canManage && menuOpen && (
        <CardMenu project={p} btnRef={menuBtnRef} onClose={() => setMenuOpen(false)}
          onRename={() => { setMenuOpen(false); onRename(p); }}
          onDelete={() => { setMenuOpen(false); onDelete(p.id); }} />
      )}
    </div>
  );
}

// ─── RenameModal ──────────────────────────────────────────────────────────────

function RenameModal({ project, onClose, onSaved }) {
  const { t } = useTranslation();
  const [name,   setName]   = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const handleSubmit = async e => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setErr(t('org.projects.nameRequired'));
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/projects/${project.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) return setErr(data.detail || t('org.projects.error'));
      onSaved({ ...project, name: trimmed }); onClose();
    } catch { setErr(t('common.networkError')); }
    finally   { setSaving(false); }
  };

  return (
    <Modal title={t('org.projects.rename.title')} onClose={onClose} maxWidth={400}>
      <form onSubmit={handleSubmit}>
        <div className="hdr-modal-field">
          <h4 className="hdr-modal-label">{t('org.projects.rename.nameLabel')}</h4>
          <input className="hdr-modal-input" value={name} autoFocus maxLength={100}
            onChange={e => { setName(e.target.value); setErr(''); }} />
        </div>
        {err && <span className="hdr-modal-err">{err}</span>}
        <button className="hdr-modal-submit" type="submit" disabled={saving || !name.trim()}>
          {saving ? t('org.projects.rename.saving') : t('common.save')}
        </button>
      </form>
    </Modal>
  );
}

// ─── CreateProjectModal ───────────────────────────────────────────────────────

function CreateProjectModal({ orgId, onClose, onCreated }) {
  const { t } = useTranslation();
  const [name,   setName]   = useState('');
  const [url,    setUrl]    = useState('');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const handleSubmit = async e => {
    e.preventDefault();
    const trimName = name.trim(), trimUrl = url.trim();
    if (!trimName)                       return setErr(t('org.projects.nameRequired'));
    // Frontend URL is optional — only validate it when the merchant entered one.
    if (trimUrl && !isValidUrl(trimUrl)) return setErr(t('org.projects.create.invalidUrl'));
    setSaving(true); setErr('');
    try {
      // Send merchant's browser TZ so booking_settings.timezone seeds correctly
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const res  = await fetch(`${API_BASE}/api/orgs/${orgId}/projects`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimName, frontend_url: trimUrl, timezone: browserTz }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 402 plan-limit → global PlanLimitModal handles it; never render the
        // structured detail OBJECT inline (React #31 → white screen).
        if (res.status !== 402) {
          const d = data && data.detail;
          setErr(typeof d === 'string' ? d : t('org.projects.error'));
        }
        return;
      }
      onCreated(data); onClose();
    } catch { setErr(t('common.networkError')); }
    finally   { setSaving(false); }
  };

  return (
    <Modal title={t('org.projects.create.title')} onClose={onClose} maxWidth={400}>
      <form onSubmit={handleSubmit}>
        <div className="hdr-modal-field">
          <h4 className="hdr-modal-label">{t('org.projects.create.nameLabel')}</h4>
          <input className="hdr-modal-input" placeholder={t('org.projects.create.namePlaceholder')} autoFocus maxLength={100}
            value={name} onChange={e => { setName(e.target.value); setErr(''); }} />
        </div>
        <div className="hdr-modal-field">
          <h4 className="hdr-modal-label">{t('org.projects.create.urlLabel')}</h4>
          <input className="hdr-modal-input" placeholder={t('org.projects.create.urlPlaceholder')} autoComplete="off"
            value={url} onChange={e => { setUrl(e.target.value); setErr(''); }} />
        </div>
        {err && <span className="hdr-modal-err">{err}</span>}
        <button className="hdr-modal-submit" type="submit"
          disabled={saving || !name.trim() || (!!url.trim() && !isValidUrl(url.trim()))}>
          {saving ? t('org.projects.create.creating') : t('org.projects.create.create')}
        </button>
      </form>
    </Modal>
  );
}

// ─── Organization ─────────────────────────────────────────────────────────────

function Organization() {
  const { t } = useTranslation();
  const { org } = useOutletContext();
  const isOwner = !!org?.is_owner;   // members see a read-only project list (no create/rename/delete)
  const navigate = useNavigate();

  const [projects,  setProjects]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(false);
  const [renaming,  setRenaming]  = useState(null);
  const [search,    setSearch]    = useState('');
  const [view,      setView]      = useState('grid');
  const [viewHover, setViewHover] = useState(null);
  const [sort,      setSort]      = useState({ field: 'name', dir: 'asc' });
  const settingsLoadedRef = useRef(false);

  // Load preferences from DB (view + sort)
  useEffect(() => {
    fetch(`${API_BASE}/api/settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.org_view === 'list' || data?.org_view === 'grid') setView(data.org_view);
        if (data?.org_sort) {
          const [field, dir] = data.org_sort.split('_');
          if (field && dir) setSort({ field, dir });
        }
        settingsLoadedRef.current = true;
      })
      .catch(() => { settingsLoadedRef.current = true; });
  }, []);

  // Save preference to DB
  const saveSettings = patch => {
    if (!settingsLoadedRef.current) return;
    fetch(`${API_BASE}/api/settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {});
  };

  const handleSetView = v => {
    setView(v);
    saveSettings({ org_view: v });
  };

  const handleSetSort = updater => {
    setSort(prev => {
      const next = updater(prev);
      saveSettings({ org_sort: `${next.field}_${next.dir}` });
      return next;
    });
  };

  useEffect(() => {
    if (!org) return;
    fetch(`${API_BASE}/api/orgs/${org.id}/projects`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setProjects(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [org]);

  const handleDelete = async id => {
    if (!window.confirm(t('org.projects.deleteConfirm'))) return;
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

  const sorted = [...filtered].sort((a, b) => {
    if (sort.field === 'name') {
      const cmp = a.name.localeCompare(b.name);
      return sort.dir === 'asc' ? cmp : -cmp;
    }
    const da = new Date(a.created_at || 0), db = new Date(b.created_at || 0);
    return sort.dir === 'asc' ? da - db : db - da;
  });

  const curView  = viewHover ?? view;

  return (
    <>
      <h1 className="crm-page-title org-page-title">
        {t('org.projects.title')}
        <span className="org-title-info">
          <Info className="org-title-info-icon" weight="regular" />
          <span className="org-title-tip">
            <span className="org-title-tip-inner">
              <span className="org-title-tip-title">{t('org.projects.info.title')}</span>
              <span className="org-title-tip-p">{t('org.projects.info.p1')}</span>
              <span className="org-title-tip-p">{t('org.projects.info.p2')}</span>
              <span className="org-title-tip-p">{t('org.projects.info.p3')}</span>
            </span>
          </span>
        </span>
      </h1>

      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder={t('org.projects.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <SortToggle sort={sort} onSort={handleSetSort} />

        <div className="org-view-toggle" onMouseLeave={() => setViewHover(null)}>
          <div className="org-view-indicator"
            style={{ transform: `translateX(${curView === 'list' ? 30 : 0}px)` }} />
          <button className={`org-view-btn${curView === 'grid' ? ' org-view-btn--current' : ''}`}
            onClick={() => handleSetView('grid')} onMouseEnter={() => setViewHover('grid')}
            title={t('org.projects.gridView')} type="button">
            <SquaresFour className="org-view-icon" />
          </button>
          <button className={`org-view-btn${curView === 'list' ? ' org-view-btn--current' : ''}`}
            onClick={() => handleSetView('list')} onMouseEnter={() => setViewHover('list')}
            title={t('org.projects.listView')} type="button">
            <List className="org-view-icon" />
          </button>
        </div>

        {isOwner && (
          <button className="org-new-btn" onClick={() => setModal(true)} type="button">
            <Plus className="org-new-icon" /> {t('org.projects.newProject')}
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        projects.length === 0 ? (
          <div className="org-empty">
            <div className="org-empty-icon"><SmileyMelting size={32} weight="regular" /></div>
            <h2 className="org-empty-title">{t('org.projects.emptyTitle')}</h2>
            <p className="org-empty-text">
              {isOwner ? t('org.projects.emptyText') : t('org.projects.emptyMember')}
            </p>
            {isOwner && (
              <button className="org-new-btn" onClick={() => setModal(true)} type="button">
                <Plus className="org-new-icon" /> {t('org.projects.emptyCreate')}
              </button>
            )}
          </div>
        ) : (
          <div className="crm-placeholder">{t('org.projects.noResults')}</div>
        )
      ) : view === 'grid' ? (
        <div className="org-grid">
          {sorted.map(p => (
            <ProjectCard key={p.id} p={p} onRename={setRenaming} onDelete={handleDelete} canManage={isOwner} />
          ))}
        </div>
      ) : (
        <div className="org-list">
          <div className="org-list-head">
            <span className="org-list-th">{t('org.projects.table.project')}</span>
            <span className="org-list-th">{t('org.projects.table.publicKey')}</span>
            <span className="org-list-th">{t('org.projects.table.status')}</span>
            <span className="org-list-th">{t('org.projects.table.created')}</span>
            <span />
          </div>
          <div className="org-list-block">
            {sorted.map(p => (
              <ListRow key={p.id} p={p} onRename={setRenaming} onDelete={handleDelete} canManage={isOwner} />
            ))}
          </div>
        </div>
      )}

      {modal    && <CreateProjectModal orgId={org.id} onClose={() => setModal(false)}
                     onCreated={data => navigate(`/project/${data.api_key}`)} />}
      {renaming && <RenameModal project={renaming} onClose={() => setRenaming(null)}
                     onSaved={u => setProjects(prev => prev.map(p => p.id === u.id ? u : p))} />}
    </>
  );
}

export default Organization
