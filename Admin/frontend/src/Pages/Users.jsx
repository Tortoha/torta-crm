// Admin Users — 1:1 visual copy of CRM Targets / PromoCodes pattern:
// crm-page-title + .org-toolbar (search + status combo + grid/list view +
// New button — omitted, no "create user" here) + .po-set-table rows
// rendered via PoListRow (InteractiveSection 3D tilt). 3-dot menu via
// portal-mounted .org-card-dropdown.
//
// Ban modal mirrors the .auth-modal shape from CRM (Authentication.css),
// with three tiers: soft (login only) / hard (login + projects) / nuclear
// (cascade delete). The nuclear path requires type-to-confirm.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  MagnifyingGlass, ArrowDown, SquaresFour, List,
  DotsThreeOutline, Prohibit, Trash, ShieldStar, Warning, X,
  CheckCircle, ArrowsClockwise,
} from '@phosphor-icons/react';
import { API_BASE, pickError } from '../api.js';
import { PoListRow } from '../Utils/PoListRow.jsx';
import { useRealtimePoll } from '../Utils/useRealtimePoll.js';
import '../Style/Authentication.css';
import '../Style/Organization.css';
import '../Style/Products.css';
import '../Style/Targets.css';
import '../Style/Users.css';

// `value` stays stable (API param); `labelKey` resolves to a translation at
// render time (built into display labels via useMemo inside the component).
const STATUS_FILTER_OPTIONS = [
  { value: 'all',    labelKey: 'users.filters.all' },
  { value: 'active', labelKey: 'users.filters.active' },
  { value: 'banned', labelKey: 'users.filters.banned' },
  { value: 'admin',  labelKey: 'users.filters.admin' },
];

// ── 3-dot menu (portal) — copy of CRM TargetMenu shape ──────────────────
function UserMenu({ btnRef, onClose, isBanned, onBan, onUnban, onDelete }) {
  const { t } = useTranslation();
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 200) });
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
    <div className="org-card-dropdown"
      style={{ top: pos.top, left: pos.left }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}>
      {isBanned ? (
        <button className="org-card-dropdown-item" onClick={() => { onClose(); onUnban(); }}>
          <CheckCircle className="org-card-dropdown-icon" /> {t('users.menu.unban')}
        </button>
      ) : (
        <button className="org-card-dropdown-item" onClick={() => { onClose(); onBan(); }}>
          <Prohibit className="org-card-dropdown-icon" /> {t('users.menu.ban')}
        </button>
      )}
      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger"
        onClick={() => { onClose(); onDelete(); }}>
        <Trash className="org-card-dropdown-icon" /> {t('users.menu.delete')}
      </button>
    </div>,
    document.body,
  );
}

// ── Ban modal (3 tiers in one place) — auth-modal shape ────────────────
function BanModal({ user, defaultTier, onClose, onDone }) {
  const { t } = useTranslation();
  const [tier, setTier]     = useState(defaultTier || 'soft');
  const [reason, setReason] = useState('');
  const [typed, setTyped]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      let res;
      if (tier === 'nuclear') {
        if (typed.trim().toLowerCase() !== (user.email || '').toLowerCase()) {
          setErr(t('users.errors.typeEmailExactly'));
          setBusy(false); return;
        }
        res = await fetch(`${API_BASE}/api/admin/users/${user.id}`, {
          method: 'DELETE', credentials: 'include',
        });
      } else {
        res = await fetch(`${API_BASE}/api/admin/users/${user.id}/ban`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ level: tier, reason: reason.trim() }),
        });
      }
      if (res.ok) onDone();
      else {
        const j = await res.json().catch(() => ({}));
        setErr(pickError(j, t('users.errors.actionFailed')));
      }
    } catch {
      setErr(t('users.errors.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{t('users.ban.title')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {t('users.ban.subtitle', { email: user.email, orgs: user.orgs || 0, projects: user.projects || 0 })}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <div className="adm-tier-list">
            <Tier active={tier === 'soft'}     onClick={() => setTier('soft')}     Icon={Warning}
              tone="warn" title={t('users.ban.tiers.soft.title')}
              body={t('users.ban.tiers.soft.body')} />
            <Tier active={tier === 'hard'}     onClick={() => setTier('hard')}     Icon={Prohibit}
              tone="danger" title={t('users.ban.tiers.hard.title')}
              body={t('users.ban.tiers.hard.body')} />
            <Tier active={tier === 'nuclear'}  onClick={() => setTier('nuclear')}  Icon={Trash}
              tone="danger" title={t('users.ban.tiers.nuclear.title')}
              body={t('users.ban.tiers.nuclear.body')} />
          </div>

          {tier !== 'nuclear' && (
            <div className="cpm-section">
              <label className="po-field-label">{t('users.ban.reasonLabel')}</label>
              <textarea className="crm-input cpm-textarea" rows={3} maxLength={1000}
                placeholder={t('users.ban.reasonPlaceholder')}
                value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}

          {tier === 'nuclear' && (
            <div className="adm-confirm-box">
              <p>{t('users.ban.confirmTextBefore')} <code>{user.email}</code> {t('users.ban.confirmTextAfter')}</p>
              <input
                className="crm-input"
                type="text"
                placeholder={user.email}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
          )}

          {err && <p className="auth-msg auth-msg--err">{err}</p>}

          <div className="auth-actions">
            <button type="button" disabled={busy} onClick={submit}
              className={`crm-submit-btn adm-btn-${tier}`}>
              {busy ? t('users.ban.working')
                : tier === 'nuclear' ? t('users.ban.deleteBtn')
                : tier === 'hard'    ? t('users.ban.hardBtn')
                                     : t('users.ban.softBtn')}
            </button>
            <button type="button" className="crm-submit-btn auth-btn-secondary"
              onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Tier({ active, onClick, Icon, tone, title, body }) {
  return (
    <button type="button"
      className={`adm-tier${active ? ` adm-tier--active adm-tier--${tone}` : ''}`}
      onClick={onClick}>
      <Icon weight="bold" className="adm-tier-icon" />
      <div className="adm-tier-text">
        <div className="adm-tier-title">{title}</div>
        <div className="adm-tier-body">{body}</div>
      </div>
    </button>
  );
}

// ── Row ────────────────────────────────────────────────────────────────
function UserRow({ u, onBan, onUnban, onDelete }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const banned = !!u.ban_level;

  return (
    <PoListRow className="po-set-row--user" frozen={menuOpen}>
      <span className="po-set-strong" style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {u.is_admin && <ShieldStar weight="fill" size={14} color="var(--accent)" />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {u.email}
        </span>
      </span>
      <span style={{ color: 'var(--muted)' }}>{u.name || '—'}</span>
      <span style={{ color: 'var(--muted)' }}>{formatDate(u.created_at)}</span>
      <span style={{ color: 'var(--muted)' }}>{u.signup_country || '—'}</span>
      <span style={{ color: 'var(--muted)' }}>{u.orgs} / {u.projects}</span>
      <span>{statusBadge(u, t)}</span>
      <button ref={menuBtnRef} type="button" className="org-list-menu-btn"
        aria-label={t('users.menu.actions')}
        onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <UserMenu btnRef={menuBtnRef}
          onClose={() => setMenuOpen(false)}
          isBanned={banned}
          onBan={onBan} onUnban={onUnban} onDelete={onDelete} />
      )}
    </PoListRow>
  );
}

function statusBadge(u, t) {
  if (u.ban_level === 'hard') return <span className="t-status t-status--bad"><Prohibit size={11} weight="fill" /> {t('users.status.hardBanned')}</span>;
  if (u.ban_level === 'soft') return <span className="t-status t-status--warn"><Warning size={11} weight="fill" /> {t('users.status.softBanned')}</span>;
  if (u.is_admin)             return <span className="t-status t-status--good"><ShieldStar size={11} weight="fill" /> {t('users.status.admin')}</span>;
  return <span className="t-status t-status--neutral">{t('users.status.active')}</span>;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return String(iso); }
}

// ── Page ──────────────────────────────────────────────────────────────
export default function Users() {
  const { t } = useTranslation();
  const [q, setQ]             = useState('');
  const [status, setStatus]   = useState('all');
  const [page, setPage]       = useState(1);
  const [data, setData]       = useState(null);
  const [err, setErr]         = useState('');
  const [banTarget, setBanTarget] = useState(null);
  const [banTier, setBanTier]     = useState('soft');

  // silent=true → background refresh: keep the current page on a transient
  // error instead of replacing it with a "Failed to load" banner.
  const load = (silent = false) => {
    const params = new URLSearchParams({ status, page: String(page), per_page: '50' });
    if (q) params.set('q', q);
    fetch(`${API_BASE}/api/admin/users?${params}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setData(d); setErr(''); })
      .catch(e => { if (!silent) setErr(String(e)); });
  };

  useEffect(load, [q, status, page]);
  useRealtimePoll(() => load(true));

  const openBan = (u, tier = 'soft') => { setBanTarget(u); setBanTier(tier); };

  const onUnban = async (u) => {
    if (!confirm(t('users.confirmUnban', { email: u.email }))) return;
    await fetch(`${API_BASE}/api/admin/users/${u.id}/unban`, { method: 'POST', credentials: 'include' });
    load();
  };

  const onDelete = (u) => openBan(u, 'nuclear');

  const filtered = useMemo(() => data?.users || [], [data]);

  // Resolve the module-level status options' i18n keys to display labels.
  const statusFilters = useMemo(
    () => STATUS_FILTER_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );

  return (
    <>
      <h1 className="crm-page-title">{t('users.title')}</h1>

      {/* Toolbar — copies CRM Targets toolbar pattern */}
      <div className="org-toolbar">
        {/* Search */}
        <div className="org-search-wrap" style={{ flex: 1, minWidth: 240 }}>
          <MagnifyingGlass className="org-search-icon" />
          <input
            className="org-search-input"
            placeholder={t('users.searchPlaceholder')}
            value={q}
            onChange={(e) => { setPage(1); setQ(e.target.value); }}
          />
        </div>

        {/* Status filter as pill segmented control */}
        <div className="org-status-pill">
          {statusFilters.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`org-status-btn${status === opt.value ? ' org-status-btn--active' : ''}`}
              onClick={() => { setPage(1); setStatus(opt.value); }}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      {err && <div className="crm-placeholder" style={{ color: 'var(--delete)' }}>{t('users.errors.loadFailed', { error: err })}</div>}

      {!data && !err && <div className="crm-placeholder">{t('common.loading')}</div>}

      {data && filtered.length === 0 && (
        <div className="crm-placeholder">
          {q || status !== 'all' ? t('users.empty.noMatch') : t('users.empty.none')}
        </div>
      )}

      {data && filtered.length > 0 && (
        <>
          <div className="po-set-table">
            <div className="po-set-row po-set-row--head po-set-row--user">
              <span>{t('users.columns.email')}</span>
              <span>{t('users.columns.name')}</span>
              <span>{t('users.columns.joined')}</span>
              <span>{t('users.columns.country')}</span>
              <span>{t('users.columns.orgsProjects')}</span>
              <span>{t('users.columns.status')}</span>
              <span />
            </div>
            {filtered.map(u => (
              <UserRow key={u.id}
                u={u}
                onBan={() => openBan(u, 'soft')}
                onUnban={() => onUnban(u)}
                onDelete={() => onDelete(u)} />
            ))}
          </div>

          {/* Pagination */}
          <div className="adm-pagination">
            <span style={{ color: 'var(--muted)' }}>{t('users.pageInfo', { total: data.total, page: data.page, pages: data.pages })}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="crm-submit-btn auth-btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}>{t('users.prev')}</button>
              <button className="crm-submit-btn auth-btn-secondary"
                disabled={page >= data.pages}
                onClick={() => setPage(p => p + 1)}>{t('users.next')}</button>
            </div>
          </div>
        </>
      )}

      {banTarget && (
        <BanModal user={banTarget} defaultTier={banTier}
          onClose={() => setBanTarget(null)}
          onDone={() => { setBanTarget(null); load(); }} />
      )}
    </>
  );
}
