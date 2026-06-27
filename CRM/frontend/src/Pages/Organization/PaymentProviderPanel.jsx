// Inner form panel for a single payment provider — rendered inside the AuthModal
// on the Org Payments page. Visual pattern copied 1:1 from OAuthProviderPanel.jsx:
//   • auth-toggle-row (Test/Live mode toggle)
//   • auth-sep divider
//   • auth-field + auth-label + auth-field-hint + crm-input
//   • auth-secret-wrap with Eye/EyeSlash toggle for secrets
//   • auth-actions row with Save / Test / Disconnect buttons
//
// Each provider has different required fields (defined server-side in
// payment_providers.PROVIDER_FIELDS, exposed via /payment-credentials GET).
// We render them dynamically from the catalog.

import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye, EyeSlash, Trash, ArrowSquareOut, CheckCircle, Warning, ArrowsClockwise,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { safeHttpUrl } from '../../Utils/safeUrl.js';
import Modal from '../../Elements/Modal.jsx';
import '../../Style/Feedback.css';

const MASKED_PLACEHOLDER = '••••••••';

// Console links per provider so merchant can quickly jump to "where do I get these keys".
const PROVIDER_CONSOLE = {
  stripe: { url: 'https://dashboard.stripe.com/apikeys', name: 'Stripe Dashboard' },
  kaspi_aipay: { url: 'https://cabinet.aipay.kz', name: 'AiPay Dashboard' },
  halyk_epay: { url: 'https://epayment.kz', name: 'Halyk ePay' },
  cloudpayments: { url: 'https://merchant.cloudpayments.kz', name: 'CloudPayments Cabinet' },
  robokassa: { url: 'https://partner.robokassa.kz', name: 'Robokassa Cabinet' },
  paypal: { url: 'https://developer.paypal.com/dashboard/applications', name: 'PayPal Developer Dashboard' },
};

// Free-form hint keys (resolved via t('org.payments.panel.hint.<key>')).


export default function PaymentProviderPanel({ provider, orgId, onSaved, onClose }) {
  const { t } = useTranslation();
  const providerKey = provider.id;
  const consoleInfo = PROVIDER_CONSOLE[providerKey];

  // Loaded state
  const [data,     setData]     = useState(null);   // entire GET payload
  const [creds,    setCreds]    = useState({});      // dirty form values
  const [showSec,  setShowSec]  = useState({});      // {field_key: bool}
  const [testMode, setTestMode] = useState(true);
  const [accountLabel, setAccountLabel] = useState('');
  const [dashboardUrl, setDashboardUrl] = useState('');

  // UI state
  const [dirty,    setDirty]    = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err,      setErr]      = useState('');
  const [toast,    setToast]    = useState('');
  const toastTimer = useRef(null);

  // Beta "Report an issue" — reuses the global feedback pipe (POST /api/feedback,
  // kind=issue → crm_feedback → Admin replies via SES).
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMsg,  setReportMsg]  = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportErr,  setReportErr]  = useState('');

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  const load = useCallback(async () => {
    setErr('');
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/api/orgs/${orgId}/payment-settings`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/orgs/${orgId}/payment-credentials`, { credentials: 'include' }),
      ]);
      const s = sRes.ok ? await sRes.json() : null;
      const c = cRes.ok ? await cRes.json() : null;
      if (!c) { setErr(t('org.payments.panel.loadFailed')); return; }

      setData(c);
      setTestMode(!!c.is_test_mode);
      setAccountLabel(s?.account_label || '');
      setDashboardUrl(s?.dashboard_url || '');

      // Only seed credentials if the currently-stored provider matches the one
      // this modal represents. Otherwise show an empty form.
      if (c.provider === providerKey) {
        const seed = {};
        const masked = c.credentials_masked || {};
        for (const k of Object.keys(masked)) {
          if (k.endsWith('_present')) continue;
          seed[k] = masked[k] || '';
        }
        setCreds(seed);
      } else {
        setCreds({});
      }
      setDirty(false);
    } catch {
      setErr(t('org.payments.panel.networkError'));
    }
  }, [orgId, providerKey, t]);

  useEffect(() => { load(); }, [load]);

  const setField = (key, val) => {
    setCreds(prev => ({ ...prev, [key]: val }));
    setDirty(true);
  };

  // Save credentials (will also switch the org's payment_provider via PUT endpoint).
  const save = async () => {
    setSaving(true); setErr('');
    try {
      // Step 1 — write display preferences (account_label/dashboard_url) if changed
      await fetch(`${API_BASE}/api/orgs/${orgId}/payment-settings`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider:      providerKey,
          account_label: accountLabel,
          dashboard_url: dashboardUrl,
        }),
      });

      // Step 2 — write credentials (no real keys if manual/other; backend treats those as no-op)
      if (providerKey !== 'manual' && providerKey !== 'other') {
        const r = await fetch(`${API_BASE}/api/orgs/${orgId}/payment-credentials`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider:      providerKey,
            is_test_mode:  testMode,
            credentials:   creds,
          }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) { setErr(j?.detail || t('org.payments.panel.saveFailed')); return; }
      }
      showToast(t('org.payments.panel.saved'));
      setDirty(false);
      onSaved?.();
      await load();
    } catch {
      setErr(t('org.payments.panel.networkError'));
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${orgId}/payment-credentials/test`, {
        method: 'POST', credentials: 'include',
      });
      const j = await r.json().catch(() => null);
      if (j?.ok) showToast(t('org.payments.panel.connectedToast'));
      else       setErr(j?.error || t('org.payments.panel.connectionFailed'));
      await load();
      onSaved?.();
    } catch { setErr(t('org.payments.panel.networkError')); }
    finally { setTesting(false); }
  };

  const disconnect = async () => {
    if (!confirm(t('org.payments.panel.disconnectConfirm'))) return;
    setDeleting(true);
    try {
      await fetch(`${API_BASE}/api/orgs/${orgId}/payment-credentials`, {
        method: 'DELETE', credentials: 'include',
      });
      showToast(t('org.payments.panel.disconnected'));
      setCreds({});
      onSaved?.();
      await load();
    } finally { setDeleting(false); }
  };

  const startStripeConnect = async () => {
    const r = await fetch(
      `${API_BASE}/api/orgs/${orgId}/payment-credentials/oauth/stripe/start`,
      { credentials: 'include' }
    );
    if (r.ok) {
      const j = await r.json();
      // Validate the redirect target — only http(s) URLs are safe to
      // navigate to. Without this, if the OAuth start endpoint is ever
      // tricked into returning a hostile scheme (`javascript:...`), the
      // admin's browser would execute it in the CRM origin context.
      const safeDest = safeHttpUrl(j.redirect_url);
      if (safeDest) window.location.href = safeDest;
      else setErr(t('org.payments.panel.stripeInvalidRedirect'));
    } else {
      const j = await r.json().catch(() => null);
      setErr(j?.detail || t('org.payments.panel.stripeUnavailable'));
    }
  };

  const submitReport = async () => {
    const m = reportMsg.trim();
    if (!m) { setReportErr(t('org.payments.beta.errMessage')); return; }
    setReportBusy(true); setReportErr('');
    try {
      const r = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind:    'issue',
          subject: `Payment gateway (Beta): ${provider.label}`,
          message: m,
        }),
      });
      if (r.ok) {
        setReportOpen(false); setReportMsg('');
        showToast(t('org.payments.beta.thanks'));
      } else {
        const j = await r.json().catch(() => ({}));
        setReportErr(j.detail || t('org.payments.beta.failed'));
        setReportBusy(false);
      }
    } catch {
      setReportErr(t('org.payments.beta.failed'));
      setReportBusy(false);
    }
  };

  if (!data) return <p className="crm-placeholder">{t('org.payments.panel.loading')}</p>;

  const isManual = providerKey === 'manual' || providerKey === 'other';
  const isCurrentProvider = data.provider === providerKey;
  const isConnected = isCurrentProvider && data.is_connected;
  const fields = (data.provider_catalog || {})[providerKey] || [];
  const stripeConnectAvailable = !!data.stripe_connect_available;
  const connectMethod = isCurrentProvider ? (data.connect_method || 'manual') : 'manual';

  return (
    <>
      {provider.beta && (
        <div className="auth-beta-notice">
          <Warning weight="fill" className="auth-beta-icon" />
          <div className="auth-beta-text">
            <strong>{t('org.payments.beta.title')}</strong>
            <p>{t('org.payments.beta.body')}</p>
          </div>
          <button type="button" className="auth-btn-check auth-beta-btn"
            onClick={() => { setReportErr(''); setReportOpen(true); }}>
            {t('org.payments.beta.report')}
          </button>
        </div>
      )}

      {/* ── Connection status ── */}
      <div className="auth-toggle-row">
        <div>
          <span className="auth-toggle-label">
            {isConnected ? (
              <><CheckCircle size={16} weight="fill" style={{ color: 'var(--accent)', verticalAlign: '-3px' }} /> {t('org.payments.panel.connected')}</>
            ) : (isCurrentProvider ? t('org.payments.panel.configuredAwaitingTest') : t('org.payments.panel.notConfigured'))}
          </span>
          <p className="auth-field-hint">
            {t(`org.payments.panel.hint.${providerKey}`, { defaultValue: provider.blurb || providerKey })}
            {data.last_verified_at && isConnected && (
              <>{t('org.payments.panel.lastVerified', { date: new Date(data.last_verified_at).toLocaleString() })}</>
            )}
          </p>
        </div>
        {!isManual && (
          <label className="auth-toggle">
            <input type="checkbox" checked={!testMode}
              onChange={e => { setTestMode(!e.target.checked); setDirty(true); }} />
            <span className="auth-toggle-track" />
          </label>
        )}
      </div>
      {!isManual && (
        <p className="auth-field-hint" style={{ marginTop: -8 }}>
          {t('org.payments.panel.modeNotePre')}<strong>{testMode ? t('org.payments.panel.modeTest') : t('org.payments.panel.modeLive')}</strong>{t('org.payments.panel.modeNoteMid')}
          {testMode
            ? t('org.payments.panel.modeTestHint')
            : t('org.payments.panel.modeLiveHint')}
        </p>
      )}

      <div className="auth-sep" />

      {data.last_error && !isConnected && (
        <p className="auth-msg auth-msg--err">
          <Warning weight="duotone" /> {t('org.payments.panel.lastError', { error: data.last_error })}
        </p>
      )}

      {/* ── Stripe Connect shortcut ── */}
      {providerKey === 'stripe' && stripeConnectAvailable && connectMethod !== 'oauth' && (
        <div style={{ padding: 12, background: 'var(--accent-tint)', borderRadius: 12,
                       fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>
            <strong>{t('org.payments.panel.stripeRecommendedBold')}</strong>{t('org.payments.panel.stripeRecommended')}
          </span>
          <button type="button" className="auth-btn-check" onClick={startStripeConnect}>
            {t('org.payments.panel.connectWithStripe')}
          </button>
        </div>
      )}
      {providerKey === 'stripe' && connectMethod === 'oauth' && (
        <p className="auth-msg auth-msg--ok">
          <CheckCircle size={14} weight="fill" /> {t('org.payments.panel.connectedViaOAuthPre')}
          <code>{data.stripe_account_id}</code>
        </p>
      )}

      {/* ── Display preferences (apply to Returns refund step) ── */}
      <div className="auth-field">
        <label className="auth-label">{t('org.payments.panel.accountLabel')}</label>
        <p className="auth-field-hint">
          {t('org.payments.panel.accountLabelHint')}
        </p>
        <input className="crm-input" type="text"
          placeholder={t('org.payments.panel.accountLabelPlaceholder')}
          value={accountLabel}
          onChange={e => { setAccountLabel(e.target.value); setDirty(true); }}
          autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">{t('org.payments.panel.dashboardUrl')}</label>
        <p className="auth-field-hint">
          {t('org.payments.panel.dashboardUrlHint')}
        </p>
        <input className="crm-input" type="url"
          placeholder={consoleInfo?.url || 'https://...'}
          value={dashboardUrl}
          onChange={e => { setDashboardUrl(e.target.value); setDirty(true); }}
          autoComplete="off" />
      </div>

      {/* ── Per-provider credential fields ── */}
      {!isManual && fields.length > 0 && (
        <>
          <div className="auth-sep" />

          {!data.encryption_ok && (
            <p className="auth-msg auth-msg--err">
              {t('org.payments.panel.encryptionMissing')}
            </p>
          )}

          {fields.map(field => (
            <div key={field.key} className="auth-field">
              <label className="auth-label">
                {field.label}
                {field.required && <span style={{ color: 'var(--accent)' }}> *</span>}
              </label>
              {field.secret ? (
                <div className="auth-secret-wrap">
                  <input className="crm-input"
                    type={showSec[field.key] ? 'text' : 'password'}
                    placeholder={field.placeholder || ''}
                    value={creds[field.key] || ''}
                    onChange={e => setField(field.key, e.target.value)}
                    autoComplete="new-password" spellCheck={false} />
                  <button type="button" className="auth-eye-btn"
                    onClick={() => setShowSec(prev => ({ ...prev, [field.key]: !prev[field.key] }))}>
                    {showSec[field.key] ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              ) : (
                <input className="crm-input"
                  type="text"
                  placeholder={field.placeholder || ''}
                  value={creds[field.key] || ''}
                  onChange={e => setField(field.key, e.target.value)}
                  autoComplete="off" spellCheck={false} />
              )}
              {creds[field.key]?.startsWith?.(MASKED_PLACEHOLDER) && (
                <p className="auth-field-hint" style={{ marginTop: 4 }}>
                  {t('org.payments.panel.savedValue')}
                </p>
              )}
            </div>
          ))}
        </>
      )}

      {err && <p className="auth-msg auth-msg--err">{err}</p>}

      {/* ── Actions ── */}
      <div className="auth-actions">
        <button type="button" className="crm-submit-btn"
          disabled={saving || !dirty || (!isManual && !data.encryption_ok)}
          onClick={save}>
          {saving ? t('org.payments.panel.saving') : t('org.payments.panel.save')}
        </button>
        {!isManual && (
          <button type="button" className="auth-btn-check"
            disabled={testing || dirty || !isCurrentProvider}
            onClick={test}
            title={dirty ? t('org.payments.panel.saveFirst') : (!isCurrentProvider ? t('org.payments.panel.saveCredsFirst') : '')}>
            <ArrowsClockwise size={14} />
            {testing ? t('org.payments.panel.testing') : t('org.payments.panel.testConnection')}
          </button>
        )}
        {isCurrentProvider && data.credentials_masked && Object.keys(data.credentials_masked).filter(k => !k.endsWith('_present')).length > 0 && (
          <button type="button" className="auth-btn-danger"
            disabled={deleting} onClick={disconnect}>
            <Trash size={15} />
            {deleting ? t('org.payments.panel.disconnecting') : t('org.payments.panel.disconnect')}
          </button>
        )}
        {consoleInfo && (
          <a href={consoleInfo.url} target="_blank" rel="noopener noreferrer"
            className="auth-btn-link" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
            <ArrowSquareOut size={14} /> {t('org.payments.panel.openConsole', { name: consoleInfo.name })}
          </a>
        )}
      </div>

      {reportOpen && (
        <Modal
          onClose={() => setReportOpen(false)}
          title={t('org.payments.beta.modalTitle')}
          subtitle={t('org.payments.beta.modalSubtitle', { name: provider.label })}
          maxWidth={520}
        >
          <div className="fb-form">
            <textarea
              className="fb-textarea" rows={5} maxLength={5000} autoFocus
              placeholder={t('org.payments.beta.placeholder')}
              value={reportMsg} onChange={e => setReportMsg(e.target.value)}
            />
            {reportErr && <div className="fb-err">{reportErr}</div>}
            <div className="fb-actions">
              <button type="button" className="fb-cancel" onClick={() => setReportOpen(false)}>
                {t('org.payments.beta.cancel')}
              </button>
              <button type="button" className="fb-submit" disabled={reportBusy} onClick={submitReport}>
                {reportBusy ? t('org.payments.beta.sending') : t('org.payments.beta.send')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </>
  );
}
