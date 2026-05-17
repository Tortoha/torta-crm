import { useEffect, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Bell, Plus, Trash, PencilSimple, X, CheckCircle, Warning } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { Combobox } from './Booking/BookingCreateModal.jsx';
import '../../Style/Authentication.css';
import '../../Style/Booking.css';
import '../../Style/Organization.css';
import '../../Style/Alerts.css';

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

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

function Alerts() {
  const { projectId } = useOutletContext();
  const [alerts, setAlerts] = useState([]);
  const [fires,  setFires]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // null | 'new' | alert object
  const [toast,   setToast]   = useState('');

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

  return (
    <>
      <h1 className="crm-page-title">Alerts</h1>
      <p className="auth-page-subtitle">
        Email notifications triggered by metric thresholds. The
        evaluator runs every hour; per-alert throttling prevents spam
        when a condition stays violated.
      </p>

      <div className="crm-section">
        <div className="crm-section-row">
          <h3 className="crm-section-title">Active rules</h3>
          <button type="button" className="crm-add-btn"
            onClick={() => setEditing('new')}>
            <Plus weight="bold" /> New alert
          </button>
        </div>
        {loading ? (
          <p className="crm-placeholder">Loading…</p>
        ) : alerts.length === 0 ? (
          <p className="crm-placeholder">
            No alerts yet. Click <b>New alert</b> to add one — pick a metric,
            set the threshold, and we'll email you when it trips.
          </p>
        ) : (
          <div className="crm-cards-list">
            {alerts.map(a => (
              <div key={a.id} className="al-row">
                <div className="al-row-icon">
                  {a.is_active
                    ? <Bell weight="duotone" className="al-icon al-icon--on" />
                    : <Bell weight="regular" className="al-icon al-icon--off" />}
                </div>
                <div className="al-row-main">
                  <div className="al-row-title">{a.type_label}</div>
                  <div className="al-row-meta">
                    {typeMeta(a.type).thresholdLabel
                      ? <span>{typeMeta(a.type).thresholdLabel}: <b>{a.threshold}</b></span>
                      : <span>{typeMeta(a.type).hint}</span>}
                    {' · '}
                    <span>To: <b>{a.email}</b></span>
                    {a.last_fired_at && (
                      <span>{' · '}Last fired {fmtDateTime(a.last_fired_at)}</span>
                    )}
                  </div>
                </div>
                <div className="al-row-actions">
                  <button type="button" className="al-toggle"
                    onClick={() => handleToggle(a)}
                    title={a.is_active ? 'Mute' : 'Activate'}>
                    {a.is_active ? 'Mute' : 'Activate'}
                  </button>
                  <button type="button" className="crm-icon-btn"
                    onClick={() => setEditing(a)} title="Edit">
                    <PencilSimple weight="bold" />
                  </button>
                  <button type="button" className="crm-icon-btn crm-icon-btn--danger"
                    onClick={() => handleDelete(a.id)} title="Delete">
                    <Trash weight="bold" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="crm-section" style={{ marginTop: 24 }}>
        <h3 className="crm-section-title">Recent fires</h3>
        {fires.length === 0 ? (
          <p className="crm-placeholder">
            No fires yet — alerts haven't tripped or there's no history.
          </p>
        ) : (
          <div className="al-fires">
            {fires.map(f => (
              <div key={f.id} className="al-fire">
                <Warning weight="duotone" className="al-fire-icon" />
                <div className="al-fire-body">
                  <div className="al-fire-msg">{f.message}</div>
                  <div className="al-fire-meta">
                    {fmtDateTime(f.fired_at)} · alert #{f.alert_id}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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

            <div className="cpm-section">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)} />
                <span>Active</span>
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
