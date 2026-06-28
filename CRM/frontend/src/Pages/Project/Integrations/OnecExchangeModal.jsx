// Config panel for the two-way 1С:Предприятие (CommerceML) exchange.
// Talks to GET/PUT /api/1c-exchange. 1C is the active party — here the merchant
// just flips it on, sets the login/password 1C will authenticate with, and
// copies the exchange URL to paste into 1C's "Обмен с сайтом" node. Beta until
// live-validated against a real 1C; the Report-an-issue button reuses the same
// feedback pipe as the payment-gateway Beta panels (POST /api/feedback).

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, FloppyDisk, Copy, CheckCircle, Warning, Eye, EyeSlash,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { CONNECTOR_BY_TYPE } from './connectors.js';
import ConnectorIcon from './ConnectorIcon.jsx';
import Modal from '../../../Elements/Modal.jsx';
import '../../../Style/Feedback.css';

export default function OnecExchangeModal({ projectId, onClose, onToast }) {
  const { t } = useTranslation();
  const meta = CONNECTOR_BY_TYPE['onec_exchange'] || {};
  const pq = `?project_id=${projectId}`;

  const [data,     setData]   = useState(null);
  const [isActive, setActive] = useState(false);
  const [login,    setLogin]  = useState('');
  const [password, setPw]     = useState('');
  const [showPw,   setShowPw] = useState(false);
  const [busy,     setBusy]   = useState(false);
  const [err,      setErr]    = useState('');
  const [copied,   setCopied] = useState(false);

  // Beta "Report an issue" — same pipe as the payment-gateway Beta panels.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMsg,  setReportMsg]  = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportErr,  setReportErr]  = useState('');

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const load = useCallback(async () => {
    setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/1c-exchange${pq}`, { credentials: 'include' });
      if (!res.ok) { setErr(t('integrations.onec.loadFailed')); return; }
      const d = await res.json();
      setData(d);
      setActive(!!d.is_active);
      setLogin(d.login || '');
      setPw('');   // never seed the password back into the form
    } catch {
      setErr(t('integrations.onec.networkError'));
    }
  }, [projectId, t]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { is_active: isActive, login: login.trim() };
      if (password.trim()) body.password = password.trim();
      const res = await fetch(`${API_BASE}/api/1c-exchange${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.detail || t('integrations.onec.saveFailed'));
      } else {
        onToast?.(t('integrations.onec.saved'));
        setPw('');
        await load();
      }
    } catch {
      setErr(t('integrations.onec.networkError'));
    } finally { setBusy(false); }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(data?.exchange_url || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the field is selectable as a fallback */ }
  };

  const submitReport = async () => {
    const m = reportMsg.trim();
    if (!m) { setReportErr(t('integrations.onec.beta.errMessage')); return; }
    setReportBusy(true); setReportErr('');
    try {
      const r = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'issue', subject: '1C exchange (Beta)', message: m }),
      });
      if (r.ok) {
        setReportOpen(false); setReportMsg('');
        onToast?.(t('integrations.onec.beta.thanks'));
      } else {
        const j = await r.json().catch(() => ({}));
        setReportErr(j.detail || t('integrations.onec.beta.failed'));
        setReportBusy(false);
      }
    } catch {
      setReportErr(t('integrations.onec.beta.failed'));
      setReportBusy(false);
    }
  };

  const fmt = (iso) => iso ? new Date(iso).toLocaleString() : t('integrations.onec.never');
  const cat = data?.stats?.catalog || {};
  const off = data?.stats?.offers  || {};
  const hasStats = (cat.categories || cat.products_created || cat.products_updated || off.offers);

  return createPortal(
    <>
      <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
        <div className="auth-modal">
          <div className="auth-modal-head">
            <div className="auth-modal-title-row">
              <div className="auth-modal-icon-wrap"><ConnectorIcon icon={meta.icon} /></div>
              <div>
                <div className="auth-modal-title">{t('integrations.onec.title')}</div>
                <div className="auth-modal-subtitle-row">
                  <span className="auth-modal-subtitle">{t('integrations.onec.subtitle')}</span>
                  <span className="auth-badge-beta">Beta</span>
                </div>
              </div>
            </div>
            <button className="auth-modal-close" onClick={onClose} type="button">
              <X className="auth-modal-close-icon" />
            </button>
          </div>

          <div className="auth-modal-body">
            {/* ── Beta notice ── */}
            <div className="auth-beta-notice">
              <Warning weight="fill" className="auth-beta-icon" />
              <div className="auth-beta-text">
                <strong>{t('integrations.onec.beta.title')}</strong>
                <p>{t('integrations.onec.beta.body')}</p>
              </div>
              <button type="button" className="auth-btn-check auth-beta-btn"
                onClick={() => { setReportErr(''); setReportOpen(true); }}>
                {t('integrations.onec.beta.report')}
              </button>
            </div>

            {!data && !err && <p className="crm-placeholder">{t('integrations.onec.loading')}</p>}

            {data && (
              <>
                {/* ── Enable ── */}
                <div className="auth-toggle-row">
                  <div>
                    <span className="auth-toggle-label">{t('integrations.onec.enable')}</span>
                    <p className="auth-field-hint">{t('integrations.onec.enableHint')}</p>
                  </div>
                  <label className="auth-toggle">
                    <input type="checkbox" checked={isActive} onChange={e => setActive(e.target.checked)} />
                    <span className="auth-toggle-track" />
                  </label>
                </div>

                <div className="auth-sep" />

                {/* ── Credentials 1C will authenticate with ── */}
                <div className="auth-field">
                  <label className="auth-label">{t('integrations.onec.login')}</label>
                  <p className="auth-field-hint">{t('integrations.onec.loginHint')}</p>
                  <input className="crm-input" type="text" value={login} autoComplete="off"
                    spellCheck={false} placeholder="1c" onChange={e => setLogin(e.target.value)} />
                </div>
                <div className="auth-field">
                  <label className="auth-label">{t('integrations.onec.password')}</label>
                  <p className="auth-field-hint">{t('integrations.onec.passwordHint')}</p>
                  <div className="auth-secret-wrap">
                    <input className="crm-input" type={showPw ? 'text' : 'password'} value={password}
                      autoComplete="new-password" spellCheck={false}
                      placeholder={data.has_password ? `•••••••• · ${t('integrations.onec.passwordKept')}` : ''}
                      onChange={e => setPw(e.target.value)} />
                    <button type="button" className="auth-eye-btn" onClick={() => setShowPw(v => !v)}>
                      {showPw ? <EyeSlash size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* ── Exchange URL to paste into 1C ── */}
                <div className="auth-field">
                  <label className="auth-label">{t('integrations.onec.url')}</label>
                  <p className="auth-field-hint">{t('integrations.onec.urlHint')}</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                    <input className="crm-input" type="text" readOnly
                      style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: 12 }}
                      value={data.exchange_url || ''} onFocus={e => e.target.select()} />
                    <button type="button" className="auth-btn-check" style={{ flexShrink: 0 }} onClick={copyUrl}>
                      {copied
                        ? <><CheckCircle size={14} weight="fill" /> {t('integrations.onec.copied')}</>
                        : <><Copy size={14} /> {t('integrations.onec.copy')}</>}
                    </button>
                  </div>
                </div>

                {/* ── Status ── */}
                <div className="auth-sep" />
                <div className="po-wh-section-label">{t('integrations.onec.statusTitle')}</div>
                <div className="an-margin-totals" style={{ marginTop: 4 }}>
                  <div className="an-kpi">
                    <span className="an-kpi-label">{t('integrations.onec.lastImport')}</span>
                    <span className="an-kpi-value an-kpi-value--small">{fmt(data.last_import_at)}</span>
                  </div>
                  <div className="an-kpi">
                    <span className="an-kpi-label">{t('integrations.onec.lastExport')}</span>
                    <span className="an-kpi-value an-kpi-value--small">{fmt(data.last_export_at)}</span>
                  </div>
                  <div className="an-kpi">
                    <span className="an-kpi-label">{t('integrations.onec.lastStatus')}</span>
                    <span className="an-kpi-value an-kpi-value--small">{data.last_status || '—'}</span>
                  </div>
                </div>
                {hasStats ? (
                  <p className="auth-field-hint" style={{ marginTop: 8 }}>
                    {t('integrations.onec.statsLine', {
                      cats:    cat.categories       || 0,
                      created: cat.products_created || 0,
                      updated: cat.products_updated || 0,
                      offers:  off.offers           || 0,
                    })}
                  </p>
                ) : null}
                {data.last_error && (
                  <p className="auth-msg auth-msg--err" style={{ marginTop: 8 }}>
                    <Warning weight="duotone" /> {data.last_error}
                  </p>
                )}

                {/* ── How to connect in 1C ── */}
                <div className="auth-sep" />
                <div className="po-wh-section-label">{t('integrations.onec.howTitle')}</div>
                <ol className="acc-steps">
                  <li>{t('integrations.onec.how1')}</li>
                  <li>{t('integrations.onec.how2')}</li>
                  <li>{t('integrations.onec.how3')}</li>
                </ol>

                {err && <p className="auth-msg auth-msg--err">{err}</p>}

                <div className="auth-actions">
                  <button type="button" className="crm-submit-btn" disabled={busy} onClick={save}>
                    <FloppyDisk size={14} weight="bold" />
                    {busy ? t('integrations.onec.saving') : t('integrations.onec.save')}
                  </button>
                </div>
              </>
            )}
            {err && !data && <p className="auth-msg auth-msg--err">{err}</p>}
          </div>
        </div>
      </div>

      {reportOpen && (
        <Modal onClose={() => setReportOpen(false)}
          title={t('integrations.onec.beta.modalTitle')}
          subtitle={t('integrations.onec.beta.modalSubtitle')} maxWidth={520}>
          <div className="fb-form">
            <textarea className="fb-textarea" rows={5} maxLength={5000} autoFocus
              placeholder={t('integrations.onec.beta.placeholder')}
              value={reportMsg} onChange={e => setReportMsg(e.target.value)} />
            {reportErr && <div className="fb-err">{reportErr}</div>}
            <div className="fb-actions">
              <button type="button" className="fb-cancel" onClick={() => setReportOpen(false)}>
                {t('integrations.onec.beta.cancel')}
              </button>
              <button type="button" className="fb-submit" disabled={reportBusy} onClick={submitReport}>
                {reportBusy ? t('integrations.onec.beta.sending') : t('integrations.onec.beta.send')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>,
    document.body,
  );
}
