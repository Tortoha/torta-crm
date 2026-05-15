// Org-level Payments page — visual design copied 1:1 from Authentication.jsx +
// Integrations.jsx (provider-row list pattern + AuthModal). One row per supported
// payment provider; clicking opens a modal with the credentials form.
//
// Variant A model — CRM never holds money. Merchant connects their own Stripe /
// Tinkoff / etc. account here; CRM uses the stored credentials to create payment
// intents (External backend) and process refunds (CRM backend Returns workflow).

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  CaretRight, X, CheckCircle, Money, CreditCard,
} from '@phosphor-icons/react';
import { Icon } from '@iconify/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import PaymentProviderPanel from './PaymentProviderPanel.jsx';
import '../../Style/Authentication.css';


// Provider catalog. All 9 listed providers are fully implemented (CRM + External
// adapters in payment_providers.py). Each row opens a credentials modal on click.
//
// Russian-only providers (Tinkoff, CloudPayments, YooKassa) are deliberately
// excluded from the UI catalog — backend code remains intact for self-hosters
// who need them, but the international CRM positions itself around globally-
// usable gateways. PayBox.money is included because it's the standard Kazakhstan
// option.
const AVAILABLE = [
  { id: 'stripe', label: 'Stripe',
    desc: 'Global card payments — 50+ countries, Stripe Payment Intents + Refunds API',
    iconify: 'logos:stripe' },
  { id: 'paypal', label: 'PayPal',
    desc: 'PayPal Orders v2 — works in 200+ markets, capture + refund',
    iconify: 'logos:paypal' },
  { id: 'adyen', label: 'Adyen',
    desc: 'Enterprise unified payments — 250+ payment methods, hosted Drop-in',
    iconify: 'simple-icons:adyen', color: '#0ABF53' },
  { id: 'braintree', label: 'Braintree',
    desc: 'PayPal-owned full-service gateway — cards + PayPal + Apple Pay + Google Pay',
    iconify: 'simple-icons:braintree', color: '#172A4E' },
  { id: 'square', label: 'Square',
    desc: 'In-person + online payments — US, UK, AU, CA, JP, IE',
    iconify: 'simple-icons:square', color: '#3E4348' },
  { id: 'mollie', label: 'Mollie',
    desc: 'European gateway — iDEAL, Bancontact, SOFORT, SEPA, cards',
    iconify: 'simple-icons:mollie', color: '#001B44' },
  { id: 'razorpay', label: 'Razorpay',
    desc: 'India + South Asia gateway — cards, UPI, wallets, EMI',
    iconify: 'simple-icons:razorpay', color: '#0C2451' },
  { id: 'paddle', label: 'Paddle',
    desc: 'Merchant of record for SaaS — handles tax + invoicing globally',
    iconify: 'simple-icons:paddle', color: '#0F1626' },
  { id: 'paybox', label: 'PayBox.money',
    desc: 'Kazakhstan acquiring — KZT cards + KaspiPay + EasyPay',
    phosphor: CreditCard },
  { id: 'manual', label: 'Manual',
    desc: 'No API integration — cash, bank transfer, etc. Refunds are record-only',
    phosphor: Money },
  { id: 'other', label: 'Other',
    desc: 'Free-form provider — record references manually in Returns workflow',
    phosphor: CreditCard },
];

const COMING_SOON = [];   // empty now — kept for future additions


// ── Icon helper (iconify logo → phosphor fallback) ───────────────────

const ProviderIcon = ({ provider, size = 24 }) =>
  provider.iconify
    ? <Icon icon={provider.iconify} width={size} height={size}
        style={provider.color ? { color: provider.color } : undefined} />
    : <provider.phosphor className="auth-provider-icon" />;


// ── Tilt config (matches Authentication ROW_TILT) ───────────────────

const ROW_TILT = {
  maxAngleX: 8, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.10, spread: 40 },
};


// ── Provider row (active) ───────────────────────────────────────────

function ProviderRow({ provider, status, onClick, first, last }) {
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, false);
  const cls = [
    'auth-provider-row',
    first && 'auth-provider-row--first',
    last  && 'auth-provider-row--last',
  ].filter(Boolean).join(' ');

  return (
    <div ref={ref} className={cls} onClick={onClick} {...handlers}>
      <div ref={glossRef} className="auth-provider-gloss" />

      <div className="auth-provider-icon-wrap">
        <ProviderIcon provider={provider} size={24} />
      </div>

      <span className="auth-provider-name">{provider.label}</span>
      <span className="auth-provider-desc">{provider.desc}</span>

      {status === 'connected'  && (
        <span className="auth-badge-enabled">
          <CheckCircle weight="fill" size={11} /> Connected
        </span>
      )}
      {status === 'configured' && (
        <span className="auth-badge-enabled" style={{ background: '#F59E0B' }}>
          Awaiting test
        </span>
      )}
      {status === 'idle'       && <span className="auth-badge-disabled">Not connected</span>}

      <CaretRight className="auth-provider-chevron" />
    </div>
  );
}


// ── Provider row (coming-soon, non-clickable) ───────────────────────

function ComingSoonRow({ provider, first, last }) {
  const cls = [
    'auth-provider-row',
    'auth-provider-row--disabled',
    first && 'auth-provider-row--first',
    last  && 'auth-provider-row--last',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <div className="auth-provider-icon-wrap auth-provider-icon-wrap--dim">
        <ProviderIcon provider={provider} size={24} />
      </div>
      <span className="auth-provider-name">{provider.label}</span>
      <span className="auth-provider-desc">{provider.desc}</span>
      <span className="auth-badge-disabled">Coming soon</span>
      <CaretRight className="auth-provider-chevron" />
    </div>
  );
}


// ── Auth-style modal wrapper ────────────────────────────────────────
// Same structure as Authentication.jsx AuthModal.

function PaymentModal({ provider, onClose, children }) {
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
              <div className="auth-modal-title">{provider.label}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">{provider.desc}</span>
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


// ── Page ────────────────────────────────────────────────────────────

export default function OrgPayments() {
  const { org } = useOutletContext();
  const orgId = org?.id;

  const [currentProvider, setCurrentProvider] = useState('manual');
  const [isConnected,     setIsConnected]     = useState(false);
  const [modal, setModal] = useState(null);   // currently-open provider id

  const reload = useCallback(async () => {
    if (!orgId) return;
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${orgId}/payment-credentials`,
                              { credentials: 'include' });
      if (!r.ok) return;
      const j = await r.json();
      setCurrentProvider(j.provider || 'manual');
      setIsConnected(!!j.is_connected);
    } catch { /* network error — keep defaults */ }
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);

  const statusFor = (id) => {
    if (id !== currentProvider) return 'idle';
    if (id === 'manual' || id === 'other') return 'connected';
    return isConnected ? 'connected' : 'configured';
  };

  const allRows = [...AVAILABLE, ...COMING_SOON];
  const modalProvider = modal ? AVAILABLE.find(p => p.id === modal) : null;

  return (
    <>
      <h1 className="crm-page-title">Payments</h1>
      <p className="auth-page-subtitle">
        Connect your payment provider so customers can pay directly during checkout.
        CRM never touches the money — payments flow straight to your provider account,
        and refunds are processed through the provider's API when you handle returns.
      </p>

      <div className="auth-providers-list">
        {allRows.map((p, idx) => {
          const first = idx === 0;
          const last  = idx === allRows.length - 1;
          const isComingSoon = COMING_SOON.includes(p);
          return isComingSoon
            ? <ComingSoonRow key={p.id} provider={p} first={first} last={last} />
            : <ProviderRow key={p.id} provider={p}
                status={statusFor(p.id)} first={first} last={last}
                onClick={() => setModal(p.id)} />;
        })}
      </div>

      {modalProvider && (
        <PaymentModal provider={modalProvider} onClose={() => setModal(null)}>
          <PaymentProviderPanel
            provider={modalProvider}
            orgId={orgId}
            onClose={() => setModal(null)}
            onSaved={reload} />
        </PaymentModal>
      )}
    </>
  );
}
