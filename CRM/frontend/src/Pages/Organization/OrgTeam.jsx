// Organization Team — org-level RBAC management (owner only).
// Three tabs (Members / Roles / Invites) with a Products-style TabSwitcher and
// Targets-style tabular lists (po-set-table + PoListRow tilt rows + portal
// 3-dot menus). The backend (require_org_owner) is the source of truth; this
// page just drives it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  UsersThree, ShieldCheck, Plus, X, Trash, Copy,
  PencilSimple, CaretRight, DotsThreeOutline,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import { SearchableCombobox, SegmentSwitch } from '../Project/ProjectSettings.jsx';
import '../../Style/Authentication.css';   // auth-tab-* switcher + auth-modal
import '../../Style/Organization.css';      // org-toolbar / org-new-btn / org-card-dropdown
import '../../Style/Products.css';           // po-set-table / po-set-row / po-block-hint
import '../../Style/OrgTeam.css';

// Human labels for the permission-matrix rows live in the `org.pages.*`
// translation namespace. Backend ships the authoritative `pages` list, so a
// new page shows up automatically (t() falls back to the raw key).
const pageLabel = (t, pg) => t(`org.pages.${pg}`, { defaultValue: pg });

// Visual grouping for the permission matrix (29 pages is a lot in one flat
// list). Each group renders a small sub-header; only keys the backend actually
// ships in `pages` are shown, so a future catalog change doesn't break this.
const PAGE_GROUPS = [
  { key: 'general',       keys: ['overview'] },
  { key: 'products',      keys: ['products', 'inventory', 'batches', 'promo_codes', 'discounts', 'tier_pricing', 'warehouses', 'archive', 'product_settings'] },
  { key: 'sales',         keys: ['orders', 'returns', 'customers', 'org_customers'] },
  { key: 'booking',       keys: ['booking', 'booking_services', 'booking_staff', 'booking_settings'] },
  { key: 'engagement',    keys: ['chat', 'channels', 'emails', 'analytics', 'alerts', 'goals'] },
  { key: 'configuration', keys: ['auth_providers', 'url_config', 'integrations', 'documents', 'settings', 'api'] },
];
const LEVELS = [
  { value: 'none',   labelKey: 'org.team.levels.none'   },
  { value: 'view',   labelKey: 'org.team.levels.view'   },
  { value: 'manage', labelKey: 'org.team.levels.manage' },
];

function Avatar({ name, email, url, size = 30 }) {
  const seed = name || email || '?';
  const initials = seed.split(/[\s@.]+/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('');
  const palette = ['#0071E3', '#8b5cf6', '#06b6d4', '#f97316', '#f43f5e', '#d946ef', '#10b981'];
  const bg = palette[(seed.charCodeAt(0) || 0) % palette.length];
  if (url) return <img className="ot-avatar" src={url} alt="" style={{ width: size, height: size }} />;
  return <div className="ot-avatar ot-avatar--initials" style={{ width: size, height: size, background: bg }}>{initials}</div>;
}

// 3-way None/View/Manage segment for the matrix. Uses the shared SegmentSwitch
// (same Dynamic Block sliding pill as Project Settings) for a consistent look.
function LevelPicker({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <SegmentSwitch
      value={value || 'none'}
      options={LEVELS.map(l => ({ value: l.value, label: t(l.labelKey) }))}
      onChange={onChange} />
  );
}

// ── Tab switcher — centered pill, copied from Products/Authentication ──
function TabSwitcher({ tabs, activeKey, onPick }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curKey = hovered ?? activeKey;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[curKey];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curKey, activeKey]);

  return (
    <div className="auth-tab-wrapper">
      <div className="auth-tab-switcher" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef} className="auth-tab-indicator" />
        {tabs.map(({ key, label, Icon, badge }) => (
          <button key={key}
            ref={el => { btnRefs.current[key] = el; }}
            className={`auth-tab-btn${curKey === key ? ' auth-tab-btn--active' : ''}`}
            onMouseEnter={() => setHovered(key)}
            onClick={() => onPick(key)}
            type="button">
            <Icon className="auth-tab-icon" />
            {label}
            {badge > 0 && <span className="ot-tab-badge">{badge}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Portal 3-dot menu — same org-card-dropdown pattern as Targets ──
function RowMenu({ btnRef, onClose, items }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 184) });
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onPd  = (e) => {
      if (!e.target.closest?.('.org-card-dropdown') && !btnRef.current?.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [btnRef, onClose]);
  if (!pos) return null;
  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => it.sep ? (
        <div key={i} className="org-card-dropdown-sep" />
      ) : (
        <button key={i}
          className={`org-card-dropdown-item${it.danger ? ' org-card-dropdown-item--danger' : ''}`}
          onClick={() => { onClose(); it.onClick(); }}>
          <it.Icon className="org-card-dropdown-icon" /> {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ── Table rows ─────────────────────────────────────────────────────────
function MemberRow({ m, onManage, onRemove }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef(null);
  const assigns = m.assignments || [];
  return (
    <PoListRow className="po-set-row--otm" frozen={menuOpen}>
      <span className="ot-id-cell">
        <Avatar name={m.name} email={m.email} url={m.avatar_url} size={30} />
        <span className="po-set-strong ot-ellipsis">{m.name || m.email}</span>
        {m.is_me && <span className="crm-badge crm-badge--light ot-you-badge">{t('org.team.members.you')}</span>}
      </span>
      <span className="ot-muted ot-ellipsis">{m.email}</span>
      <span style={{ minWidth: 0 }}>
        {m.is_owner ? <span className="ot-access-full">{t('org.team.members.fullAccess')}</span>
          : assigns.length === 0 ? <span className="ot-access-none">{t('org.team.members.noProjectAccess')}</span>
          : <span className="ot-chips">
              {assigns.map(a => <span className="ot-chip" key={a.project_id}>{a.project_name}: <b>{a.role_name || '—'}</b></span>)}
            </span>}
      </span>
      {m.is_owner ? <span /> : (
        <button ref={btnRef} type="button" className="org-list-menu-btn" aria-label={t('org.team.options')}
          onClick={() => setMenuOpen(v => !v)}>
          <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
        </button>
      )}
      {menuOpen && (
        <RowMenu btnRef={btnRef} onClose={() => setMenuOpen(false)} items={[
          { Icon: CaretRight, label: t('org.team.members.manageAccess'), onClick: onManage },
          { sep: true },
          { Icon: Trash, label: t('org.team.members.remove'), danger: true, onClick: onRemove },
        ]} />
      )}
    </PoListRow>
  );
}

function RoleRow({ r, pagesCount, onEdit, onDelete }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef(null);
  const granted = Object.keys(r.permissions || {}).length;
  return (
    <PoListRow className="po-set-row--otr" frozen={menuOpen}
      onClick={onEdit} style={{ cursor: 'pointer' }}>
      <span className="po-set-strong ot-ellipsis">{r.name}</span>
      <span className="ot-muted">{t('org.team.roles.pagesGranted', { granted, total: pagesCount })}</span>
      <span>
        {r.is_preset
          ? <span className="crm-badge crm-badge--gray">{t('org.team.roles.preset')}</span>
          : <span className="crm-badge crm-badge--light">{t('org.team.roles.custom')}</span>}
      </span>
      <button ref={btnRef} type="button" className="org-list-menu-btn" aria-label={t('org.team.options')}
        onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <RowMenu btnRef={btnRef} onClose={() => setMenuOpen(false)} items={[
          { Icon: PencilSimple, label: t('org.team.roles.edit'), onClick: onEdit },
          ...(r.is_preset ? [] : [{ sep: true }, { Icon: Trash, label: t('org.team.roles.delete'), danger: true, onClick: onDelete }]),
        ]} />
      )}
    </PoListRow>
  );
}

// ── Role create/edit modal — name + permission matrix ──
function RoleEditorModal({ orgId, pages, role, onClose, onSaved, showToast }) {
  const { t } = useTranslation();
  const editing = !!role;
  const [name, setName] = useState(role?.name || '');
  const [perms, setPerms] = useState(() => ({ ...(role?.permissions || {}) }));
  const [err, setErr] = useState('');
  const roleIdRef   = useRef(role?.id || null);   // becomes set after the first create
  const creatingRef = useRef(false);              // guards against a duplicate POST

  const setLevel = (page, level) => setPerms(p => {
    const next = { ...p };
    if (level === 'none') delete next[page];
    else next[page] = level;
    return next;
  });
  const setAll = (level) => setPerms(() => level === 'none' ? {} : Object.fromEntries(pages.map(pg => [pg, level])));

  // Save-on-change: a debounced PUT for an existing role, or a POST the first
  // time a name is entered for a brand-new role (after which we switch to PUT).
  // No Save button — name edits and permission toggles persist automatically,
  // mirroring the per-project access modal.
  const persist = useCallback(async (nm, pm) => {
    const name2 = (nm || '').trim();
    if (!name2) return;                          // can't create/rename to empty
    const id = roleIdRef.current;
    if (!id && creatingRef.current) return;      // a create POST is already in flight
    if (!id) creatingRef.current = true;
    setErr('');
    try {
      const url = id
        ? `${API_BASE}/api/orgs/${orgId}/roles/${id}`
        : `${API_BASE}/api/orgs/${orgId}/roles`;
      const r = await fetch(url, {
        method: id ? 'PUT' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name2, permissions: pm }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.detail || t('org.team.roleEditor.saveFailed'));
        return;
      }
      if (!id) { const j = await r.json().catch(() => ({})); if (j?.id) roleIdRef.current = j.id; }
      showToast(t('common.saved'));
      onSaved();
    } finally {
      if (!id) creatingRef.current = false;
    }
  }, [orgId, onSaved, showToast, t]);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const timer = setTimeout(() => persist(name, perms), 500);
    return () => clearTimeout(timer);
  }, [name, perms, persist]);

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal ot-role-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{editing ? t('org.team.roleEditor.editTitle') : t('org.team.roleEditor.newTitle')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {editing
                    ? t('org.team.roleEditor.editSubtitle', { name: role.name })
                    : t('org.team.roleEditor.newSubtitle')}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body">
          <form className="cpm-form" onSubmit={(e) => e.preventDefault()} autoComplete="off">
            <div className="cpm-section">
              <label className="po-field-label">{t('org.team.roleEditor.nameLabel')}</label>
              <input className="crm-input" autoFocus maxLength={60}
                placeholder={t('org.team.roleEditor.namePlaceholder')}
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="cpm-section">
              <div className="ot-matrix-head">
                <label className="po-field-label" style={{ padding: 0 }}>{t('org.team.roleEditor.pageAccess')}</label>
                <div className="ot-matrix-bulk">
                  <button type="button" onClick={() => setAll('none')}>{t('org.team.roleEditor.clearAll')}</button>
                  <button type="button" onClick={() => setAll('view')}>{t('org.team.roleEditor.allView')}</button>
                  <button type="button" onClick={() => setAll('manage')}>{t('org.team.roleEditor.allManage')}</button>
                </div>
              </div>
              <div className="ot-matrix">
                {PAGE_GROUPS.map(group => {
                  const keys = group.keys.filter(k => pages.includes(k));
                  if (keys.length === 0) return null;
                  return (
                    <div className="ot-matrix-group" key={group.key}>
                      <div className="ot-matrix-group-label">{t(`org.pageGroups.${group.key}`)}</div>
                      {keys.map(pg => (
                        <div className="ot-matrix-row" key={pg}>
                          <span className="ot-matrix-label">{pageLabel(t, pg)}</span>
                          <LevelPicker value={perms[pg]} onChange={(l) => setLevel(pg, l)} />
                        </div>
                      ))}
                    </div>
                  );
                })}
                {pages.filter(p => !PAGE_GROUPS.some(g => g.keys.includes(p))).map(pg => (
                  <div className="ot-matrix-row" key={pg}>
                    <span className="ot-matrix-label">{pageLabel(t, pg)}</span>
                    <LevelPicker value={perms[pg]} onChange={(l) => setLevel(pg, l)} />
                  </div>
                ))}
              </div>
            </div>
            <p className="cpm-section-hint">{t('org.team.roleEditor.autosaveHint')}</p>
            {err && <p className="auth-msg auth-msg--err">{err}</p>}
            <div className="auth-actions">
              <button className="crm-submit-btn" type="button" onClick={onClose}>
                {t('org.team.roleEditor.done')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Add member modal — share a single reusable invite link ──
function AddMemberModal({ orgId, onClose, showToast }) {
  const { t } = useTranslation();
  const [link, setLink] = useState('');                    // reusable org share link
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/orgs/${orgId}/invite-link`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.url) setLink(j.url); })
      .catch(() => {});
  }, [orgId]);

  const resetLink = async () => {
    if (!window.confirm(t('org.team.addMember.resetConfirm'))) return;
    setResetting(true);
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/invite-link/reset`, { method: 'POST', credentials: 'include' });
    setResetting(false);
    if (r.ok) { const j = await r.json(); setLink(j.url); showToast(t('org.team.addMember.linkReset')); }
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{t('org.team.addMember.title')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {t('org.team.addMember.subtitlePre')}<b>{t('org.team.addMember.subtitleBold')}</b>{t('org.team.addMember.subtitlePost')}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body">
          <div className="cpm-form">
            <div className="cpm-section">
              <label className="po-field-label">{t('org.team.addMember.inviteLink')}</label>
              <div className="ot-invite-link">
                <code>{link || t('org.team.addMember.generating')}</code>
                <button type="button" className="crm-icon-btn" title={t('org.team.addMember.copyLink')} disabled={!link}
                  onClick={() => { navigator.clipboard?.writeText(link); showToast(t('org.team.addMember.copied')); }}>
                  <Copy className="crm-icon" />
                </button>
              </div>
              <span className="cpm-section-hint">
                {t('org.team.addMember.shareHint')}
                <button type="button" className="ot-link-reset" onClick={resetLink} disabled={resetting}>
                  {t('org.team.addMember.resetLink')}
                </button>
              </span>
            </div>
          </div>
          <div className="auth-actions">
            <button className="crm-submit-btn" type="button" onClick={onClose}>
              {t('org.team.addMember.done')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Member access (per-project role assignment) modal ──
function AssignmentModal({ orgId, member, projects, roles, onClose, onSaved, showToast }) {
  const { t } = useTranslation();
  const initial = useMemo(() => {
    const m = {};
    (member.assignments || []).forEach(a => { m[a.project_id] = a.role_id; });
    return m;
  }, [member]);
  const [assign, setAssign] = useState(initial);

  const change = async (projectId, roleId) => {
    setAssign(prev => ({ ...prev, [projectId]: roleId }));
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/members/${member.id}/assignment`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, role_id: roleId || null }),
    });
    if (r.ok) { showToast(t('common.saved')); onSaved(); }
    else      { showToast(t('common.saveFailed')); }
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{t('org.team.assignment.title')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {t('org.team.assignment.subtitle', { name: member.name || member.email })}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body">
          <div className="ot-assign-list">
            {projects.length === 0 && <div className="crm-placeholder">{t('org.team.assignment.noProjects')}</div>}
            {projects.map(p => (
              <div className="ot-assign-row" key={p.id}>
                <span className="ot-assign-project">{p.name}</span>
                <div className="ot-assign-select">
                  <SearchableCombobox
                    value={assign[p.id] || 0}
                    options={[
                      { value: 0, label: t('org.team.assignment.noAccess') },
                      ...roles.map(r => ({ value: r.id, label: r.name })),
                    ]}
                    onChange={(v) => change(p.id, Number(v) || 0)}
                    searchPlaceholder={t('common.search')} />
                </div>
              </div>
            ))}
          </div>
          <div className="auth-actions">
            <button className="crm-submit-btn" type="button" onClick={onClose}>{t('org.team.assignment.done')}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function OrgTeam() {
  const { t } = useTranslation();
  const { org } = useOutletContext();
  const orgId = org?.id;

  const [tab, setTab] = useState('members');
  const [members, setMembers] = useState([]);
  const [roles, setRoles]     = useState([]);
  const [pages, setPages]     = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const [addOpen, setAddOpen]     = useState(false);
  const [roleModal, setRoleModal] = useState(null);
  const [assignFor, setAssignFor] = useState(null);

  const [toast, setToast] = useState('');
  const tref = useRef(null);
  const showToast = useCallback((m) => {
    setToast(m);
    if (tref.current) clearTimeout(tref.current);
    tref.current = setTimeout(() => setToast(''), 2400);
  }, []);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true); setError('');
    const getJSON = async (url, fallback) => {
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (r.status === 403) return { _forbidden: true };
        if (!r.ok) return fallback;
        return await r.json();
      } catch { return fallback; }
    };
    try {
      const [m, r, p] = await Promise.all([
        getJSON(`${API_BASE}/api/orgs/${orgId}/members`,  []),
        getJSON(`${API_BASE}/api/orgs/${orgId}/roles`,    {}),
        getJSON(`${API_BASE}/api/orgs/${orgId}/projects`, []),
      ]);
      if (m && m._forbidden) { setError(t('org.team.forbidden')); return; }
      setMembers(Array.isArray(m) ? m : []);
      setRoles(Array.isArray(r?.roles) ? r.roles : []);
      setPages(Array.isArray(r?.pages) ? r.pages : []);
      setProjects(Array.isArray(p) ? p : []);
    } finally { setLoading(false); }
  }, [orgId, t]);

  useEffect(() => { load(); }, [load]);

  const removeMember = async (m) => {
    if (!window.confirm(t('org.team.members.removeConfirm', { name: m.name || m.email }))) return;
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/members/${m.id}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) { showToast(t('org.team.members.removed')); load(); } else showToast(t('org.team.members.failed'));
  };
  const deleteRole = async (role) => {
    if (!window.confirm(t('org.team.roles.deleteConfirm', { name: role.name }))) return;
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/roles/${role.id}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) { showToast(t('org.team.roles.deleted')); load(); }
    else { const j = await r.json().catch(() => ({})); showToast(j.detail || t('org.team.roles.failed')); }
  };
  const TABS = [
    { key: 'members', label: t('org.team.tabs.members'), Icon: UsersThree },
    { key: 'roles',   label: t('org.team.tabs.roles'),   Icon: ShieldCheck },
  ];

  return (
    <div className="prod-page-wrap">
      <TabSwitcher tabs={TABS} activeKey={tab} onPick={setTab} />
      <h1 className="crm-page-title">{t('org.team.title')}</h1>

      {error ? (
        <div className="crm-placeholder" style={{ marginTop: 24 }}>{error}</div>
      ) : loading ? (
        <div className="crm-placeholder" style={{ marginTop: 24 }}>{t('org.team.loading')}</div>
      ) : (
        <>
          {/* ── Members ── */}
          {tab === 'members' && (
            <>
              <p className="po-block-hint">
                {t('org.team.members.hint')}
              </p>
              <div className="ot-toolbar">
                <span className="ot-count">{t('org.team.members.count', { count: members.length })}</span>
                <button className="org-new-btn" type="button" onClick={() => setAddOpen(true)}>
                  <Plus className="org-new-icon" /> {t('org.team.members.add')}
                </button>
              </div>
              <div className="po-set-table">
                <div className="po-set-row po-set-row--head po-set-row--otm">
                  <span>{t('org.team.members.colMember')}</span><span>{t('org.team.members.colEmail')}</span><span>{t('org.team.members.colAccess')}</span><span />
                </div>
                {members.map(m => (
                  <MemberRow key={m.id} m={m}
                    onManage={() => setAssignFor(m)} onRemove={() => removeMember(m)} />
                ))}
              </div>
            </>
          )}

          {/* ── Roles ── */}
          {tab === 'roles' && (
            <>
              <p className="po-block-hint">
                {t('org.team.roles.hint')}
              </p>
              <div className="ot-toolbar">
                <span className="ot-count">{t('org.team.roles.count', { count: roles.length })}</span>
                <button className="org-new-btn" type="button" onClick={() => setRoleModal({})}>
                  <Plus className="org-new-icon" /> {t('org.team.roles.new')}
                </button>
              </div>
              <div className="po-set-table">
                <div className="po-set-row po-set-row--head po-set-row--otr">
                  <span>{t('org.team.roles.colRole')}</span><span>{t('org.team.roles.colPagesGranted')}</span><span>{t('org.team.roles.colType')}</span><span />
                </div>
                {roles.map(r => (
                  <RoleRow key={r.id} r={r} pagesCount={pages.length}
                    onEdit={() => setRoleModal({ role: r })} onDelete={() => deleteRole(r)} />
                ))}
              </div>
            </>
          )}

        </>
      )}

      {addOpen && <AddMemberModal orgId={orgId} onClose={() => setAddOpen(false)}
        showToast={showToast} />}
      {roleModal && <RoleEditorModal orgId={orgId} pages={pages} role={roleModal.role}
        onClose={() => setRoleModal(null)} onSaved={load} showToast={showToast} />}
      {assignFor && <AssignmentModal orgId={orgId} member={assignFor} projects={projects} roles={roles}
        onClose={() => setAssignFor(null)} onSaved={load} showToast={showToast} />}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </div>
  );
}
