import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Bell, Plus, Trash, PencilSimple, X, CheckCircle, Warning, DotsThreeOutline,
  MagnifyingGlass, ArrowDown, SquaresFour, List,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { Combobox } from './Booking/BookingCreateModal.jsx';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import '../../Style/Authentication.css';
import '../../Style/Booking.css';
import '../../Style/Organization.css';
import '../../Style/Products.css';   // .po-block-hint, .org-toolbar, .org-new-btn, .po-set-row
import '../../Style/Targets.css';    // .t-card + status pills + .t-row-progress (reused for Alerts)
import '../../Style/Alerts.css';     // .al-fire-* (unchanged history list)

// ── Alert-type catalog (must match ALERT_TYPES in CRM backend) ──────
const ALERT_TYPES = [
  {
    value: 'revenue_drop',
    label: 'Revenue drop',
    hint: 'Compares last 24 h to the prior 24 h. Fires when the drop exceeds your threshold percent.',
    thresholdLabel: 'Drop threshold (%)',
    thresholdPlaceholder: '20',
    defaultThreshold: 20,
  },
  {
    value: 'low_stock',
    label: 'Low stock',
    hint: 'Fires when ANY SKU is at or below this stock level (and > 0).',
    thresholdLabel: 'Min stock units',
    thresholdPlaceholder: '5',
    defaultThreshold: 5,
  },
  {
    value: 'daily_summary',
    label: 'Daily summary',
    hint: 'Daily revenue + order count digest. Sent once every 24 h regardless of activity.',
    thresholdLabel: null, // no threshold needed
    defaultThreshold: 0,
  },
  {
    value: 'new_order',
    label: 'New order',
    hint: 'Fires when at least one new paid order has come in since the last evaluation cycle (max once per 4 h).',
    thresholdLabel: null,
    defaultThreshold: 0,
  },
];

const typeMeta = (v) => ALERT_TYPES.find(t => t.value === v) || ALERT_TYPES[0];

// Toolbar — status filter shape mirrors Targets / PromoCodes.
const STATUS_FILTER_OPTIONS = [
  { value: 'all',    label: 'All statuses' },
  { value: 'active', label: 'Active'       },
  { value: 'muted',  label: 'Muted'        },
];

// Toolbar — sort field options. Direction toggles on second click.
const SORT_OPTIONS = [
  { field: 'date',  label: 'Sort by date'   },
  { field: 'type',  label: 'Sort by type'   },
  { field: 'fired', label: 'Sort by recent fire' },
];
const SORT_DEFAULT_DIR = { date: 'desc', type: 'asc', fired: 'desc' };

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

// ── Sort toggle (sliding pill, mirrors Targets / PromoCodes) ───────────
function SortToggle({ sort, onSort }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curField = hovered ?? sort.field;

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

  return (
    <div className="org-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {SORT_OPTIONS.map(({ field, label }) => {
        const active = sort.field === field;
        const isCur  = curField === field;
        return (
          <button key={field} ref={el => { btnRefs.current[field] = el; }}
            className={`org-sort-btn${isCur ? ' org-sort-btn--current' : ''}`}
            style={active ? { paddingLeft: '6px' } : undefined}
            onMouseEnter={() => setHovered(field)}
            onClick={() => onSort(field)} type="button">
            {active && (
              <ArrowDown className="org-sort-icon"
                style={{ transform: sort.dir === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Alerts() {
  const { projectId } = useOutletContext();
  const [alerts, setAlerts] = useState([]);
  const [fires,  setFires]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // null | 'new' | alert object
  const [toast,   setToast]   = useState('');

  // Toolbar state — mirrors Targets / PromoCodes for visual consistency.
  const [search,  setSearch]  = useState('');
  const [statusF, setStatusF] = useState('all');
  const [sort,    setSort]    = useState({ field: 'date', dir: 'desc' });
  const [view,    setView]    = useState('list');
  const [viewHover, setViewHover] = useState(null);
  const curView = viewHover ?? view;

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/projects/${projectId}/alerts`,
            { credentials: 'include' })
        .then(r => r.ok ? r.json() : []),
      fetch(`${API_BASE}/api/projects/${projectId}/alerts/fires`,
            { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    ])
    .then(([a, f]) => {
      setAlerts(Array.isArray(a) ? a : []);
      setFires(Array.isArray(f) ? f : []);
    })
    .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this alert? Existing fires stay in the audit log.')) return;
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/alerts/${id}`,
                          { method: 'DELETE', credentials: 'include' });
    if (r.ok) {
      showToast('Alert deleted');
      reload();
    }
  };

  const handleToggle = async (alert) => {
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/alerts/${alert.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:      alert.type,
        threshold: alert.threshold,
        email:     alert.email,
        is_active: !alert.is_active,
      }),
    });
    if (r.ok) reload();
  };

  const handleSetSort = (field) => {
    setSort(prev => ({
      field,
      dir: field === prev.field
        ? (prev.dir === 'asc' ? 'desc' : 'asc')
        : (SORT_DEFAULT_DIR[field] || 'desc'),
    }));
  };

  // Filter + sort — same shape as Targets / PromoCodes.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filt = alerts.filter(a => {
      if (q) {
        const hay = `${a.type_label || ''} ${a.email || ''} ${typeMeta(a.type).label}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusF === 'active' && !a.is_active) return false;
      if (statusF === 'muted'  &&  a.is_active) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    filt.sort((a, b) => {
      let av, bv;
      if (sort.field === 'type') {
        av = (a.type_label || a.type || '').toLowerCase();
        bv = (b.type_label || b.type || '').toLowerCase();
      } else if (sort.field === 'fired') {
        av = a.last_fired_at || '';
        bv = b.last_fired_at || '';
      } else {
        av = a.created_at || a.id || 0;
        bv = b.created_at || b.id || 0;
      }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return filt;
  }, [alerts, search, statusF, sort]);

  return (
    <>
      <h1 className="crm-page-title">Alerts</h1>

      <p className="po-block-hint">
        Email notifications triggered by metric thresholds. The evaluator
        runs every hour; per-alert throttling prevents spam when a
        condition stays violated.
      </p>

      {/* Full toolbar — search · sort · status filter · view toggle · New.
          Same shape as Targets / PromoCodes / Batches. */}
      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search alerts…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <SortToggle sort={sort} onSort={handleSetSort} />

        <div className="po-cb-wrap po-cb-wrap--toolbar" style={{ width: 180, minWidth: 180 }}>
          <Combobox value={statusF} options={STATUS_FILTER_OPTIONS}
            onChange={(v) => setStatusF(v)} />
        </div>

        <div className="org-view-toggle" onMouseLeave={() => setViewHover(null)}>
          <div className="org-view-indicator"
            style={{ transform: `translateX(${curView === 'list' ? 30 : 0}px)` }} />
          <button className={`org-view-btn${curView === 'grid' ? ' org-view-btn--current' : ''}`}
            onClick={() => setView('grid')} onMouseEnter={() => setViewHover('grid')}
            title="Grid view" type="button">
            <SquaresFour className="org-view-icon" />
          </button>
          <button className={`org-view-btn${curView === 'list' ? ' org-view-btn--current' : ''}`}
            onClick={() => setView('list')} onMouseEnter={() => setViewHover('list')}
            title="List view" type="button">
            <List className="org-view-icon" />
          </button>
        </div>

        <button type="button" className="org-new-btn" onClick={() => setEditing('new')}>
          <Plus className="org-new-icon" /> New alert
        </button>
      </div>

      {loading ? (
        <div className="crm-placeholder">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="crm-placeholder">
          {search || statusF !== 'all'
            ? 'No alerts match your filters.'
            : 'No alerts yet. Click New alert to add one — pick a metric, set the threshold, and we\'ll email you when it trips.'}
        </div>
      ) : view === 'list' ? (
        // ── List view — tabular rows like PromoCodes / Batches ────────
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head po-set-row--alert">
            <span>Type</span>
            <span>Threshold</span>
            <span>Recipient</span>
            <span>Last fired</span>
            <span>Status</span>
            <span />
          </div>
          {filtered.map(a => (
            <AlertListRow key={a.id} alert={a}
              onEdit={() => setEditing(a)}
              onDelete={() => handleDelete(a.id)}
              onToggle={() => handleToggle(a)} />
          ))}
        </div>
      ) : (
        // ── Grid view — visual cards (existing AlertCard) ─────────────
        <div className="t-grid">
          {filtered.map(a => (
            <AlertCard key={a.id} alert={a}
              onEdit={() => setEditing(a)}
              onDelete={() => handleDelete(a.id)}
              onToggle={() => handleToggle(a)} />
          ))}
        </div>
      )}

      {/* Recent fires — same po-set-table list-row design as Alerts list
          view (and Targets / PromoCodes / Batches). Adds visual rhythm so
          the page reads as one consistent system instead of an alert list
          followed by an odd boxy "history" panel. Rows are read-only —
          no menu, no click handler (history can't be edited). */}
      <h2 className="crm-section-title" style={{ marginTop: 32, marginBottom: 12 }}>
        Recent fires
      </h2>
      {fires.length === 0 ? (
        <div className="crm-placeholder">
          No fires yet — alerts haven't tripped or there's no history.
        </div>
      ) : (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head po-set-row--fire">
            <span>Event</span>
            <span>Message</span>
            <span>Alert</span>
            <span>Fired at</span>
          </div>
          {fires.map(f => (
            <PoListRow key={f.id} className="po-set-row--fire">
              {/* Tinted icon tile — same visual weight as TargetCard.
                  Marks the row as "this was an alert that tripped". */}
              <span style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: 'var(--accent-tint)',
                  color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Warning weight="duotone" style={{ width: 18, height: 18 }} />
                </span>
              </span>
              <span className="po-set-strong"
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.message}
              </span>
              <span style={{ color: 'var(--muted)' }}>#{f.alert_id}</span>
              <span style={{ color: 'var(--muted)' }}>{fmtDateTime(f.fired_at)}</span>
            </PoListRow>
          ))}
        </div>
      )}

      {editing && (
        <AlertEditModal
          projectId={projectId}
          alert={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            showToast(editing === 'new' ? 'Alert created' : 'Alert updated');
            setEditing(null);
            reload();
          }} />
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}

// ── List row — compact tabular variant (PromoCodes/Batches pattern) ────
// 6 columns: type / threshold / email / last_fired / status / menu. The
// status pill double-duty here as a click target won't work — keep the
// 3-dot menu for actions (Mute/Activate/Edit/Delete). Whole row clicks
// open the editor, status-pill stopPropagation prevents the open.
function AlertListRow({ alert, onEdit, onDelete, onToggle }) {
  const meta = typeMeta(alert.type);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  return (
    <PoListRow className="po-set-row--alert" frozen={menuOpen}
      onClick={() => onEdit()} style={{ cursor: 'pointer' }}>
      {/* Type label only — Bell icon removed per design (page is named
          "Alerts" with a Bell already in the sidebar; repeating the icon
          on every row was visual noise). Muted color when inactive. */}
      <span className="po-set-strong"
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                 color: alert.is_active ? undefined : 'var(--muted)' }}>
        {alert.type_label || meta.label}
      </span>
      <span>
        {meta.thresholdLabel
          ? <><b>{alert.threshold}</b> <span style={{ color: 'var(--muted)' }}>{meta.thresholdLabel.replace(/^[^()]*\(([^)]+)\)/, '$1').toLowerCase()}</span></>
          : <span style={{ color: 'var(--muted)' }}>—</span>}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {alert.email}
      </span>
      <span style={{ color: 'var(--muted)' }}>
        {alert.last_fired_at ? fmtDateTime(alert.last_fired_at) : 'Never'}
      </span>
      <span>
        <span className={`t-status ${alert.is_active ? 't-status--on-track' : 't-status--behind'}`}>
          {alert.is_active ? 'ACTIVE' : 'MUTED'}
        </span>
      </span>
      <button ref={menuBtnRef} type="button" className="org-list-menu-btn"
        aria-label="Options"
        onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <AlertMenu btnRef={menuBtnRef}
          onClose={() => setMenuOpen(false)}
          isActive={alert.is_active}
          onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} />
      )}
    </PoListRow>
  );
}

// ── 3-dot menu — exact PromoMenu pattern (portal + getBoundingClientRect) ──
// Anchored to the trigger button rect; renders into document.body so it
// escapes the card's z-index / overflow constraints. Same .org-card-dropdown
// styles as PromoCodes / Products — single visual language across pages.
function AlertMenu({ btnRef, onClose, isActive, onEdit, onToggle, onDelete }) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 184) });
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onPd  = (e) => {
      if (!e.target.closest?.('.org-card-dropdown') &&
          !btnRef.current?.contains(e.target)) {
        onClose();
      }
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
      <button className="org-card-dropdown-item"
        onClick={() => { onClose(); onEdit(); }}>
        <PencilSimple className="org-card-dropdown-icon" /> Edit
      </button>
      <button className="org-card-dropdown-item"
        onClick={() => { onClose(); onToggle(); }}>
        <Bell className="org-card-dropdown-icon" />
        {isActive ? 'Mute' : 'Activate'}
      </button>
      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger"
        onClick={() => { onClose(); onDelete(); }}>
        <Trash className="org-card-dropdown-icon" /> Delete
      </button>
    </div>,
    document.body,
  );
}

// ── Alert card ─────────────────────────────────────────────────────────
// Visual chrome mirrors TargetCard (which mirrors PromoCard): rounded card,
// soft shadow, 3-dot menu in top-right. Bell icon left-side stays — it's
// the page's identity. Active/muted styling lives on the bell + left bar.
function AlertCard({ alert, onEdit, onDelete, onToggle }) {
  const meta = typeMeta(alert.type);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);

  // (Close-on-Esc / outside-click is owned by AlertMenu itself — see below.)

  // Map active/muted state to TargetCard's status colour classes so the
  // left border / hover effect read consistently across both pages.
  // Active = on_track (blue tint), muted = behind (grey-ish).
  const statusCls = alert.is_active ? 't-card--on_track' : 't-card--behind';

  return (
    <div className={`t-card ${statusCls}`} onClick={() => onEdit()}>

      <div className="t-card-head">
        <div className="t-card-title-wrap">
          {/* Bell icon removed — Alerts page identity is already established
              by the sidebar Bell + page title. Title alone here keeps the
              card head visually consistent with the list view. */}
          <div style={{ minWidth: 0 }}>
            <h3 className="t-card-title"
              style={!alert.is_active ? { color: 'var(--muted)' } : undefined}>
              {alert.type_label || meta.label}
            </h3>
            <div className="t-card-sub">
              {meta.thresholdLabel && (
                <>
                  <span>{meta.thresholdLabel}: <b>{alert.threshold}</b></span>
                  <span className="t-card-sub-dot" />
                </>
              )}
              <span>To <b>{alert.email}</b></span>
              {alert.last_fired_at && (
                <>
                  <span className="t-card-sub-dot" />
                  <span>Last fired {fmtDateTime(alert.last_fired_at)}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="t-card-actions" onClick={(e) => e.stopPropagation()}>
          <span className={`t-status ${alert.is_active ? 't-status--on-track' : 't-status--behind'}`}>
            {alert.is_active ? 'ACTIVE' : 'MUTED'}
          </span>
          <button ref={menuBtnRef} type="button" className="org-list-menu-btn"
            aria-label="Options"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
            <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
          </button>
          {menuOpen && (
            <AlertMenu btnRef={menuBtnRef}
              onClose={() => setMenuOpen(false)}
              isActive={alert.is_active}
              onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Create/edit modal — matches PromoCodes / Booking modal layout ────
function AlertEditModal({ projectId, alert, onClose, onSaved }) {
  const isNew = !alert;
  const [type,      setType]      = useState(alert?.type || ALERT_TYPES[0].value);
  const [threshold, setThreshold] = useState(
    alert?.threshold ?? typeMeta(alert?.type).defaultThreshold
  );
  const [email,     setEmail]     = useState(alert?.email || '');
  const [isActive,  setIsActive]  = useState(alert?.is_active !== false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const meta = typeMeta(type);

  // When user switches type, reset threshold to that type's default if
  // the current value still matches the previous type's default (don't
  // clobber a manually-entered number).
  const switchType = (newType) => {
    const newMeta = typeMeta(newType);
    setType(newType);
    setThreshold(newMeta.defaultThreshold);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!email || !email.includes('@')) {
      setErr('Valid email required');
      return;
    }
    if (meta.thresholdLabel && (threshold === '' || isNaN(+threshold))) {
      setErr('Threshold must be a number');
      return;
    }
    setBusy(true);
    const body = {
      type,
      threshold: meta.thresholdLabel ? +threshold : 0,
      email:     email.trim(),
      is_active: !!isActive,
    };
    const url = isNew
      ? `${API_BASE}/api/projects/${projectId}/alerts`
      : `${API_BASE}/api/projects/${projectId}/alerts/${alert.id}`;
    const method = isNew ? 'POST' : 'PATCH';
    try {
      const r = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) { onSaved(); }
      else {
        const j = await r.json().catch(() => ({}));
        setErr(j.detail || 'Save failed');
      }
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{isNew ? 'New alert' : 'Edit alert'}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  Hourly evaluation. Per-alert throttling: daily summary
                  fires once per 23 h, others at most once per 4 h.
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <form className="cpm-form" onSubmit={submit} autoComplete="off">

            <div className="cpm-section">
              <label className="po-field-label">Alert type</label>
              <Combobox value={type}
                options={ALERT_TYPES.map(t => ({ value: t.value, label: t.label }))}
                onChange={switchType} />
              <span className="cpm-section-hint">{meta.hint}</span>
            </div>

            {meta.thresholdLabel && (
              <div className="cpm-section">
                <label className="po-field-label">{meta.thresholdLabel}</label>
                <input className="crm-input" type="number"
                  placeholder={meta.thresholdPlaceholder}
                  value={threshold}
                  onChange={(e) => { setThreshold(e.target.value); setErr(''); }} />
              </div>
            )}

            <div className="cpm-section">
              <label className="po-field-label">Recipient email</label>
              <input className="crm-input" type="email"
                placeholder="ops@yourstore.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErr(''); }} />
              <span className="cpm-section-hint">
                Outbound via SES (ses.tortacrm.com). Bounces are not retried.
              </span>
            </div>

            {/* Active toggle — same styled checkbox as Edit target.
                `cat-prod-checkbox` + `po-include-cb` give it the blue
                CRM-wide check style. `po-wh-toggle-row` lays out the
                label + checkbox in one row. */}
            <div className="cpm-section">
              <label className="po-set-field po-set-field--toggle po-wh-toggle-row">
                <input type="checkbox" className="cat-prod-checkbox po-include-cb"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)} />
                <span className="po-set-toggle-text">Active</span>
              </label>
              <span className="cpm-section-hint">
                Muted alerts keep their history but stop firing until re-enabled.
              </span>
            </div>

            {err && <p className="auth-msg auth-msg--err">{err}</p>}

            <div className="auth-actions">
              <button className="crm-submit-btn" type="submit" disabled={busy}>
                {busy ? 'Saving…' : (isNew ? 'Create alert' : 'Save changes')}
              </button>
              <button className="crm-submit-btn auth-btn-secondary"
                type="button" disabled={busy} onClick={onClose}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default Alerts;
