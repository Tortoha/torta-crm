import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, DownloadSimple, PaperPlaneTilt, ArrowClockwise,
  CheckCircle, Warning, EnvelopeSimple, FloppyDisk, Trash,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { CONNECTOR_BY_TYPE } from './connectors.js';
import ConnectorIcon from './ConnectorIcon.jsx';
import { Combobox } from '../Booking/BookingCreateModal.jsx';
// PoListRow is the project-wide tilt+gloss row wrapper (used by Inventory,
// Tier pricing, Alerts, Promo Codes, etc.). Uses the strong tilt config
// (maxAngleX:10, scale:1.052, gloss-opacity:0.14) + the standard
// po-set-row:hover pill-rounding + shadow — looks identical to other
// tabular surfaces in the CRM rather than a watered-down modal variant.
import { PoListRow } from '../../../Utils/PoListRow.jsx';

// Modal for the 5 accounting connectors (1C / Kompra / QuickBooks / Xero / DATEV).
// Pulls preview JSON when period changes, lets the merchant download the file
// directly or set up a daily/weekly/monthly email schedule that delivers a
// signed download link to a chosen address.

const PERIOD_OPTIONS = [
  { value: 'today',        label: 'Today' },
  { value: 'yesterday',    label: 'Yesterday' },
  { value: 'last_7d',      label: 'Last 7 days' },
  { value: 'last_30d',     label: 'Last 30 days' },
  { value: 'this_month',   label: 'This month' },
  { value: 'last_month',   label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'custom',       label: 'Custom range…' },
];
const SCHEDULE_OPTIONS = [
  { value: 'off',     label: 'Off — manual downloads only' },
  { value: 'daily',   label: 'Daily — yesterday\'s orders' },
  { value: 'weekly',  label: 'Weekly — past 7 days' },
  { value: 'monthly', label: 'Monthly — previous month' },
];
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00 UTC`,
}));

function fmtMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(Number(amount) || 0);
  } catch {
    return `${currency || ''} ${(Number(amount) || 0).toFixed(2)}`.trim();
  }
}

export default function AccountingExportModal({
  projectId, sub, onClose, onSaved, onDeleted, onToast,
}) {
  const pq = `?project_id=${projectId}`;
  const meta = CONNECTOR_BY_TYPE[sub.type] || {};

  // Period + filter state — controls the preview pane and the download URL.
  const [period,        setPeriod]        = useState('last_30d');
  const [customStart,   setCustomStart]   = useState('');
  const [customEnd,     setCustomEnd]     = useState('');
  const [includeUnpaid, setIncludeUnpaid] = useState(
    Boolean(sub?.config?.include_unpaid));

  // Schedule state — persisted via PUT on Save.
  const cfg = sub?.config || {};
  const [name,        setName]        = useState(sub?.name || meta.name || '');
  const [schedule,    setSchedule]    = useState(cfg.schedule || 'off');
  const [scheduleHr,  setScheduleHr]  = useState(String(cfg.schedule_hour_utc ?? 6));
  const [emailTo,     setEmailTo]     = useState(sub?.url || '');
  const [isActive,    setIsActive]    = useState(sub?.is_active !== false);

  const [preview,     setPreview]     = useState(null);
  const [previewBusy, setPreviewBusy] = useState(true);
  const [previewErr,  setPreviewErr]  = useState('');
  const [busy,        setBusy]        = useState(false);
  const [err,         setErr]         = useState('');

  // Close on Escape — matches the rest of the modals.
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const loadPreview = useCallback(async () => {
    setPreviewBusy(true); setPreviewErr('');
    const params = new URLSearchParams({
      project_id: String(projectId),
      period,
      include_unpaid: String(includeUnpaid),
    });
    if (period === 'custom') {
      if (!customStart || !customEnd) {
        setPreview(null); setPreviewBusy(false);
        setPreviewErr('Pick both start and end dates for a custom range.');
        return;
      }
      params.set('start', customStart);
      params.set('end',   customEnd);
    }
    try {
      const res  = await fetch(
        `${API_BASE}/api/integrations/${sub.id}/accounting/preview?${params}`,
        { credentials: 'include' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setPreviewErr(j.detail || 'Preview failed');
        setPreview(null);
      } else {
        setPreview(await res.json());
      }
    } catch (e) { setPreviewErr(String(e)); }
    setPreviewBusy(false);
  }, [projectId, period, customStart, customEnd, includeUnpaid, sub.id]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const buildDownloadUrl = () => {
    const params = new URLSearchParams({
      project_id: String(projectId),
      period,
      include_unpaid: String(includeUnpaid),
    });
    if (period === 'custom') {
      params.set('start', customStart);
      params.set('end',   customEnd);
    }
    return `${API_BASE}/api/integrations/${sub.id}/accounting/download?${params}`;
  };

  const triggerDownload = () => {
    if (period === 'custom' && (!customStart || !customEnd)) {
      setErr('Pick both start and end dates for a custom range.');
      return;
    }
    setErr('');
    // Same-origin link — browser kicks the file because of Content-Disposition.
    window.location.assign(buildDownloadUrl());
  };

  const save = async () => {
    setErr(''); setBusy(true);
    try {
      if (schedule !== 'off' && !emailTo.includes('@')) {
        setErr('Set a recipient email or switch the schedule to Off.');
        setBusy(false); return;
      }
      const body = {
        name: name.trim() || meta.name,
        url:  emailTo.trim(),
        is_active: isActive,
        config: {
          schedule,
          schedule_hour_utc: Number(scheduleHr) || 6,
          include_unpaid: includeUnpaid,
          // Keep an existing last_sent_at intact so a config change doesn't
          // re-trigger a stale fire on the very next loop tick.
          ...(cfg.last_sent_at ? { last_sent_at: cfg.last_sent_at } : {}),
        },
      };
      const res = await fetch(`${API_BASE}/api/integrations/${sub.id}${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.detail || 'Save failed');
      } else {
        onSaved?.();
        onToast?.('Saved');
      }
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  const testSend = async () => {
    if (!emailTo.includes('@')) {
      setErr('Set a recipient email first.');
      return;
    }
    setErr(''); setBusy(true);
    try {
      const params = new URLSearchParams({ project_id: String(projectId), period });
      const res = await fetch(
        `${API_BASE}/api/integrations/${sub.id}/accounting/test-send?${params}`,
        { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.detail || 'Test send failed');
      } else {
        onToast?.(`Email sent to ${emailTo}`);
      }
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  const remove = async () => {
    if (!confirm('Delete this accounting integration? Past downloads aren\'t affected.')) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/integrations/${sub.id}${pq}`, {
        method: 'DELETE', credentials: 'include',
      });
      onDeleted?.();
    } finally { setBusy(false); }
  };

  // ── Render ──────────────────────────────────────────────

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal acc-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div className="auth-modal-icon-wrap">
              <ConnectorIcon icon={meta.icon} />
            </div>
            <div>
              <div className="auth-modal-title">{meta.name}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">{meta.description}</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body acc-body">
          <div className="acc-format-banner">
            <div className="acc-format-label">File format</div>
            <div className="acc-format-value">{meta.accountingFormat || 'CSV'}</div>
          </div>

          {/* ── Period ── section title is a bare label sitting OUTSIDE any
              card (po-wh-section-label pattern from New warehouse modal).
              Compose stays inline: Combobox + Include-unpaid on one row. */}
          <div className="po-wh-section-label">Period</div>
          <div className="acc-period-row">
            <div className="acc-field acc-field--grow">
              <Combobox value={period} options={PERIOD_OPTIONS}
                onChange={v => setPeriod(v)} />
            </div>
            <label className="po-set-field po-set-field--toggle po-wh-toggle-row acc-include-toggle">
              <input type="checkbox" className="cat-prod-checkbox po-include-cb"
                checked={includeUnpaid}
                onChange={e => setIncludeUnpaid(e.target.checked)} />
              <span className="po-set-toggle-text">Include unpaid / pending</span>
            </label>
          </div>
          {period === 'custom' && (
            <div className="acc-custom-range">
              <div className="cpm-section">
                <label className="po-field-label">Start</label>
                <input className="crm-input" type="date" value={customStart}
                  onChange={e => setCustomStart(e.target.value)} />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">End</label>
                <input className="crm-input" type="date" value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)} />
              </div>
            </div>
          )}

          {/* ── Preview ── label outside, KPI row + table below.
              Refresh button sits on the right of the section label. */}
          <div className="po-wh-section-label po-wh-section-label--row">
            <span>Preview</span>
            <button type="button" className="acc-refresh" onClick={loadPreview} disabled={previewBusy}>
              <ArrowClockwise size={12} /> Refresh
            </button>
          </div>
          {(preview || previewBusy || previewErr) && (
            <div className="an-margin-totals acc-stats-row">
              <div className="an-kpi">
                <span className="an-kpi-label">Orders</span>
                <span className="an-kpi-value">
                  {preview ? preview.orders : '—'}
                </span>
              </div>
              <div className="an-kpi">
                <span className="an-kpi-label">Revenue</span>
                <span className="an-kpi-value">
                  {preview ? fmtMoney(preview.revenue, preview.currency) : '—'}
                </span>
              </div>
              <div className="an-kpi">
                <span className="an-kpi-label">Window</span>
                <span className="an-kpi-value an-kpi-value--small">
                  {preview ? preview.period : (previewBusy ? 'Loading…' : '—')}
                </span>
              </div>
            </div>
          )}
          {previewBusy && !preview && <p className="acc-preview-loading">Loading preview…</p>}
          {previewErr && (
            <div className="acc-preview-err">
              <Warning size={14} /> {previewErr}
            </div>
          )}
          {preview && preview.preview?.length > 0 && (
            <>
              <div className="po-set-table acc-preview-pst">
                <div className="po-set-row po-set-row--head acc-preview-pst-row">
                  <span>Order</span>
                  <span>Date</span>
                  <span>Customer</span>
                  <span style={{ textAlign: 'right' }}>Items</span>
                  <span style={{ textAlign: 'right' }}>Amount</span>
                </div>
                {preview.preview.map(r => (
                  <PoListRow key={r.id} className="acc-preview-pst-row">
                    <span className="po-set-strong acc-mono">#{r.id}</span>
                    <span>{r.date ? new Date(r.date).toLocaleDateString() : '—'}</span>
                    <span title={r.customer_email}>
                      {r.customer_name || r.customer_email || '—'}
                    </span>
                    <span style={{ textAlign: 'right' }}>{r.items_count}</span>
                    <span style={{ textAlign: 'right' }} className="acc-mono">
                      {fmtMoney(r.total_amount, r.payment_currency)}
                    </span>
                  </PoListRow>
                ))}
              </div>
              {preview.orders > preview.preview.length && (
                <p className="acc-preview-foot">
                  Showing {preview.preview.length} of {preview.orders} orders. Download for the full file.
                </p>
              )}
            </>
          )}
          {preview && preview.preview?.length === 0 && (
            <p className="acc-preview-empty">No matching orders in this period.</p>
          )}

          {/* ── Email schedule ── 4 cpm-section blocks under a bare label. */}
          <div className="po-wh-section-label">Email schedule</div>

          <div className="cpm-section">
            <label className="po-field-label">Cadence</label>
            <Combobox value={schedule} options={SCHEDULE_OPTIONS}
              onChange={v => setSchedule(v)} />
            <span className="cpm-section-hint">
              When set, we email a signed download link on your cadence —
              file bytes themselves stay on the CRM and the link is valid for 30 days.
            </span>
          </div>

          {schedule !== 'off' && (
            <div className="cpm-section">
              <label className="po-field-label">Hour (UTC)</label>
              <Combobox value={scheduleHr} options={HOUR_OPTIONS}
                onChange={v => setScheduleHr(v)} />
            </div>
          )}

          <div className="cpm-section">
            <label className="po-field-label">Recipient email</label>
            <input className="crm-input" type="email" value={emailTo}
              placeholder="accountant@example.com"
              onChange={e => setEmailTo(e.target.value)} maxLength={200} />
            <span className="cpm-section-hint">
              Required only when the schedule is on. Leave blank for download-only.
            </span>
          </div>

          <div className="cpm-section">
            <label className="po-set-field po-set-field--toggle po-wh-toggle-row">
              <input type="checkbox" className="cat-prod-checkbox po-include-cb"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)} />
              <span className="po-set-toggle-text">Active</span>
            </label>
            <span className="cpm-section-hint">
              Disabled integrations stop receiving scheduled exports until re-enabled.
            </span>
          </div>

          {/* ── How to import ── steps directly under the label. */}
          {meta.setupSteps?.length > 0 && (
            <>
              <div className="po-wh-section-label">How to import in {meta.name}</div>
              <ol className="acc-steps">
                {meta.setupSteps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </>
          )}

          {err && <p className="auth-msg auth-msg--err">{err}</p>}

          <div className="auth-actions acc-actions">
            <button type="button" className="crm-submit-btn acc-btn-action"
              onClick={triggerDownload} disabled={busy || previewBusy || !preview || preview.orders === 0}>
              <DownloadSimple size={14} weight="bold" />
              <span>{preview ? `Download · ${preview.orders} order${preview.orders === 1 ? '' : 's'}` : 'Download'}</span>
            </button>
            <button type="button" className="auth-btn-check acc-btn-action"
              onClick={save} disabled={busy}>
              <FloppyDisk size={14} weight="bold" />
              <span>{busy ? 'Saving…' : 'Save schedule'}</span>
            </button>
            {emailTo && (
              <button type="button" className="auth-btn-check acc-btn-action"
                onClick={testSend} disabled={busy}>
                <PaperPlaneTilt size={14} weight="bold" />
                <span>Test send</span>
              </button>
            )}
            <button type="button" className="auth-btn-danger acc-btn-delete acc-btn-action"
              onClick={remove} disabled={busy}>
              <Trash size={14} weight="bold" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
