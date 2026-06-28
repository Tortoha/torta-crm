import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const PERIOD_OPTIONS = [
    { value: 'today',        label: t('integrations.accounting.period.today') },
    { value: 'yesterday',    label: t('integrations.accounting.period.yesterday') },
    { value: 'last_7d',      label: t('integrations.accounting.period.last7d') },
    { value: 'last_30d',     label: t('integrations.accounting.period.last30d') },
    { value: 'this_month',   label: t('integrations.accounting.period.thisMonth') },
    { value: 'last_month',   label: t('integrations.accounting.period.lastMonth') },
    { value: 'this_quarter', label: t('integrations.accounting.period.thisQuarter') },
    { value: 'custom',       label: t('integrations.accounting.period.custom') },
  ];
  const SCHEDULE_OPTIONS = [
    { value: 'off',     label: t('integrations.accounting.schedule.off') },
    { value: 'daily',   label: t('integrations.accounting.schedule.daily') },
    { value: 'weekly',  label: t('integrations.accounting.schedule.weekly') },
    { value: 'monthly', label: t('integrations.accounting.schedule.monthly') },
  ];
  const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
    value: String(h),
    label: t('integrations.accounting.hourLabel', { h: String(h).padStart(2, '0') }),
  }));
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
        setPreviewErr(t('integrations.accounting.pickBothDates'));
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
        setPreviewErr(j.detail || t('integrations.accounting.previewFailed'));
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
        setErr(t('integrations.accounting.setEmailOrOff'));
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
        setErr(j.detail || t('integrations.accounting.saveFailed'));
      } else {
        onSaved?.();
        onToast?.(t('integrations.accounting.saved'));
      }
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  const testSend = async () => {
    if (!emailTo.includes('@')) {
      setErr(t('integrations.accounting.setRecipientFirst'));
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
        setErr(j.detail || t('integrations.accounting.testSendFailed'));
      } else {
        onToast?.(t('integrations.accounting.emailSentTo', { email: emailTo }));
      }
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  const remove = async () => {
    if (!confirm(t('integrations.accounting.confirmDelete'))) return;
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
            <div className="acc-format-label">{t('integrations.accounting.fileFormat')}</div>
            <div className="acc-format-value">{meta.accountingFormat || 'CSV'}</div>
          </div>

          {/* File-export connectors (Kompra / QuickBooks / Xero / DATEV / …) have
              no live API — there's nothing to "connect". Spell that out up front,
              since it's the #1 point of confusion vs. the webhook / 1C connectors. */}
          <div style={{ padding: '10px 14px', background: 'var(--accent-tint)',
                        borderRadius: 12, fontSize: 13, lineHeight: 1.5,
                        color: 'var(--text)', marginBottom: 4 }}>
            {t('integrations.accounting.fileExportNote', { name: meta.name })}
          </div>

          {/* ── Period ── section title is a bare label sitting OUTSIDE any
              card (po-wh-section-label pattern from New warehouse modal).
              Compose stays inline: Combobox + Include-unpaid on one row. */}
          <div className="po-wh-section-label">{t('integrations.accounting.periodLabel')}</div>
          <div className="acc-period-row">
            <div className="acc-field acc-field--grow">
              <Combobox value={period} options={PERIOD_OPTIONS}
                onChange={v => setPeriod(v)} />
            </div>
            <label className="po-set-field po-set-field--toggle po-wh-toggle-row acc-include-toggle">
              <input type="checkbox" className="cat-prod-checkbox po-include-cb"
                checked={includeUnpaid}
                onChange={e => setIncludeUnpaid(e.target.checked)} />
              <span className="po-set-toggle-text">{t('integrations.accounting.includeUnpaid')}</span>
            </label>
          </div>
          {period === 'custom' && (
            <div className="acc-custom-range">
              <div className="cpm-section">
                <label className="po-field-label">{t('integrations.accounting.start')}</label>
                <input className="crm-input" type="date" value={customStart}
                  onChange={e => setCustomStart(e.target.value)} />
              </div>
              <div className="cpm-section">
                <label className="po-field-label">{t('integrations.accounting.end')}</label>
                <input className="crm-input" type="date" value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)} />
              </div>
            </div>
          )}

          {/* ── Preview ── label outside, KPI row + table below.
              Refresh button sits on the right of the section label. */}
          <div className="po-wh-section-label po-wh-section-label--row">
            <span>{t('integrations.accounting.preview')}</span>
            <button type="button" className="acc-refresh" onClick={loadPreview} disabled={previewBusy}>
              <ArrowClockwise size={12} /> {t('integrations.accounting.refresh')}
            </button>
          </div>
          {(preview || previewBusy || previewErr) && (
            <div className="an-margin-totals acc-stats-row">
              <div className="an-kpi">
                <span className="an-kpi-label">{t('integrations.accounting.orders')}</span>
                <span className="an-kpi-value">
                  {preview ? preview.orders : '—'}
                </span>
              </div>
              <div className="an-kpi">
                <span className="an-kpi-label">{t('integrations.accounting.revenue')}</span>
                <span className="an-kpi-value">
                  {preview ? fmtMoney(preview.revenue, preview.currency) : '—'}
                </span>
              </div>
              <div className="an-kpi">
                <span className="an-kpi-label">{t('integrations.accounting.window')}</span>
                <span className="an-kpi-value an-kpi-value--small">
                  {preview ? preview.period : (previewBusy ? t('integrations.accounting.loading') : '—')}
                </span>
              </div>
            </div>
          )}
          {previewBusy && !preview && <p className="acc-preview-loading">{t('integrations.accounting.loadingPreview')}</p>}
          {previewErr && (
            <div className="acc-preview-err">
              <Warning size={14} /> {previewErr}
            </div>
          )}
          {preview && preview.preview?.length > 0 && (
            <>
              <div className="po-set-table acc-preview-pst">
                <div className="po-set-row po-set-row--head acc-preview-pst-row">
                  <span>{t('integrations.accounting.colOrder')}</span>
                  <span>{t('integrations.accounting.colDate')}</span>
                  <span>{t('integrations.accounting.colCustomer')}</span>
                  <span style={{ textAlign: 'right' }}>{t('integrations.accounting.colItems')}</span>
                  <span style={{ textAlign: 'right' }}>{t('integrations.accounting.colAmount')}</span>
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
                  {t('integrations.accounting.showingOf', { shown: preview.preview.length, total: preview.orders })}
                </p>
              )}
            </>
          )}
          {preview && preview.preview?.length === 0 && (
            <p className="acc-preview-empty">{t('integrations.accounting.noMatchingOrders')}</p>
          )}

          {/* ── Email schedule ── 4 cpm-section blocks under a bare label. */}
          <div className="po-wh-section-label">{t('integrations.accounting.emailSchedule')}</div>

          <div className="cpm-section">
            <label className="po-field-label">{t('integrations.accounting.cadence')}</label>
            <Combobox value={schedule} options={SCHEDULE_OPTIONS}
              onChange={v => setSchedule(v)} />
            <span className="cpm-section-hint">
              {t('integrations.accounting.cadenceHint')}
            </span>
          </div>

          {schedule !== 'off' && (
            <div className="cpm-section">
              <label className="po-field-label">{t('integrations.accounting.hourUtc')}</label>
              <Combobox value={scheduleHr} options={HOUR_OPTIONS}
                onChange={v => setScheduleHr(v)} />
            </div>
          )}

          <div className="cpm-section">
            <label className="po-field-label">{t('integrations.accounting.recipientEmail')}</label>
            <input className="crm-input" type="email" value={emailTo}
              placeholder={t('integrations.accounting.recipientPlaceholder')}
              onChange={e => setEmailTo(e.target.value)} maxLength={200} />
            <span className="cpm-section-hint">
              {t('integrations.accounting.recipientHint')}
            </span>
          </div>

          <div className="cpm-section">
            <label className="po-set-field po-set-field--toggle po-wh-toggle-row">
              <input type="checkbox" className="cat-prod-checkbox po-include-cb"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)} />
              <span className="po-set-toggle-text">{t('integrations.accounting.active')}</span>
            </label>
            <span className="cpm-section-hint">
              {t('integrations.accounting.activeHint')}
            </span>
          </div>

          {/* ── How to import ── steps directly under the label. */}
          {meta.setupSteps?.length > 0 && (
            <>
              <div className="po-wh-section-label">{t('integrations.accounting.howToImport', { name: meta.name })}</div>
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
              <span>{preview ? t('integrations.accounting.downloadOrders', { count: preview.orders }) : t('integrations.accounting.download')}</span>
            </button>
            <button type="button" className="auth-btn-check acc-btn-action"
              onClick={save} disabled={busy}>
              <FloppyDisk size={14} weight="bold" />
              <span>{busy ? t('integrations.accounting.saving') : t('integrations.accounting.saveSchedule')}</span>
            </button>
            {emailTo && (
              <button type="button" className="auth-btn-check acc-btn-action"
                onClick={testSend} disabled={busy}>
                <PaperPlaneTilt size={14} weight="bold" />
                <span>{t('integrations.accounting.testSend')}</span>
              </button>
            )}
            <button type="button" className="auth-btn-danger acc-btn-delete acc-btn-action"
              onClick={remove} disabled={busy}>
              <Trash size={14} weight="bold" />
              <span>{t('integrations.accounting.delete')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
