// Organization Team — org-level RBAC management (owner only).
// Three tabs (Members / Roles / Invites) with a Products-style TabSwitcher and
// Targets-style tabular lists (po-set-table + PoListRow tilt rows + portal
// 3-dot menus). The backend (require_org_owner) is the source of truth; this
// page just drives it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  UsersThree, ShieldCheck, EnvelopeSimple, Plus, X, Trash, Copy,
  PencilSimple, CaretRight, DotsThreeOutline,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import '../../Style/Authentication.css';   // auth-tab-* switcher + auth-modal
import '../../Style/Organization.css';      // org-toolbar / org-new-btn / org-card-dropdown
import '../../Style/Products.css';           // po-set-table / po-set-row / po-block-hint
import '../../Style/OrgTeam.css';

// Human labels for the permission-matrix rows. Backend ships the authoritative
// `pages` list, so a new page shows up automatically (falls back to raw key).
const PAGE_LABELS = {
  overview: 'Overview',
  products: 'Products', inventory: 'Inventory', batches: 'Batches',
  promo_codes: 'Promo codes', discounts: 'Discount', tier_pricing: 'Tier pricing',
  warehouses: 'Warehouses', archive: 'Archive', product_settings: 'Product settings',
  orders: 'Orders', returns: 'Returns',
  customers: 'Customers',
  booking: 'Bookings', booking_services: 'Services', booking_staff: 'Staff',
  booking_settings: 'Booking settings',
  chat: 'Chat with Customers', channels: 'Channels',
  emails: 'Emails', analytics: 'Analytics',
  auth_providers: 'Auth Providers', url_config: 'URL Configuration',
  integrations: 'Integrations', alerts: 'Alerts', goals: 'Targets',
  documents: 'Documents', settings: 'Project Settings', api: 'API Keys',
};

// Visual grouping for the permission matrix (29 pages is a lot in one flat
// list). Each group renders a small sub-header; only keys the backend actually
// ships in `pages` are shown, so a future catalog change doesn't break this.
const PAGE_GROUPS = [
  { label: 'General',       keys: ['overview'] },
  { label: 'Products',      keys: ['products', 'inventory', 'batches', 'promo_codes', 'discounts', 'tier_pricing', 'warehouses', 'archive', 'product_settings'] },
  { label: 'Sales',         keys: ['orders', 'returns', 'customers'] },
  { label: 'Booking',       keys: ['booking', 'booking_services', 'booking_staff', 'booking_settings'] },
  { label: 'Engagement',    keys: ['chat', 'channels', 'emails', 'analytics', 'alerts', 'goals'] },
  { label: 'Configuration', keys: ['auth_providers', 'url_config', 'integrations', 'documents', 'settings', 'api'] },
];
const LEVELS = [
  { value: 'none',   label: 'None'   },
  { value: 'view',   label: 'View'   },
  { value: 'manage', label: 'Manage' },
];

function Avatar({ name, email, url, size = 30 }) {
  const seed = name || email || '?';
  const initials = seed.split(/[\s@.]+/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('');
  const palette = ['#0071E3', '#8b5cf6', '#06b6d4', '#f97316', '#f43f5e', '#d946ef', '#10b981'];
  const bg = palette[(seed.charCodeAt(0) || 0) % palette.length];
  if (url) return <img className="ot-avatar" src={url} alt="" style={{ width: size, height: size }} />;
  return <div className="ot-avatar ot-avatar--initials" style={{ width: size, height: size, background: bg }}>{initials}</div>;
}

// 3-way None/View/Manage segment for the matrix.
function LevelPicker({ value, onChange }) {
  return (
    <div className="ot-level">
      {LEVELS.map(l => (
        <button key={l.value} type="button"
          className={`ot-level-btn${(value || 'none') === l.value ? ' ot-level-btn--on' : ''}`}
          onClick={() => onChange(l.value)}>
          {l.label}
        </button>
      ))}
    </div>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef(null);
  const assigns = m.assignments || [];
  return (
    <PoListRow className="po-set-row--otm" frozen={menuOpen}>
      <span className="ot-id-cell">
        <Avatar name={m.name} email={m.email} url={m.avatar_url} size={30} />
        <span className="po-set-strong ot-ellipsis">
          {m.name || m.email}
          {m.is_owner && <span className="crm-badge crm-badge--dark" style={{ marginLeft: 8 }}>Owner</span>}
          {m.is_me && <span className="crm-badge crm-badge--light" style={{ marginLeft: 6 }}>You</span>}
        </span>
      </span>
      <span className="ot-muted ot-ellipsis">{m.email}</span>
      <span style={{ minWidth: 0 }}>
        {m.is_owner ? <span className="ot-access-full">Full access</span>
          : assigns.length === 0 ? <span className="ot-access-none">No project access</span>
          : <span className="ot-chips">
              {assigns.map(a => <span className="ot-chip" key={a.project_id}>{a.project_name}: <b>{a.role_name || '—'}</b></span>)}
            </span>}
      </span>
      {m.is_owner ? <span /> : (
        <button ref={btnRef} type="button" className="org-list-menu-btn" aria-label="Options"
          onClick={() => setMenuOpen(v => !v)}>
          <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
        </button>
      )}
      {menuOpen && (
        <RowMenu btnRef={btnRef} onClose={() => setMenuOpen(false)} items={[
          { Icon: CaretRight, label: 'Manage access', onClick: onManage },
          { sep: true },
          { Icon: Trash, label: 'Remove', danger: true, onClick: onRemove },
        ]} />
      )}
    </PoListRow>
  );
}

function RoleRow({ r, pagesCount, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef(null);
  const granted = Object.keys(r.permissions || {}).length;
  return (
    <PoListRow className="po-set-row--otr" frozen={menuOpen}
      onClick={onEdit} style={{ cursor: 'pointer' }}>
      <span className="po-set-strong ot-ellipsis">{r.name}</span>
      <span className="ot-muted">{granted} / {pagesCount} pages</span>
      <span>
        {r.is_preset
          ? <span className="crm-badge crm-badge--gray">Preset</span>
          : <span className="crm-badge crm-badge--light">Custom</span>}
      </span>
      <button ref={btnRef} type="button" className="org-list-menu-btn" aria-label="Options"
        onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <RowMenu btnRef={btnRef} onClose={() => setMenuOpen(false)} items={[
          { Icon: PencilSimple, label: 'Edit', onClick: onEdit },
          ...(r.is_preset ? [] : [{ sep: true }, { Icon: Trash, label: 'Delete', danger: true, onClick: onDelete }]),
        ]} />
      )}
    </PoListRow>
  );
}

function InviteRow({ inv, onCopy, onRevoke }) {
  return (
    <PoListRow className="po-set-row--oti">
      <span className="po-set-strong ot-ellipsis">{inv.email}</span>
      <span className="ot-invite-url ot-ellipsis"><code>{inv.invite_url}</code></span>
      <span className="ot-row-actions">
        <button className="crm-icon-btn" title="Copy link" onClick={onCopy}><Copy className="crm-icon" /></button>
        <button className="crm-icon-btn crm-icon-btn--danger" title="Revoke" onClick={onRevoke}><Trash className="crm-icon" /></button>
      </span>
    </PoListRow>
  );
}

// ── Role create/edit modal — name + permission matrix ──
function RoleEditorModal({ orgId, pages, role, onClose, onSaved, showToast }) {
  const editing = !!role;
  const [name, setName] = useState(role?.name || '');
  const [perms, setPerms] = useState(() => ({ ...(role?.permissions || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const setLevel = (page, level) => setPerms(p => {
    const next = { ...p };
    if (level === 'none') delete next[page];
    else next[page] = level;
    return next;
  });
  const setAll = (level) => setPerms(() => level === 'none' ? {} : Object.fromEntries(pages.map(pg => [pg, level])));

  const save = async () => {
    if (!name.trim()) { setErr('Role name is required'); return; }
    setBusy(true); setErr('');
    const url = editing
      ? `${API_BASE}/api/orgs/${orgId}/roles/${role.id}`
      : `${API_BASE}/api/orgs/${orgId}/roles`;
    const r = await fetch(url, {
      method: editing ? 'PUT' : 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), permissions: perms }),
    });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.detail || 'Save failed'); return; }
    showToast('Saved'); onSaved(); onClose();
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal ot-role-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{editing ? 'Edit role' : 'New role'}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {editing
                    ? `Editing "${role.name}" — choose what this role can see and do on each page.`
                    : 'A role is a per-page permission set. Assign it to members per project.'}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body">
          <form className="cpm-form" onSubmit={(e) => { e.preventDefault(); save(); }} autoComplete="off">
            <div className="cpm-section">
              <label className="po-field-label">Role name</label>
              <input className="crm-input" autoFocus maxLength={60}
                placeholder="Store Manager"
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="cpm-section">
              <div className="ot-matrix-head">
                <label className="po-field-label" style={{ padding: 0 }}>Page access</label>
                <div className="ot-matrix-bulk">
                  <button type="button" onClick={() => setAll('none')}>Clear all</button>
                  <button type="button" onClick={() => setAll('view')}>All view</button>
                  <button type="button" onClick={() => setAll('manage')}>All manage</button>
                </div>
              </div>
              <div className="ot-matrix">
                {PAGE_GROUPS.map(group => {
                  const keys = group.keys.filter(k => pages.includes(k));
                  if (keys.length === 0) return null;
                  return (
                    <div className="ot-matrix-group" key={group.label}>
                      <div className="ot-matrix-group-label">{group.label}</div>
                      {keys.map(pg => (
                        <div className="ot-matrix-row" key={pg}>
                          <span className="ot-matrix-label">{PAGE_LABELS[pg] || pg}</span>
                          <LevelPicker value={perms[pg]} onChange={(l) => setLevel(pg, l)} />
                        </div>
                      ))}
                    </div>
                  );
                })}
                {pages.filter(p => !PAGE_GROUPS.some(g => g.keys.includes(p))).map(pg => (
                  <div className="ot-matrix-row" key={pg}>
                    <span className="ot-matrix-label">{PAGE_LABELS[pg] || pg}</span>
                    <LevelPicker value={perms[pg]} onChange={(l) => setLevel(pg, l)} />
                  </div>
                ))}
              </div>
            </div>
            {err && <p className="auth-msg auth-msg--err">{err}</p>}
            <div className="auth-actions">
              <button className="crm-submit-btn" type="submit" disabled={busy}>
                {busy ? 'Saving…' : (editing ? 'Save role' : 'Create role')}
              </button>
              <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Add member modal ──
function AddMemberModal({ orgId, onClose, onSaved, showToast }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [emailInvite, setEmailInvite] = useState(null);   // personal link for an unregistered email
  const [link, setLink] = useState('');                    // reusable org share link
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/orgs/${orgId}/invite-link`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.url) setLink(j.url); })
      .catch(() => {});
  }, [orgId]);

  const resetLink = async () => {
    if (!window.confirm('Reset the invite link? The current link will stop working.')) return;
    setResetting(true);
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/invite-link/reset`, { method: 'POST', credentials: 'include' });
    setResetting(false);
    if (r.ok) { const j = await r.json(); setLink(j.url); showToast('Link reset'); }
  };

  const submitEmail = async () => {
    if (!email.trim() || !email.includes('@')) { setErr('Enter a valid email'); return; }
    setBusy(true); setErr('');
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/members`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.detail || 'Failed'); return; }
    if (j.invited) { setEmailInvite(j.invite_url); showToast('Invite created'); onSaved(); }
    else { showToast('Member added'); onSaved(); onClose(); }
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Add employee</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  Share the invite link, or add someone by email. New members join with <b>no access</b> — you grant pages and projects afterwards.
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
            {/* Reusable share link — the easy path */}
            <div className="cpm-section">
              <label className="po-field-label">Invite link</label>
              <div className="ot-invite-link">
                <code>{link || 'Generating…'}</code>
                <button type="button" className="crm-icon-btn" title="Copy link" disabled={!link}
                  onClick={() => { navigator.clipboard?.writeText(link); showToast('Copied'); }}>
                  <Copy className="crm-icon" />
                </button>
              </div>
              <span className="cpm-section-hint">
                Anyone who opens it and signs in joins the team — they see nothing until you grant access.{' '}
                <button type="button" className="ot-link-reset" onClick={resetLink} disabled={resetting}>
                  Reset link
                </button>
              </span>
            </div>

            <div className="ot-or-sep"><span>or add by email</span></div>

            {emailInvite ? (
              <div className="cpm-section">
                <label className="po-field-label">Personal invite link</label>
                <div className="ot-invite-link">
                  <code>{emailInvite}</code>
                  <button type="button" className="crm-icon-btn" title="Copy"
                    onClick={() => { navigator.clipboard?.writeText(emailInvite); showToast('Copied'); }}>
                    <Copy className="crm-icon" />
                  </button>
                </div>
                <span className="cpm-section-hint">No account exists for that email yet — send them this link.</span>
              </div>
            ) : (
              <div className="cpm-section">
                <label className="po-field-label">Email</label>
                <input className="crm-input" type="email"
                  placeholder="employee@email.com" value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitEmail(); } }} />
                {err && <p className="auth-msg auth-msg--err">{err}</p>}
              </div>
            )}
          </div>
          <div className="auth-actions">
            {!emailInvite && (
              <button className="crm-submit-btn" type="button" onClick={submitEmail}
                disabled={busy || !email.trim()}>
                {busy ? 'Adding…' : 'Add by email'}
              </button>
            )}
            <button className="crm-submit-btn auth-btn-secondary" type="button" onClick={onClose}>
              {emailInvite ? 'Done' : 'Cancel'}
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
    if (r.ok) { showToast('Saved'); onSaved(); }
    else      { showToast('Save failed'); }
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Manage access</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {member.name || member.email} — pick a role per project. "No access" hides the project entirely.
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
            {projects.length === 0 && <div className="crm-placeholder">No projects in this organization yet.</div>}
            {projects.map(p => (
              <div className="ot-assign-row" key={p.id}>
                <span className="ot-assign-project">{p.name}</span>
                <select className="crm-input crm-input-select ot-assign-select"
                  value={assign[p.id] || 0}
                  onChange={e => change(p.id, parseInt(e.target.value) || 0)}>
                  <option value={0}>No access</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="auth-actions">
            <button className="crm-submit-btn" type="button" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function OrgTeam() {
  const { org } = useOutletContext();
  const orgId = org?.id;

  const [tab, setTab] = useState('members');
  const [members, setMembers] = useState([]);
  const [roles, setRoles]     = useState([]);
  const [pages, setPages]     = useState([]);
  const [projects, setProjects] = useState([]);
  const [invites, setInvites] = useState([]);
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
      const [m, r, p, i] = await Promise.all([
        getJSON(`${API_BASE}/api/orgs/${orgId}/members`,  []),
        getJSON(`${API_BASE}/api/orgs/${orgId}/roles`,    {}),
        getJSON(`${API_BASE}/api/orgs/${orgId}/projects`, []),
        getJSON(`${API_BASE}/api/orgs/${orgId}/invites`,  []),
      ]);
      if (m && m._forbidden) { setError('Only the organization owner can manage the team.'); return; }
      setMembers(Array.isArray(m) ? m : []);
      setRoles(Array.isArray(r?.roles) ? r.roles : []);
      setPages(Array.isArray(r?.pages) ? r.pages : []);
      setProjects(Array.isArray(p) ? p : []);
      setInvites(Array.isArray(i) ? i : []);
    } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const removeMember = async (m) => {
    if (!window.confirm(`Remove ${m.name || m.email} from the organization?`)) return;
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/members/${m.id}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) { showToast('Removed'); load(); } else showToast('Failed');
  };
  const deleteRole = async (role) => {
    if (!window.confirm(`Delete role "${role.name}"?`)) return;
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/roles/${role.id}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) { showToast('Deleted'); load(); }
    else { const j = await r.json().catch(() => ({})); showToast(j.detail || 'Failed'); }
  };
  const revokeInvite = async (inv) => {
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/invites/${inv.id}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) { showToast('Revoked'); load(); }
  };

  const TABS = [
    { key: 'members', label: 'Members', Icon: UsersThree },
    { key: 'roles',   label: 'Roles',   Icon: ShieldCheck },
    { key: 'invites', label: 'Invites', Icon: EnvelopeSimple, badge: invites.length },
  ];

  return (
    <div className="prod-page-wrap">
      <TabSwitcher tabs={TABS} activeKey={tab} onPick={setTab} />
      <h1 className="crm-page-title">Team</h1>

      {error ? (
        <div className="crm-placeholder" style={{ marginTop: 24 }}>{error}</div>
      ) : loading ? (
        <div className="crm-placeholder" style={{ marginTop: 24 }}>Loading…</div>
      ) : (
        <>
          {/* ── Members ── */}
          {tab === 'members' && (
            <>
              <p className="po-block-hint">
                People in this organization and their per-project roles. The owner always has full access.
              </p>
              <div className="ot-toolbar">
                <span className="ot-count">{members.length} {members.length === 1 ? 'person' : 'people'}</span>
                <button className="org-new-btn" type="button" onClick={() => setAddOpen(true)}>
                  <Plus className="org-new-icon" /> Add employee
                </button>
              </div>
              <div className="po-set-table">
                <div className="po-set-row po-set-row--head po-set-row--otm">
                  <span>Member</span><span>Email</span><span>Access</span><span />
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
                A role is a per-page permission set (None / View / Manage). Assign roles to members per project.
              </p>
              <div className="ot-toolbar">
                <span className="ot-count">{roles.length} {roles.length === 1 ? 'role' : 'roles'}</span>
                <button className="org-new-btn" type="button" onClick={() => setRoleModal({})}>
                  <Plus className="org-new-icon" /> New role
                </button>
              </div>
              <div className="po-set-table">
                <div className="po-set-row po-set-row--head po-set-row--otr">
                  <span>Role</span><span>Pages granted</span><span>Type</span><span />
                </div>
                {roles.map(r => (
                  <RoleRow key={r.id} r={r} pagesCount={pages.length}
                    onEdit={() => setRoleModal({ role: r })} onDelete={() => deleteRole(r)} />
                ))}
              </div>
            </>
          )}

          {/* ── Invites ── */}
          {tab === 'invites' && (
            <>
              <p className="po-block-hint">
                Pending email invites. People join once they sign up with the invited address and accept the link.
              </p>
              <div className="ot-toolbar">
                <span className="ot-count">{invites.length} pending</span>
                <button className="org-new-btn" type="button" onClick={() => setAddOpen(true)}>
                  <Plus className="org-new-icon" /> Invite by email
                </button>
              </div>
              {invites.length === 0 ? (
                <div className="crm-placeholder">No pending invites.</div>
              ) : (
                <div className="po-set-table">
                  <div className="po-set-row po-set-row--head po-set-row--oti">
                    <span>Email</span><span>Invite link</span><span />
                  </div>
                  {invites.map(inv => (
                    <InviteRow key={inv.id} inv={inv}
                      onCopy={() => { navigator.clipboard?.writeText(inv.invite_url); showToast('Copied'); }}
                      onRevoke={() => revokeInvite(inv)} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {addOpen && <AddMemberModal orgId={orgId} onClose={() => setAddOpen(false)}
        onSaved={load} showToast={showToast} />}
      {roleModal && <RoleEditorModal orgId={orgId} pages={pages} role={roleModal.role}
        onClose={() => setRoleModal(null)} onSaved={load} showToast={showToast} />}
      {assignFor && <AssignmentModal orgId={orgId} member={assignFor} projects={projects} roles={roles}
        onClose={() => setAssignFor(null)} onSaved={load} showToast={showToast} />}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </div>
  );
}
