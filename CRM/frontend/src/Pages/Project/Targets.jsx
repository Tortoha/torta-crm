// Targets page — set numeric KPIs (revenue, orders, signups, etc.), see
// real-time progress, get notified when a target is hit. Used to be called
// "Goals" internally; renamed to match the user-facing "Targets" label.
//
// Layout follows the PromoCodes / Batches pattern exactly:
//   page title + hint  →  full toolbar (search + sort + status filter +
//   view toggle [grid/list] + New target button)  →  filtered/sorted body
//   that renders either list rows (po-set-table) or grid cards.
//
// Backend stays at /api/goals/* (renaming the API would break existing
// webhooks; the frontend label change is harmless).

import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Target, Plus, Pencil, Trash, CheckCircle, Warning, X, ChartLineUp,
  DotsThreeOutline, MagnifyingGlass, ArrowDown, SquaresFour, List,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { formatMoney } from '../../Utils/currency.js';
import { Combobox } from './Booking/BookingCreateModal.jsx';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import '../../Style/Authentication.css';
import '../../Style/Organization.css';   // .org-toolbar, .org-search-*, .org-sort-*, .org-view-*, .org-new-btn
import '../../Style/Products.css';        // .po-block-hint, .po-set-table, .po-set-row, .po-cb-wrap
import '../../Style/Targets.css';

// ── Target type catalog (mirrors GOAL_TYPES in CRM backend) ─────────────
// `tkey` resolves label + hint via i18n at render.
const TARGET_TYPES = [
  { value: 'revenue',              tkey: 'revenue',            unit: 'money'   },
  { value: 'orders_count',         tkey: 'ordersCount',        unit: 'count'   },
  { value: 'new_customers',        tkey: 'newCustomers',       unit: 'count'   },
  { value: 'signups',              tkey: 'signups',            unit: 'count'   },
  { value: 'avg_order_value',      tkey: 'avgOrderValue',      unit: 'money'   },
  { value: 'conversion_rate',      tkey: 'conversionRate',     unit: 'percent' },
  { value: 'return_rate_max',      tkey: 'returnRateMax',      unit: 'percent', inverse: true },
  { value: 'bookings_count',       tkey: 'bookingsCount',      unit: 'count'   },
  { value: 'avg_rating',           tkey: 'avgRating',          unit: 'rating'  },
  { value: 'repeat_purchase_rate', tkey: 'repeatPurchaseRate', unit: 'percent' },
  { value: 'custom_event_count',   tkey: 'customEventCount',   unit: 'count'   },
];
const TYPE_BY_VALUE = Object.fromEntries(TARGET_TYPES.map(t => [t.value, t]));
const typeLabel = (t, v) => {
  const m = TYPE_BY_VALUE[v];
  return m ? t(`project.targets.type.${m.tkey}`) : v;
};
const typeHint = (t, v) => {
  const m = TYPE_BY_VALUE[v];
  return m ? t(`project.targets.typeHint.${m.tkey}`) : '';
};

// Period codes → i18n key.
const PERIOD_KEYS = [
  { value: '1d',       pkey: '1d' },
  { value: '1w',       pkey: '1w' },
  { value: '1mo',      pkey: '1mo' },
  { value: 'season',   pkey: 'season' },
  { value: '1y',       pkey: '1y' },
  { value: 'all_time', pkey: 'allTime' },
];
const periodLabel = (t, v) => {
  const m = PERIOD_KEYS.find(p => p.value === v);
  return m ? t(`project.targets.period.${m.pkey}`) : v;
};

// Status code → cls/icon (+ skey for label).
const STATUS_META = {
  achieved:  { skey: 'achieved', cls: 't-status--achieved',  icon: CheckCircle },
  on_track:  { skey: 'onTrack',  cls: 't-status--on-track',  icon: ChartLineUp },
  behind:    { skey: 'behind',   cls: 't-status--behind',    icon: Warning     },
  at_risk:   { skey: 'atRisk',   cls: 't-status--at-risk',   icon: Warning     },
  inactive:  { skey: 'inactive', cls: 't-status--behind',    icon: Warning     },
};
const statusLabel = (t, status) => t(`project.targets.status.${(STATUS_META[status] || STATUS_META.on_track).skey}`);

// Computed pill state — when the user mutes a target (is_active = false),
// the backend's auto-computed `status` ("on_track" / "behind" / etc.) is
// misleading because nothing is being evaluated. Override with INACTIVE.
function pillFor(target) {
  if (!target.is_active) return STATUS_META.inactive;
  return STATUS_META[target.status] || STATUS_META.on_track;
}

// Toolbar dropdown — keep it short. Active / Inactive is the core toggle
// that matters for most workflows; "Achieved" is a useful subset (active
// AND progress hit target). Old on-track / behind / at-risk values are
// computed signals that overlap and confuse — dropped from the filter.
const SORT_DEFAULT_DIR = { date: 'desc', name: 'asc', progress: 'desc' };

// ── Currency-aware value formatter ─────────────────────────────────────
let __TARGETS_CURRENCY = 'USD';
const setTargetsCurrency = (c) => { __TARGETS_CURRENCY = c || 'USD'; };
function fmtValue(v, unit) {
  const n = +v || 0;
  if (unit === 'money')   return formatMoney(n, __TARGETS_CURRENCY);
  if (unit === 'percent') return `${n.toFixed(1)}%`;
  if (unit === 'rating')  return `★ ${n.toFixed(2)}`;
  return n.toLocaleString('en-US');
}

// ── Sort toggle ────────────────────────────────────────────────────────
// Identical to PromoCodes' SortToggle — sliding pill indicator follows
// hover, falls back to active field. Direction arrow only renders for
// the active field.
function SortToggle({ sort, onSort }) {
  const { t } = useTranslation();
  const SORT_OPTIONS = [
    { field: 'date',     label: t('project.targets.sortByDate')     },
    { field: 'name',     label: t('project.targets.sortByName')     },
    { field: 'progress', label: t('project.targets.sortByProgress') },
  ];
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

// ── 3-dot menu — exact PromoMenu pattern from PromoCodes ───────────────
// Portal-mounted dropdown anchored to the trigger button via
// `getBoundingClientRect()`. Uses the same `.org-card-dropdown` /
// `.org-card-dropdown-item` styles so menus look identical across
// Targets / PromoCodes / Batches / Products. Esc / outside-click closes.
function TargetMenu({ btnRef, onClose, isActive, onEdit, onToggle, onDelete }) {
  const { t } = useTranslation();
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
        <Pencil className="org-card-dropdown-icon" /> {t('project.targets.edit')}
      </button>
      {/* Active/Inactive quick-toggle — saves a round-trip through the
          full edit modal when the merchant just wants to pause/resume a
          target. Same UX as Mute/Activate on the Alerts page. */}
      <button className="org-card-dropdown-item"
        onClick={() => { onClose(); onToggle(); }}>
        <Target className="org-card-dropdown-icon" />
        {isActive ? t('project.targets.setInactive') : t('project.targets.setActive')}
      </button>
      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger"
        onClick={() => { onClose(); onDelete(); }}>
        <Trash className="org-card-dropdown-icon" /> {t('project.targets.delete')}
      </button>
    </div>,
    document.body,
  );
}

// ── Helpers shared between row + card ──────────────────────────────────
function progressPct(t) {
  const p = t.progress || { current: 0, target: 1 };
  return Math.min(100, (p.current / Math.max(p.target, 1)) * 100);
}

// ── List row (compact tabular view) ────────────────────────────────────
// Mirrors PromoRow shape — PoListRow gives us the consistent grid line,
// then we render the cells: name (+ status pill inline) / type / period /
// current/target / progress bar / status / menu.
function TargetListRow({ target, onEdit, onDelete, onToggle }) {
  const { t } = useTranslation();
  const type   = TYPE_BY_VALUE[target.goal_type] || { unit: 'count' };
  const status = pillFor(target);
  const StatusIcon = status.icon;
  const p = target.progress || { current: 0, target: 1 };
  const pct = progressPct(target);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);

  return (
    <PoListRow className="po-set-row--target" frozen={menuOpen}
      onClick={() => onEdit()} style={{ cursor: 'pointer' }}>
      <span className="po-set-strong" style={{ minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {target.name}
        </span>
      </span>
      <span>{typeLabel(t, target.goal_type)}</span>
      <span>{periodLabel(t, target.period)}</span>
      {/* Merged progress cell: "9 / 10" + inline thin bar + "90%". Renders
          as one visual unit instead of two adjacent siblings — keeps the
          row alignment clean even on narrow viewports. */}
      <span className="t-row-progress">
        <span className="t-row-progress-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <b>{fmtValue(p.current, type.unit)}</b>
          <span style={{ color: 'var(--muted)' }}> / {fmtValue(p.target, type.unit)}</span>
        </span>
        <span className="t-row-progress-track">
          <span className={`t-progress-fill t-progress-fill--${target.status}`}
            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
        </span>
        <span className="t-row-progress-pct">{pct.toFixed(0)}%</span>
      </span>
      <span>
        <span className={`t-status ${status.cls}`}>
          <StatusIcon size={11} weight="fill" /> {t(`project.targets.status.${status.skey}`)}
        </span>
      </span>
      <button ref={menuBtnRef} type="button" className="org-list-menu-btn"
        aria-label={t('project.targets.options')}
        onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <TargetMenu btnRef={menuBtnRef}
          onClose={() => setMenuOpen(false)}
          isActive={target.is_active}
          onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} />
      )}
    </PoListRow>
  );
}

// ── Grid card (visual progress view) ───────────────────────────────────
// Bigger, more visual variant for the grid view — the 34-px focal value
// sits over a thin progress track. Hover lifts the card 1 px.
function TargetGridCard({ target, onEdit, onDelete, onToggle }) {
  const { t } = useTranslation();
  const type   = TYPE_BY_VALUE[target.goal_type] || { unit: 'count' };
  const status = pillFor(target);
  const StatusIcon = status.icon;
  const p = target.progress || { current: 0, target: 1 };
  const pct = progressPct(target);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);

  return (
    <div className={`t-card t-card--${target.status}`}
      onClick={() => onEdit()}>
      <div className="t-card-head">
        <div className="t-card-title-wrap">
          <div className="t-card-icon-wrap">
            <Target weight="duotone" className="t-card-icon" />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="t-card-title">{target.name}</h3>
            <div className="t-card-sub">
              <span>{typeLabel(t, target.goal_type)}</span>
              <span className="t-card-sub-dot" />
              <span>{periodLabel(t, target.period)}</span>
            </div>
          </div>
        </div>
        <div className="t-card-actions" onClick={(e) => e.stopPropagation()}>
          <span className={`t-status ${status.cls}`}>
            <StatusIcon size={11} weight="fill" /> {t(`project.targets.status.${status.skey}`)}
          </span>
          <button ref={menuBtnRef} type="button" className="org-list-menu-btn"
            aria-label={t('project.targets.options')}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
            <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
          </button>
          {menuOpen && (
            <TargetMenu btnRef={menuBtnRef}
              onClose={() => setMenuOpen(false)}
              isActive={target.is_active}
              onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} />
          )}
        </div>
      </div>

      <div className="t-card-progress">
        <div className="t-progress-row">
          <div className="t-progress-numbers">
            <span className="t-progress-current">{fmtValue(p.current, type.unit)}</span>
            <span className="t-progress-target">/ {fmtValue(p.target, type.unit)}</span>
          </div>
          <span className="t-progress-pct">{pct.toFixed(1)}%</span>
        </div>
        <div className="t-progress-track">
          <div className={`t-progress-fill t-progress-fill--${target.status}`}
            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
        </div>
      </div>
    </div>
  );
}

// ── Create / Edit target modal ─────────────────────────────────────────
function TargetModal({ target, projectId, onClose, onSaved }) {
  const { t } = useTranslation();
  const isEdit = !!target;
  const pq = `?project_id=${projectId}`;
  const [form, setForm] = useState({
    name:               target?.name              || '',
    description:        target?.description       || '',
    goal_type:          target?.goal_type         || 'revenue',
    target_value:       target?.target_value      ?? '',
    period:             target?.period            || '1mo',
    custom_event_name:  target?.custom_event_name || '',
    is_active:          target?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.name.trim()) { setErr(t('project.targets.modal.nameRequired')); return; }
    if (!form.target_value || +form.target_value <= 0) {
      setErr(t('project.targets.modal.targetPositive')); return;
    }
    if (form.goal_type === 'custom_event_count' && !form.custom_event_name.trim()) {
      setErr(t('project.targets.modal.customEventRequired')); return;
    }
    setSaving(true); setErr('');
    const url = isEdit
      ? `${API_BASE}/api/goals/${target.id}${pq}`
      : `${API_BASE}/api/goals${pq}`;
    try {
      const r = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:              form.name.trim(),
          description:       form.description.trim() || null,
          goal_type:         form.goal_type,
          target_value:      parseFloat(form.target_value),
          period:            form.period,
          custom_event_name: form.goal_type === 'custom_event_count'
            ? form.custom_event_name.trim() : null,
          is_active:         form.is_active,
        }),
      });
      if (r.ok) onSaved();
      else {
        const j = await r.json().catch(() => ({}));
        setErr(j.detail || t('project.targets.modal.saveFailed'));
      }
    } finally { setSaving(false); }
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{isEdit ? t('project.targets.modal.editTitle') : t('project.targets.modal.newTitle')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {isEdit
                    ? t('project.targets.modal.editSubtitle', { name: target.name })
                    : t('project.targets.modal.newSubtitle')}
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
              <label className="po-field-label">{t('project.targets.modal.name')}</label>
              <input className="crm-input" autoFocus maxLength={120}
                placeholder={t('project.targets.modal.namePlaceholder')}
                value={form.name} onChange={e => set('name', e.target.value)} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('project.targets.modal.description')}</label>
              <textarea className="crm-input cpm-textarea" rows={2} maxLength={1000}
                placeholder={t('project.targets.modal.descriptionPlaceholder')}
                value={form.description} onChange={e => set('description', e.target.value)} />
            </div>

            <div className="po-wh-grid">
              <div className="cpm-section">
                <label className="po-field-label">{t('project.targets.modal.type')}</label>
                <Combobox value={form.goal_type}
                  options={TARGET_TYPES.map(tt => ({ value: tt.value, label: typeLabel(t, tt.value) }))}
                  onChange={v => set('goal_type', v)} />
                <span className="cpm-section-hint">
                  {typeHint(t, form.goal_type)}
                </span>
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('project.targets.modal.targetValue')}</label>
                <input className="crm-input" type="number" min="0" step="any"
                  value={form.target_value}
                  onChange={e => set('target_value', e.target.value)}
                  placeholder="10000" />
              </div>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">{t('project.targets.modal.period')}</label>
              <Combobox value={form.period}
                options={PERIOD_KEYS.map(p => ({ value: p.value, label: periodLabel(t, p.value) }))}
                onChange={v => set('period', v)} />
              <span className="cpm-section-hint">
                {t('project.targets.modal.periodHint')}
              </span>
            </div>

            {form.goal_type === 'custom_event_count' && (
              <div className="cpm-section">
                <label className="po-field-label">{t('project.targets.modal.customEventName')}</label>
                <input className="crm-input" maxLength={120}
                  placeholder={t('project.targets.modal.customEventPlaceholder')}
                  value={form.custom_event_name}
                  onChange={e => set('custom_event_name', e.target.value)} />
                <span className="cpm-section-hint">
                  {t('project.targets.modal.customEventHintPrefix')}<code>client.track.goal("name")</code>{t('project.targets.modal.customEventHintSuffix')}
                </span>
              </div>
            )}

            <div className="cpm-section">
              <label className="po-set-field po-set-field--toggle po-wh-toggle-row">
                <input type="checkbox" className="cat-prod-checkbox po-include-cb"
                  checked={form.is_active}
                  onChange={e => set('is_active', e.target.checked)} />
                <span className="po-set-toggle-text">{t('project.targets.modal.active')}</span>
              </label>
              <span className="cpm-section-hint">
                {t('project.targets.modal.activeHint')}
              </span>
            </div>

            {err && <p className="auth-msg auth-msg--err">{err}</p>}

            <div className="auth-actions">
              <button type="submit" className="crm-submit-btn" disabled={saving}>
                {saving ? t('project.targets.modal.saving') : (isEdit ? t('project.targets.modal.saveChanges') : t('project.targets.modal.create'))}
              </button>
              <button type="button" className="crm-submit-btn auth-btn-secondary"
                onClick={onClose}>{t('project.targets.modal.cancel')}</button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Main page ──────────────────────────────────────────────────────────
export default function Targets() {
  const { t } = useTranslation();
  const { projectId, project } = useOutletContext();
  const STATUS_FILTER_OPTIONS = [
    { value: 'all',       label: t('project.targets.statusAll') },
    { value: 'active',    label: t('project.targets.statusActive') },
    { value: 'inactive',  label: t('project.targets.statusInactive') },
    { value: 'achieved',  label: t('project.targets.statusAchieved') },
  ];
  useEffect(() => { setTargetsCurrency(project?.currency || 'USD'); }, [project?.currency]);
  const pq = `?project_id=${projectId}`;

  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  // Toolbar state — same shape as PromoCodes for consistency.
  const [search, setSearch]   = useState('');
  const [statusF, setStatusF] = useState('all');
  const [sort,   setSort]     = useState({ field: 'date', dir: 'desc' });
  const [view,   setView]     = useState('list');
  const [viewHover, setViewHover] = useState(null);
  const curView = viewHover ?? view;

  const load = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/goals${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setTargets)
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [projectId]);

  const onDelete = async (target) => {
    if (!confirm(t('project.targets.confirmDelete', { name: target.name }))) return;
    await fetch(`${API_BASE}/api/goals/${target.id}${pq}`,
      { method: 'DELETE', credentials: 'include' });
    load();
  };

  // Quick toggle of is_active — saves a round trip through the full
  // edit modal. PUT echoes the existing target with the flipped flag;
  // backend recomputes progress and status on the next evaluator tick.
  const onToggle = async (g) => {
    await fetch(`${API_BASE}/api/goals/${g.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:              g.name,
        description:       g.description || null,
        goal_type:         g.goal_type,
        target_value:      g.target_value,
        period:            g.period,
        custom_event_name: g.custom_event_name || null,
        is_active:         !g.is_active,
      }),
    });
    load();
  };

  const handleSetSort = (field) => {
    setSort(prev => ({
      field,
      dir: field === prev.field
        ? (prev.dir === 'asc' ? 'desc' : 'asc')
        : (SORT_DEFAULT_DIR[field] || 'desc'),
    }));
  };

  // Filter + sort. Same pattern as PromoCodes.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filt = targets.filter(t => {
      if (q && !(t.name || '').toLowerCase().includes(q)) return false;
      // Simple is_active boolean filter + special "achieved" subset.
      if (statusF === 'active'   && !t.is_active) return false;
      if (statusF === 'inactive' &&  t.is_active) return false;
      if (statusF === 'achieved' && (t.status !== 'achieved')) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    filt.sort((a, b) => {
      let av, bv;
      if (sort.field === 'name') {
        av = (a.name || '').toLowerCase();
        bv = (b.name || '').toLowerCase();
      } else if (sort.field === 'progress') {
        av = progressPct(a); bv = progressPct(b);
      } else {
        av = a.created_at || ''; bv = b.created_at || '';
      }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return filt;
  }, [targets, search, statusF, sort]);

  return (
    <>
      <h1 className="crm-page-title">{t('project.targets.title')}</h1>

      <p className="po-block-hint">
        {t('project.targets.hintPrefix')}<code className="po-api-code">goal.achieved</code>{t('project.targets.hintSuffix')}
      </p>

      {/* Full toolbar — same shape as PromoCodes / Batches:
          search · sort · status filter · view toggle · New button. */}
      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder={t('project.targets.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <SortToggle sort={sort} onSort={handleSetSort} />

        <div className="po-cb-wrap po-cb-wrap--toolbar" style={{ width: 180, minWidth: 180 }}>
          <Combobox value={statusF} options={STATUS_FILTER_OPTIONS}
            onChange={(v) => setStatusF(v)} />
        </div>

        {/* Grid / List view toggle — slide indicator follows hover. */}
        <div className="org-view-toggle" onMouseLeave={() => setViewHover(null)}>
          <div className="org-view-indicator"
            style={{ transform: `translateX(${curView === 'list' ? 30 : 0}px)` }} />
          <button className={`org-view-btn${curView === 'grid' ? ' org-view-btn--current' : ''}`}
            onClick={() => setView('grid')} onMouseEnter={() => setViewHover('grid')}
            title={t('project.targets.gridView')} type="button">
            <SquaresFour className="org-view-icon" />
          </button>
          <button className={`org-view-btn${curView === 'list' ? ' org-view-btn--current' : ''}`}
            onClick={() => setView('list')} onMouseEnter={() => setViewHover('list')}
            title={t('project.targets.listView')} type="button">
            <List className="org-view-icon" />
          </button>
        </div>

        <button type="button" className="org-new-btn" onClick={() => setEditing({})}>
          <Plus className="org-new-icon" /> {t('project.targets.newTarget')}
        </button>
      </div>

      {loading ? (
        <div className="crm-placeholder">{t('project.targets.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="crm-placeholder">
          {search || statusF !== 'all'
            ? t('project.targets.emptyFiltered')
            : t('project.targets.empty')}
        </div>
      ) : view === 'list' ? (
        // ── List view ─ tabular rows mirror PromoCodes' .po-set-table ──
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head po-set-row--target">
            <span>{t('project.targets.colName')}</span>
            <span>{t('project.targets.colType')}</span>
            <span>{t('project.targets.colPeriod')}</span>
            <span>{t('project.targets.colProgress')}</span>
            <span>{t('project.targets.colStatus')}</span>
            <span />
          </div>
          {filtered.map(t => (
            <TargetListRow key={t.id} target={t}
              onEdit={() => setEditing(t)}
              onToggle={() => onToggle(t)}
              onDelete={() => onDelete(t)} />
          ))}
        </div>
      ) : (
        // ── Grid view ─ visual cards in a CSS grid, 2 per row at 1100+ ──
        <div className="t-grid">
          {filtered.map(t => (
            <TargetGridCard key={t.id} target={t}
              onEdit={() => setEditing(t)}
              onToggle={() => onToggle(t)}
              onDelete={() => onDelete(t)} />
          ))}
        </div>
      )}

      {editing !== null && (
        <TargetModal target={editing.id ? editing : null} projectId={projectId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </>
  );
}
