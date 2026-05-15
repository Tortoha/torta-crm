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
import {
  Eye, EyeSlash, Trash, ArrowSquareOut, CheckCircle, Warning, ArrowsClockwise,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';

const MASKED_PLACEHOLDER = '••••••••';

// Console links per provider so merchant can quickly jump to "where do I get these keys".
const PROVIDER_CONSOLE = {
  stripe:        { url: 'https://dashboard.stripe.com/apikeys',         label: 'Open Stripe Dashboard' },
  tinkoff:       { url: 'https://business.tbank.ru/oplata/dashboard',   label: 'Open Tinkoff Business' },
  cloudpayments: { url: 'https://merchant.cloudpayments.ru/',           label: 'Open CloudPayments Dashboard' },
  yookassa:      { url: 'https://yookassa.ru/my',                       label: 'Open YooKassa Dashboard' },
  paypal:        { url: 'https://developer.paypal.com/dashboard',       label: 'Open PayPal Developer' },
  adyen:         { url: 'https://ca-test.adyen.com/ca/ca/config/api_credentials_new.shtml',
                                                                          label: 'Open Adyen Customer Area' },
  braintree:     { url: 'https://sandbox.braintreegateway.com/login',   label: 'Open Braintree Sandbox' },
  square:        { url: 'https://developer.squareup.com/apps',          label: 'Open Square Developer Dashboard' },
  mollie:        { url: 'https://my.mollie.com/dashboard/developers/api-keys',
                                                                          label: 'Open Mollie API Keys' },
  razorpay:      { url: 'https://dashboard.razorpay.com/app/keys',      label: 'Open Razorpay Dashboard' },
  paddle:        { url: 'https://sandbox-vendors.paddle.com/authentication',
                                                                          label: 'Open Paddle Authentication' },
  paybox:        { url: 'https://paybox.money/lk/',                     label: 'Open PayBox.money Dashboard' },
};

// Free-form hint shown in the modal header for each provider.
const PROVIDER_HINT = {
  stripe:        'Process card payments globally. Test mode keys work without real money.',
  tinkoff:       'Российский эквайринг от Т-Банка. Terminal_key + password из личного кабинета.',
  cloudpayments: 'Российская платёжная система. Public ID safe to embed in storefront; api_secret stays server-side.',
  yookassa:      'YooKassa (бывш. Яндекс.Касса). Один из самых популярных RU-провайдеров.',
  paypal:        'PayPal Orders v2 API. Sandbox keys → test accounts; live keys → real money.',
  adyen:         'Adyen Unified Commerce platform. Use test API key for sandbox, then switch to live. HMAC key signs webhooks.',
  braintree:     'PayPal Braintree GraphQL API. Sandbox merchant_id starts with letters; live ids look different. Webhooks signed via private_key.',
  square:        'Square Connect APIs. Use sandbox access_token (EAAAEy…) for testing; webhook_signature_key signs notifications.',
  mollie:        'Mollie supports iDEAL, Bancontact, SEPA, cards. API key prefix (test_/live_) selects the mode automatically. Webhooks unsigned — we re-fetch payment status to verify.',
  razorpay:      'Razorpay for India + South Asia. key_id is safe to expose on the frontend; key_secret stays on backend. Webhook secret signs notifications with HMAC-SHA256.',
  paddle:        'Paddle Billing (new API). Merchant of record — handles VAT/tax globally. Catalog products usually required; non-catalog mode works for ad-hoc cart amounts.',
  paybox:        'PayBox.money — Kazakhstan-focused acquiring. Supports KZT cards, KaspiPay, EasyPay. Signature-based auth (SHA1 over sorted params + secret_key).',
  manual:        'No API. Orders recorded as payment_status="manual", refunds are record-only — you process money externally (cash / bank transfer).',
  other:         'For providers we haven\'t integrated. You\'ll need to manually record references in the Returns workflow.',
};


export default function PaymentProviderPanel({ provider, orgId, onSaved, onClose }) {
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
      if (!c) { setErr('Failed to load credentials'); return; }

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
      setErr('Network error');
    }
  }, [orgId, providerKey]);

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
        if (!r.ok) { setErr(j?.detail || 'Save failed'); return; }
      }
      showToast('Saved');
      setDirty(false);
      onSaved?.();
      await load();
    } catch {
      setErr('Network error');
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${orgId}/payment-credentials/test`, {
        method: 'POST', credentials: 'include',
      });
      const j = await r.json().catch(() => null);
      if (j?.ok) showToast('Connected ✓');
      else       setErr(j?.error || 'Connection failed');
      await load();
      onSaved?.();
    } catch { setErr('Network error'); }
    finally { setTesting(false); }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect this payment provider? Stored credentials will be erased.')) return;
    setDeleting(true);
    try {
      await fetch(`${API_BASE}/api/orgs/${orgId}/payment-credentials`, {
        method: 'DELETE', credentials: 'include',
      });
      showToast('Disconnected');
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
      if (j.redirect_url) window.location.href = j.redirect_url;
    } else {
      const j = await r.json().catch(() => null);
      setErr(j?.detail || 'Stripe Connect unavailable');
    }
  };

  if (!data) return <p className="crm-placeholder">Loading…</p>;

  const isManual = providerKey === 'manual' || providerKey === 'other';
  const isCurrentProvider = data.provider === providerKey;
  const isConnected = isCurrentProvider && data.is_connected;
  const fields = (data.provider_catalog || {})[providerKey] || [];
  const stripeConnectAvailable = !!data.stripe_connect_available;
  const connectMethod = isCurrentProvider ? (data.connect_method || 'manual') : 'manual';

  return (
    <>
      {/* ── Connection status ── */}
      <div className="auth-toggle-row">
        <div>
          <span className="auth-toggle-label">
            {isConnected ? (
              <><CheckCircle size={16} weight="fill" style={{ color: 'var(--accent)', verticalAlign: '-3px' }} /> Connected</>
            ) : (isCurrentProvider ? 'Configured · awaiting test' : 'Not configured')}
          </span>
          <p className="auth-field-hint">
            {PROVIDER_HINT[providerKey]}
            {data.last_verified_at && isConnected && (
              <> · Last verified {new Date(data.last_verified_at).toLocaleString()}</>
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
          Toggle is currently in <strong>{testMode ? 'Test' : 'Live'}</strong> mode.
          {testMode
            ? ' No real money will be charged — use the provider\'s test cards.'
            : ' Real card charges will be made. Switch to test mode for development.'}
        </p>
      )}

      <div className="auth-sep" />

      {data.last_error && !isConnected && (
        <p className="auth-msg auth-msg--err">
          <Warning weight="duotone" /> Last error: {data.last_error}
        </p>
      )}

      {/* ── Stripe Connect shortcut ── */}
      {providerKey === 'stripe' && stripeConnectAvailable && connectMethod !== 'oauth' && (
        <div style={{ padding: 12, background: 'var(--accent-tint)', borderRadius: 12,
                       fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>
            <strong>Recommended:</strong> Connect via Stripe OAuth instead of pasting keys —
            safer + revocable from your Stripe dashboard.
          </span>
          <button type="button" className="auth-btn-check" onClick={startStripeConnect}>
            Connect with Stripe →
          </button>
        </div>
      )}
      {providerKey === 'stripe' && connectMethod === 'oauth' && (
        <p className="auth-msg auth-msg--ok">
          <CheckCircle size={14} weight="fill" /> Connected via Stripe OAuth · account{' '}
          <code>{data.stripe_account_id}</code>
        </p>
      )}

      {/* ── Display preferences (apply to Returns refund step) ── */}
      <div className="auth-field">
        <label className="auth-label">Account label (optional)</label>
        <p className="auth-field-hint">
          Shown to your team in the Returns refund step — e.g. "Torta Cakes — main account".
        </p>
        <input className="crm-input" type="text"
          placeholder="e.g. Torta Cakes — main account"
          value={accountLabel}
          onChange={e => { setAccountLabel(e.target.value); setDirty(true); }}
          autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">Dashboard URL (optional)</label>
        <p className="auth-field-hint">
          Quick link from the Returns modal to your provider's refund page.
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
              ⚠ Server encryption is not configured (PAYMENT_ENCRYPTION_KEY missing in .env).
              Credentials cannot be saved.
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
                  Saved value. Type a new one to replace.
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
          {saving ? 'Saving…' : 'Save'}
        </button>
        {!isManual && (
          <button type="button" className="auth-btn-check"
            disabled={testing || dirty || !isCurrentProvider}
            onClick={test}
            title={dirty ? 'Save first' : (!isCurrentProvider ? 'Save credentials first' : '')}>
            <ArrowsClockwise size={14} />
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        )}
        {isCurrentProvider && data.credentials_masked && Object.keys(data.credentials_masked).filter(k => !k.endsWith('_present')).length > 0 && (
          <button type="button" className="auth-btn-danger"
            disabled={deleting} onClick={disconnect}>
            <Trash size={15} />
            {deleting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
        {consoleInfo && (
          <a href={consoleInfo.url} target="_blank" rel="noopener noreferrer"
            className="auth-btn-link" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
            <ArrowSquareOut size={14} /> {consoleInfo.label}
          </a>
        )}
      </div>

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </>
  );
}
