// Org-level Payments page — multi-method model (WooCommerce/Shopify style).
//
// Methods COEXIST and are toggled independently; the customer picks one at
// checkout. There is no single "active provider" any more.
//   • Stripe — the online card gateway. Connect once (API keys / Connect),
//     then the toggle turns card payments on. Money lands in the merchant's
//     own Stripe (non-custodial); checkout runs strict-mode PaymentIntents.
//   • Manual — cash / bank transfer / pay-on-delivery (record-only).
//   • Other  — any other gateway (Kaspi, own link): record-only with a custom
//     display name + customer-facing payment instructions.
//
// Visual pattern reused from Authentication.jsx (provider-row list + AuthModal).

import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CaretRight, X, Money, CheckCircle,
} from '@phosphor-icons/react';
import { Icon } from '@iconify/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import PaymentProviderPanel from './PaymentProviderPanel.jsx';
import '../../Style/Authentication.css';


const CATALOG = [
  { id: 'stripe',      label: 'Stripe', iconify: 'logos:stripe', online: true },
  // beta:true — wired + unit-tested but NOT yet live-tested end-to-end (only Stripe
  // is fully verified). Shows a "Beta" pill so the merchant knows to test first.
  { id: 'kaspi_aipay', label: 'Kaspi',  iconify: 'ph:wallet-fill', color: '#F14635', online: true,
    blurb: 'Kaspi payments via AiPay', beta: true },
  { id: 'halyk_epay',  label: 'Halyk (ePay)', iconify: 'ph:bank-fill', color: '#0AA5A8', online: true,
    blurb: 'Card payments via Halyk Bank ePay', beta: true },
  // TipTop Pay = the rebrand of CloudPayments KZ (cloudpayments.kz → tiptoppay.kz).
  // Internal id stays 'cloudpayments' (DB enums, routes, existing order snapshots).
  { id: 'cloudpayments', label: 'TipTop Pay (CloudPayments)', iconify: 'ph:credit-card-fill', color: '#0085D1', online: true,
    blurb: 'Card payments via TipTop Pay (ex-CloudPayments)', beta: true },
  { id: 'robokassa', label: 'Robokassa', iconify: 'ph:wallet-fill', color: '#7A3FF2', online: true,
    blurb: 'Card payments via Robokassa', beta: true },
  { id: 'paypal', label: 'PayPal', iconify: 'logos:paypal', online: true,
    blurb: 'PayPal — international buyers (USD/EUR; not KZT)', beta: true },
  { id: 'manual',      label: 'Manual', phosphor: Money },
];


// ── Icon helper (iconify logo → phosphor fallback) ───────────────────

const ProviderIcon = ({ provider, size = 24 }) =>
  provider.iconify
    ? <Icon icon={provider.iconify} width={size} height={size}
        style={provider.color ? { color: provider.color } : undefined} />
    : <provider.phosphor className="auth-provider-icon" />;


const ROW_TILT = {
  maxAngleX: 8, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.10, spread: 40 },
};


// ── Method row (icon + name + enable toggle + open-config chevron) ───

function MethodRow({ provider, method, connectedProviders, onOpen, first, last }) {
  const { t } = useTranslation();
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, false);

  const enabled   = !!method?.is_enabled;
  const isOnline  = !!provider.online;
  const connected = isOnline && connectedProviders.includes(provider.id);

  const cls = [
    'auth-provider-row',
    first && 'auth-provider-row--first',
    last  && 'auth-provider-row--last',
  ].filter(Boolean).join(' ');

  // Status badge only — toggling on/off happens INSIDE the modal (click the
  // row). Online gateways show their own connection state; offline methods
  // (manual/other) show enabled/off. Multi-gateway: each gateway is connected
  // independently, so several can be "Connected" at once and work together.
  const on   = isOnline ? (enabled && connected) : enabled;
  const desc = (isOnline && !connected)
    ? (provider.blurb || 'Connect to enable card payments')
    : (provider.blurb || method?.display_label || t(`org.payments.providers.${provider.id}`));
  const badgeLabel = isOnline
    ? (on ? 'Connected' : 'Not connected')
    : (on ? 'Enabled'   : 'Off');

  return (
    <div ref={ref} className={cls} {...handlers}
      onClick={() => onOpen(provider.id)} style={{ cursor: 'pointer' }}>
      <div ref={glossRef} className="auth-provider-gloss" />

      <div className="auth-provider-icon-wrap">
        <ProviderIcon provider={provider} size={24} />
      </div>

      <span className="auth-provider-name">
        {provider.label}
        {provider.beta && <span className="auth-badge-beta">Beta</span>}
      </span>
      <span className="auth-provider-desc">{desc}</span>

      {on
        ? <span className="auth-badge-enabled"><CheckCircle weight="fill" size={11} /> {badgeLabel}</span>
        : <span className="auth-badge-disabled">{badgeLabel}</span>}

      <CaretRight className="auth-provider-chevron" />
    </div>
  );
}


// ── Auth-style modal wrapper (same as Authentication.jsx AuthModal) ──

function PaymentModal({ provider, onClose, children }) {
  const { t } = useTranslation();
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div className="auth-modal-icon-wrap">
              <ProviderIcon provider={provider} size={32} />
            </div>
            <div>
              <div className="auth-modal-title">
                {provider.label}
                {provider.beta && <span className="auth-badge-beta">Beta</span>}
              </div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">{provider.blurb || t(`org.payments.providers.${provider.id}`)}</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}


// ── Offline-method config panel (manual / other) ─────────────────────
// Edits the display name + customer-facing payment instructions and lets the
// merchant enable/disable the method. Saves via PATCH /payment-methods/{method}.

function OfflineMethodPanel({ provider, orgId, method, onSaved }) {
  const [enabled,      setEnabled]      = useState(!!method?.is_enabled);
  const [label,        setLabel]        = useState(method?.display_label || '');
  const [instructions, setInstructions] = useState(method?.instructions || '');
  const [saving, setSaving] = useState(false);
  const [toast,  setToast]  = useState('');
  const toastTimer = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  const isOther = provider.id === 'other';

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/orgs/${orgId}/payment-methods/${provider.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: enabled, display_label: label, instructions }),
      });
      showToast('Saved');
      onSaved?.();
    } finally { setSaving(false); }
  };

  return (
    <>
      <div className="auth-toggle-row">
        <div>
          <span className="auth-toggle-label">{enabled ? 'Enabled' : 'Disabled'}</span>
          <p className="auth-field-hint">
            {isOther
              ? 'Any other gateway (Kaspi, your own payment link, bank). The order is recorded; you collect the payment yourself and confirm it.'
              : 'Cash, bank transfer or pay-on-delivery. The order is recorded; no card is charged online.'}
          </p>
        </div>
        <label className="auth-toggle">
          <input type="checkbox" checked={enabled}
            onChange={e => setEnabled(e.target.checked)} />
          <span className="auth-toggle-track" />
        </label>
      </div>

      <div className="auth-sep" />

      <div className="auth-field">
        <label className="auth-label">Display name</label>
        <p className="auth-field-hint">
          What the customer sees at checkout.
        </p>
        <input className="crm-input" type="text"
          placeholder={isOther ? 'Kaspi / Bank transfer' : 'Cash / Pay on delivery'}
          value={label} onChange={e => setLabel(e.target.value)} autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">Payment instructions (shown to the customer)</label>
        <p className="auth-field-hint">
          Displayed on the order-confirmation screen so the buyer knows how to pay.
          E.g. “Send the total to Kaspi +7 700 123 4567 and reply with the receipt photo.”
        </p>
        <textarea className="crm-input" rows={4}
          placeholder={isOther
            ? 'Send the total to Kaspi +7 …, then reply with the receipt.'
            : 'Pay the courier in cash on delivery.'}
          value={instructions} onChange={e => setInstructions(e.target.value)}
          style={{ borderRadius: 16, resize: 'vertical', minHeight: 96 }} />
      </div>

      <div className="auth-actions">
        <button type="button" className="crm-submit-btn"
          disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}


// ── Page ────────────────────────────────────────────────────────────

export default function OrgPayments() {
  const { t } = useTranslation();
  const { org } = useOutletContext();
  const orgId = org?.id;

  const [methods,            setMethods]            = useState([]);   // [{method,is_enabled,display_label,instructions}]
  const [connectedProviders, setConnectedProviders] = useState([]);  // gateways with live (connected) creds
  const [modal,              setModal]              = useState(null); // open provider id
  const [toast,           setToast]           = useState('');

  // Stripe Connect OAuth landing — show feedback, then strip the query param.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('connected') === 'stripe') {
      setToast('Stripe connected ✓');
      searchParams.delete('connected'); setSearchParams(searchParams, { replace: true });
    } else if (searchParams.get('connect_error')) {
      setToast(searchParams.get('connect_error'));
      searchParams.delete('connect_error'); setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3600);
    return () => clearTimeout(id);
  }, [toast]);

  const reload = useCallback(async () => {
    if (!orgId) return;
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${orgId}/payment-methods`,
                              { credentials: 'include' });
      if (!r.ok) return;
      const j = await r.json();
      setMethods(j.methods || []);
      setConnectedProviders(Array.isArray(j.connected_providers) ? j.connected_providers : []);
    } catch { /* network error — keep last state */ }
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);

  const methodFor = (id) => methods.find(m => m.method === id);

  const modalProvider = modal ? CATALOG.find(p => p.id === modal) : null;

  return (
    <>
      <h1 className="crm-page-title">{t('org.payments.title')}</h1>
      <p className="auth-page-subtitle">
        Turn on the ways your customers can pay. Methods work together — the buyer
        picks one at checkout.
      </p>

      <div className="auth-providers-list">
        {CATALOG.map((p, idx) => (
          <MethodRow key={p.id} provider={p} method={methodFor(p.id)}
            connectedProviders={connectedProviders}
            onOpen={setModal}
            first={idx === 0} last={idx === CATALOG.length - 1} />
        ))}
      </div>

      {modalProvider && (
        <PaymentModal provider={modalProvider} onClose={() => setModal(null)}>
          {modalProvider.online
            ? <PaymentProviderPanel
                provider={modalProvider}
                orgId={orgId}
                onClose={() => setModal(null)}
                onSaved={reload} />
            : <OfflineMethodPanel
                provider={modalProvider}
                orgId={orgId}
                method={methodFor(modalProvider.id)}
                onSaved={reload} />}
        </PaymentModal>
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}
