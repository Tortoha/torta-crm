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
  Eye, EyeSlash, Trash, ArrowSquareOut, CheckCircle, Warning, ArrowsClockwise, Copy,
} from '@phosphor-icons/react';
import { API_BASE, MAGAZ_BASE } from '../../api.js';
import { safeHttpUrl } from '../../Utils/safeUrl.js';
import Modal from '../../Elements/Modal.jsx';
import { Combobox } from '../Project/Booking/BookingCreateModal.jsx';
import '../../Style/Feedback.css';

const MASKED_PLACEHOLDER = '••••••••';

// Console links per provider so merchant can quickly jump to "where do I get these keys".
const PROVIDER_CONSOLE = {
  stripe: { url: 'https://dashboard.stripe.com/apikeys', name: 'Stripe Dashboard' },
  kaspi_aipay: { url: 'https://cabinet.aipay.kz', name: 'AiPay Dashboard' },
  apipay: { url: 'https://apipay.kz', name: 'ApiPay Dashboard' },
  halyk_epay: { url: 'https://epayment.kz', name: 'Halyk ePay' },
  cloudpayments: { url: 'https://merchant.tiptoppay.kz', name: 'TipTop Pay Cabinet' },
  robokassa: { url: 'https://partner.robokassa.kz', name: 'Robokassa Cabinet' },
  paypal: { url: 'https://developer.paypal.com/dashboard/applications', name: 'PayPal Developer Dashboard' },
};

// Free-form hint keys (resolved via t('org.payments.panel.hint.<key>')).

// Ready-to-paste URLs the merchant copies into the provider's own cabinet
// (redirect gateways with a server callback). Built from the project's api_key +
// site URL so the merchant never hand-types them. Keyed by provider id.
const CABINET_URLS = {
  robokassa: (proj) => {
    const base = (MAGAZ_BASE || '').replace(/\/+$/, '');
    const fe   = (proj.frontend_url || '').replace(/\/+$/, '');
    return [
      { key: 'home',    label: 'Homepage URL',      url: fe },
      { key: 'result',  label: 'Result URL · POST', url: `${base}/${proj.api_key}/payments/robokassa/result` },
      { key: 'success', label: 'Success URL',       url: fe ? `${fe}/checkout/return` : '' },
      { key: 'fail',    label: 'Fail URL',          url: fe ? `${fe}/checkout` : '' },
    ];
  },
  // ApiPay (Kaspi): one webhook URL the merchant pastes into the ApiPay dashboard
  // (Settings → Connection → Webhooks). Pre-filled with THIS project's api_key so
  // the merchant never hand-types it.
  apipay: (proj) => {
    const base = (MAGAZ_BASE || '').replace(/\/+$/, '');
    return [
      { key: 'webhook', label: 'Webhook URL · POST', url: `${base}/${proj.api_key}/payments/apipay/webhook` },
    ];
  },
};


export default function PaymentProviderPanel({ provider, orgId, method, onSaved, onClose }) {
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

  // Org projects → feed the ready-to-paste cabinet URLs (api_key + site URL).
  const [projects,  setProjects]  = useState([]);
  const [projIdx,   setProjIdx]   = useState(0);
  const [copiedKey, setCopiedKey] = useState('');

  // Active (is_enabled) — whether this gateway is OFFERED at checkout. A separate
  // switch from test/live mode; toggled instantly via PATCH /payment-methods so the
  // merchant can pause a gateway (e.g. if something's off) without deleting its keys.
  const [enabled,  setEnabled]  = useState(!!method?.is_enabled);
  const [enabling, setEnabling] = useState(false);
  useEffect(() => { setEnabled(!!method?.is_enabled); }, [method?.is_enabled]);

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
        fetch(`${API_BASE}/api/orgs/${orgId}/payment-credentials?provider=${providerKey}`, { credentials: 'include' }),
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

  // The org's projects — their api_key + frontend_url build the copy-paste
  // cabinet URLs (Result/Success/Fail) for redirect gateways like Robokassa.
  useEffect(() => {
    fetch(`${API_BASE}/api/orgs/${orgId}/projects`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(ps => setProjects(Array.isArray(ps) ? ps : []))
      .catch(() => {});
  }, [orgId]);

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
      const r = await fetch(`${API_BASE}/api/orgs/${orgId}/payment-credentials/test?provider=${providerKey}`, {
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

  // Active switch — instant enable/disable of the checkout method (is_enabled),
  // independent of credentials. Enabling requires connected creds (backend guard),
  // so the switch stays disabled until then. Optimistic, reverts on failure.
  const toggleEnabled = async (val) => {
    setEnabled(val); setErr(''); setEnabling(true);
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${orgId}/payment-methods/${providerKey}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: val }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setEnabled(!val);
        setErr(j?.detail || t('org.payments.panel.saveFailed'));
        return;
      }
      showToast(t('org.payments.panel.saved'));
      onSaved?.();
    } catch {
      setEnabled(!val);
      setErr(t('org.payments.panel.networkError'));
    } finally { setEnabling(false); }
  };

  const disconnect = async () => {
    if (!confirm(t('org.payments.panel.disconnectConfirm'))) return;
    setDeleting(true);
    try {
      await fetch(`${API_BASE}/api/orgs/${orgId}/payment-credentials?provider=${providerKey}`, {
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
  const cabinetProj   = projects.length ? projects[Math.min(projIdx, projects.length - 1)] : null;
  const cabinetRows   = (CABINET_URLS[providerKey] && cabinetProj) ? CABINET_URLS[providerKey](cabinetProj) : null;

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
      </div>

      {/* ── Switch 1: Active — is this gateway OFFERED at checkout (independent of mode) ── */}
      {!isManual && (
        <div className="auth-toggle-row">
          <div>
            <span className="auth-toggle-label">{t('org.payments.panel.active')}</span>
            <p className="auth-field-hint">
              {isConnected ? t('org.payments.panel.activeHint') : t('org.payments.panel.activeNeedsConnect')}
            </p>
          </div>
          <label className="auth-toggle"
            title={isConnected ? '' : t('org.payments.panel.activeNeedsConnect')}>
            <input type="checkbox" checked={enabled} disabled={!isConnected || enabling}
              onChange={e => toggleEnabled(e.target.checked)} />
            <span className="auth-toggle-track" />
          </label>
        </div>
      )}

      {/* ── Switch 2: Test mode — test ↔ live (applied on Save) ── */}
      {!isManual && (
        <div className="auth-toggle-row">
          <div>
            <span className="auth-toggle-label">{t('org.payments.panel.testModeLabel')}</span>
            <p className="auth-field-hint">
              {testMode ? t('org.payments.panel.modeTestHint') : t('org.payments.panel.modeLiveHint')}
            </p>
          </div>
          <label className="auth-toggle">
            <input type="checkbox" checked={testMode}
              onChange={e => { setTestMode(e.target.checked); setDirty(true); }} />
            <span className="auth-toggle-track" />
          </label>
        </div>
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

      {/* ── Ready-to-paste cabinet URLs (redirect gateways with a server callback) ── */}
      {cabinetRows && (
        <>
          <div className="auth-sep" />
          <div className="auth-field">
            <label className="auth-label">{t('org.payments.panel.cabinet.title', { name: provider.label })}</label>
            <p className="auth-field-hint">{t('org.payments.panel.cabinet.hint', { name: provider.label })}</p>
            {t('org.payments.panel.cabinet.purpose.' + providerKey, { defaultValue: '' })
              ? <p className="auth-field-hint">{t('org.payments.panel.cabinet.purpose.' + providerKey, { defaultValue: '' })}</p>
              : null}
            {projects.length > 1 && (
              <div style={{ marginBottom: 8 }}>
                <Combobox
                  value={String(projIdx)}
                  options={projects.map((p, i) => ({
                    value: String(i),
                    label: `${t('org.payments.panel.cabinet.store')}: ${p.name}`,
                  }))}
                  onChange={v => setProjIdx(Number(v))}
                  searchable={projects.length > 8}
                />
              </div>
            )}
            {cabinetRows.filter(r => r.url).map(r => (
              <div key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ width: 132, flexShrink: 0, fontSize: 12, color: 'var(--muted)' }}>{t('org.payments.panel.cabinet.urls.' + r.key, { defaultValue: r.label })}</span>
                <input className="crm-input" readOnly value={r.url} onFocus={e => e.target.select()}
                  style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: 12 }} />
                <button type="button" className="auth-btn-check" style={{ flexShrink: 0 }} disabled={!r.url}
                  onClick={async () => {
                    if (!r.url) return;
                    try {
                      await navigator.clipboard.writeText(r.url);
                      setCopiedKey(r.key);
                      setTimeout(() => setCopiedKey(''), 1600);
                    } catch { /* clipboard blocked — user can still select manually */ }
                  }}>
                  {copiedKey === r.key
                    ? <><CheckCircle size={13} weight="fill" /> {t('org.payments.panel.cabinet.copied')}</>
                    : <><Copy size={13} /> {t('org.payments.panel.cabinet.copy')}</>}
                </button>
              </div>
            ))}
            {cabinetProj && !cabinetProj.frontend_url && (
              <p className="auth-field-hint" style={{ marginTop: 4 }}>{t('org.payments.panel.cabinet.noSite')}</p>
            )}
          </div>
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
