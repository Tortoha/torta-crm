// Goals / Targets page — set numeric KPIs (revenue, orders, signups, etc.),
// see real-time progress, get notified when targets are met.
//
// Layout: status-card per goal stacked vertically (one per row), with a
// "New goal" button at the top. Each card shows name + target + progress
// bar + on-track/behind/at-risk badge + edit/delete actions. Modal copies
// the New-promo-code modal exactly (cpm-modal pattern).

import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  Target, Plus, Pencil, Trash, CheckCircle, Warning, X, ChartLineUp,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { Combobox } from './Booking/BookingCreateModal.jsx';
import '../../Style/Authentication.css';
import '../../Style/Products.css';
import '../../Style/Goals.css';

// ── Goal type catalog (mirrors GOAL_TYPES in CRM backend) ───────────────
// Each entry has a friendly label + format hint for the UI (so the
// progress card knows "revenue should be money", "rate is percent" etc).
const GOAL_TYPES = [
  { value: 'revenue',              label: 'Revenue',               unit: 'money',   hint: 'Sum of paid order totals' },
  { value: 'orders_count',         label: 'Orders count',          unit: 'count',   hint: 'Number of non-cancelled orders' },
  { value: 'new_customers',        label: 'New customers',         unit: 'count',   hint: 'Customers whose first order is in this cycle' },
  { value: 'signups',              label: 'Signups',               unit: 'count',   hint: 'New user accounts created' },
  { value: 'avg_order_value',      label: 'Avg order value',       unit: 'money',   hint: 'Average order total' },
  { value: 'conversion_rate',      label: 'Conversion rate (%)',   unit: 'percent', hint: 'Paid orders / unique visitors × 100' },
  { value: 'return_rate_max',      label: 'Return rate ≤ (%)',     unit: 'percent', hint: 'Target is an UPPER bound — staying below is good', inverse: true },
  { value: 'bookings_count',       label: 'Bookings count',        unit: 'count',   hint: 'Non-cancelled service bookings' },
  { value: 'avg_rating',           label: 'Avg rating',            unit: 'rating',  hint: 'Mean product rating (0–5)' },
  { value: 'repeat_purchase_rate', label: 'Repeat-purchase rate %', unit: 'percent', hint: 'Customers with ≥2 orders this cycle' },
  { value: 'custom_event_count',   label: 'Custom event count',    unit: 'count',   hint: 'Fired from your storefront via client.track.goal()' },
];
const GOAL_TYPE_BY_VALUE = Object.fromEntries(GOAL_TYPES.map(t => [t.value, t]));

const PERIOD_OPTIONS = [
  { value: '1d',       label: '1 day'           },
  { value: '1w',       label: '1 week'          },
  { value: '1mo',      label: '1 month'         },
  { value: 'season',   label: '1 season (3 mo)' },
  { value: '1y',       label: '1 year'          },
  { value: 'all_time', label: 'Lifetime'        },
];

const STATUS_META = {
  achieved:  { label: 'Achieved',         cls: 'g-status--achieved',  icon: CheckCircle },
  on_track:  { label: 'On track',         cls: 'g-status--on-track',  icon: ChartLineUp },
  behind:    { label: 'Behind schedule',  cls: 'g-status--behind',    icon: Warning     },
  at_risk:   { label: 'At risk',          cls: 'g-status--at-risk',   icon: Warning     },
};

// ── Formatters per unit (money / percent / count / rating) ─────────────
function fmtValue(v, unit) {
  const n = +v || 0;
  if (unit === 'money')   return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  if (unit === 'percent') return `${n.toFixed(1)}%`;
  if (unit === 'rating')  return `★ ${n.toFixed(2)}`;
  return n.toLocaleString('en-US');
}

// ── Status card ────────────────────────────────────────────────────────
function GoalCard({ goal, onEdit, onDelete }) {
  const type   = GOAL_TYPE_BY_VALUE[goal.goal_type] || { unit: 'count', label: goal.goal_type };
  const status = STATUS_META[goal.status] || STATUS_META.on_track;
  const StatusIcon = status.icon;
  const p = goal.progress || { current: 0, target: 1, achieved: false };
  const pct = type.inverse
    ? Math.min(100, (p.current / Math.max(p.target, 1)) * 100)   // for return-rate-max: 100% = at target
    : Math.min(100, (p.current / Math.max(p.target, 1)) * 100);
  return (
    <div className={`g-card g-card--${goal.status}`}>
      <div className="g-card-head">
        <div className="g-card-title-wrap">
          <Target weight="duotone" className="g-card-icon" />
          <div>
            <h3 className="g-card-title">{goal.name}</h3>
            <div className="g-card-sub">
              {type.label} · {PERIOD_OPTIONS.find(p => p.value === goal.period)?.label || goal.period}
              {goal.custom_event_name && ` · event "${goal.custom_event_name}"`}
            </div>
          </div>
        </div>
        <div className="g-card-actions">
          <span className={`g-status ${status.cls}`}>
            <StatusIcon size={12} weight="fill" /> {status.label}
          </span>
          <button className="crm-icon-btn" onClick={() => onEdit(goal)}
            type="button" title="Edit">
            <Pencil className="crm-icon" />
          </button>
          <button className="crm-icon-btn crm-icon-btn--danger"
            onClick={() => onDelete(goal)}
            type="button" title="Delete">
            <Trash className="crm-icon" />
          </button>
        </div>
      </div>

      {goal.description && (
        <p className="g-card-description">{goal.description}</p>
      )}

      <div className="g-card-progress">
        <div className="g-progress-row">
          <span className="g-progress-current">{fmtValue(p.current, type.unit)}</span>
          <span className="g-progress-target">
            of {fmtValue(p.target, type.unit)} target
          </span>
        </div>
        <div className="g-progress-track">
          <div className={`g-progress-fill g-progress-fill--${goal.status}`}
            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
        </div>
        <div className="g-progress-meta">
          <span>{pct.toFixed(1)}% of target</span>
          {goal.last_achieved_at && (
            <span className="g-progress-achieved">
              ✓ Last hit {new Date(goal.last_achieved_at).toLocaleDateString('en-US',
                { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Create / Edit goal modal ───────────────────────────────────────────
function GoalModal({ goal, projectId, onClose, onSaved }) {
  const isEdit = !!goal;
  const pq = `?project_id=${projectId}`;
  const [form, setForm] = useState({
    name:               goal?.name               || '',
    description:        goal?.description        || '',
    goal_type:          goal?.goal_type          || 'revenue',
    target_value:       goal?.target_value       ?? '',
    period:             goal?.period             || '1mo',
    custom_event_name:  goal?.custom_event_name  || '',
    is_active:          goal?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.name.trim())       { setErr('Name is required'); return; }
    if (!form.target_value || +form.target_value <= 0) {
      setErr('Target value must be > 0'); return;
    }
    if (form.goal_type === 'custom_event_count' && !form.custom_event_name.trim()) {
      setErr('Custom event name is required for custom-event goals'); return;
    }
    setSaving(true); setErr('');
    const url = isEdit
      ? `${API_BASE}/api/goals/${goal.id}${pq}`
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
        setErr(j.detail || 'Failed to save');
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
              <div className="auth-modal-title">{isEdit ? 'Edit target' : 'New target'}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {isEdit
                    ? `Editing "${goal.name}" — progress is recomputed on save.`
                    : 'Numeric targets that fire push notifications when hit.'}
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
              <label className="po-field-label">Name *</label>
              <input className="crm-input" autoFocus maxLength={120}
                placeholder="Hit $10k in monthly revenue"
                value={form.name} onChange={e => set('name', e.target.value)} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Description</label>
              <textarea className="crm-input cpm-textarea" rows={2} maxLength={1000}
                placeholder="Why this goal matters (visible only to your team)"
                value={form.description} onChange={e => set('description', e.target.value)} />
            </div>

            <div className="po-wh-grid">
              <div className="cpm-section">
                <label className="po-field-label">Type *</label>
                <Combobox value={form.goal_type}
                  options={GOAL_TYPES.map(t => ({ value: t.value, label: t.label }))}
                  onChange={v => set('goal_type', v)} />
                <span className="cpm-section-hint">
                  {GOAL_TYPE_BY_VALUE[form.goal_type]?.hint}
                </span>
              </div>
              <div className="cpm-section">
                <label className="po-field-label">Target value *</label>
                <input className="crm-input" type="number" min="0" step="any"
                  value={form.target_value}
                  onChange={e => set('target_value', e.target.value)} />
              </div>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Period *</label>
              <Combobox value={form.period}
                options={PERIOD_OPTIONS}
                onChange={v => set('period', v)} />
              <span className="cpm-section-hint">
                Lifetime ("all-time") keeps counting forever; periodic resets
                each cycle and fires the webhook once per cycle.
              </span>
            </div>

            {form.goal_type === 'custom_event_count' && (
              <div className="cpm-section">
                <label className="po-field-label">Custom event name *</label>
                <input className="crm-input" maxLength={120}
                  placeholder="newsletter_signup"
                  value={form.custom_event_name}
                  onChange={e => set('custom_event_name', e.target.value)} />
                <span className="cpm-section-hint">
                  Your storefront fires <code>client.track.goal("name")</code> —
                  only events matching this exact name are counted.
                </span>
              </div>
            )}

            <div className="cpm-section">
              <label className="po-set-field po-set-field--toggle po-wh-toggle-row">
                <input type="checkbox" className="cat-prod-checkbox po-include-cb"
                  checked={form.is_active}
                  onChange={e => set('is_active', e.target.checked)} />
                <span className="po-set-toggle-text">Active</span>
              </label>
              <span className="cpm-section-hint">
                Inactive targets stop counting and won't fire achievement webhooks.
              </span>
            </div>

            {err && <p className="auth-msg auth-msg--err">{err}</p>}

            <div className="auth-actions">
              <button type="submit" className="crm-submit-btn" disabled={saving}>
                {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create target')}
              </button>
              <button type="button" className="crm-submit-btn auth-btn-secondary"
                onClick={onClose}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Main page ──────────────────────────────────────────────────────────
export default function Goals() {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;
  const [goals, setGoals]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // null | {} | {…existing}

  const load = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/goals${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setGoals)
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [projectId]);

  const onDelete = async (g) => {
    if (!confirm(`Delete goal "${g.name}"?`)) return;
    await fetch(`${API_BASE}/api/goals/${g.id}${pq}`,
      { method: 'DELETE', credentials: 'include' });
    load();
  };

  const sorted = useMemo(() => {
    const order = { at_risk: 0, behind: 1, on_track: 2, achieved: 3 };
    return [...goals].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [goals]);

  return (
    <>
      <h1 className="crm-page-title">Targets</h1>
      <div className="g-page">
        <div className="g-toolbar">
          <p className="g-toolbar-hint">
            Numeric KPIs with progress tracking. When a target is hit we fire
            a <code>goal.achieved</code> webhook + push notification.
          </p>
          <button className="org-new-btn" type="button" onClick={() => setEditing({})}>
            <Plus className="org-new-icon" /> New target
          </button>
        </div>

        {loading ? (
          <p className="crm-placeholder">Loading targets…</p>
        ) : goals.length === 0 ? (
          <div className="g-empty">
            <Target weight="duotone" className="g-empty-icon" />
            <h2 className="g-empty-title">No targets yet</h2>
            <p>Create your first target — track revenue, signups, conversion rate, or any custom event from your storefront.</p>
            <button className="crm-submit-btn" type="button" onClick={() => setEditing({})}>
              <Plus /> Create first target
            </button>
          </div>
        ) : (
          <div className="g-list">
            {sorted.map(g => (
              <GoalCard key={g.id} goal={g}
                onEdit={() => setEditing(g)}
                onDelete={() => onDelete(g)} />
            ))}
          </div>
        )}
      </div>

      {editing !== null && (
        <GoalModal goal={editing.id ? editing : null} projectId={projectId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </>
  );
}
