// Org Billing — /org/:slug/billing.
//
// Layout follows Project Settings / Targets:
//   page title  →  section header (outside the card)  →  single card content
//   for plan + payment method; po-set-table + PoListRow rows for invoices.
//
// Section titles live above the card (no icon, like Settings), and per-section
// "primary" actions sit on the right of the plan row instead of below.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowSquareOut, CheckCircle, ArrowRight, X, Trash,
  ArrowsClockwise, PencilSimple, ArrowUUpLeft,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { closeCheckout, onPaddleEvent } from '../../Utils/paddle.js';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import { PlanCard, BillingToggle } from '../Landing/Pricing.jsx';
import i18n from '../../i18n.js';
import '../../Style/Landing.css';   // .pr-card / .pr-plans-grid / .pr-bill-toggle
import '../../Style/Authentication.css';
import '../../Style/Products.css';      // .bulk-section / .bulk-field / .po-set-*
import '../../Style/Organization.css';  // .org-toolbar (just in case)
import '../../Style/OrgBilling.css';

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    // Use the chosen UI language, not the browser/system locale. Without
    // this the user's KZ system would render dates in Russian even while
    // the CRM is set to English.
    const loc = (i18n.language || 'en').split('-')[0];
    return new Date(iso).toLocaleDateString(loc, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return '—'; }
}

function fmtMoney(rawAmount, currency) {
  if (rawAmount == null || rawAmount === '') return '—';
  // Paddle returns minor-unit strings ("1000" = $10.00).
  const num = (typeof rawAmount === 'string' ? parseInt(rawAmount, 10) : rawAmount) / 100;
  if (!Number.isFinite(num)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: (currency || 'USD').toUpperCase(),
    }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

function StatusBadge({ status, cancelledAt }) {
  const { t } = useTranslation();
  const s = (status || '').toLowerCase();
  let cls = 'ob-badge';
  let label = s || 'unknown';
  if (cancelledAt && s !== 'expired') {
    cls += ' ob-badge--warn';
    label = t('billing.status.cancelling', { defaultValue: 'Ending soon' });
  } else if (s === 'active' || s === 'trialing') {
    cls += ' ob-badge--ok';
    label = t(`billing.status.${s}`, { defaultValue: s });
  } else if (s === 'past_due' || s === 'paused') {
    cls += ' ob-badge--warn';
    label = t(`billing.status.${s}`, { defaultValue: s });
  } else if (s === 'canceled' || s === 'expired') {
    cls += ' ob-badge--off';
    label = t(`billing.status.${s}`, { defaultValue: s });
  } else if (s === 'billed' || s === 'paid' || s === 'completed') {
    cls += ' ob-badge--ok';
    label = t(`billing.status.${s}`, { defaultValue: s });
  }
  return <span className={cls}>{label}</span>;
}

// ── Section header (title + subtitle outside the card) ───────────────
// Mirrors `Section` from ProjectSettings.jsx but without the icon slot.
function SectionHead({ title, subtitle }) {
  return (
    <header className="bulk-section-head ob-section-head">
      <div className="bulk-section-text">
        <h2 className="bulk-section-title">{title}</h2>
        {subtitle && <p className="bulk-section-sub">{subtitle}</p>}
      </div>
    </header>
  );
}

// ── Cancel confirmation modal ────────────────────────────────────────
function CancelModal({ planName, periodEnd, busy, onCancel, onConfirm }) {
  const { t } = useTranslation();
  return createPortal(
    <div className="auth-modal-overlay" onClick={onCancel}>
      <div className="auth-modal" onClick={e => e.stopPropagation()} style={{ width: 460 }}>
        <div className="auth-modal-body">
          <div className="auth-modal-title-row">
            <h2 className="auth-modal-title">
              {t('billing.cancel.title', { defaultValue: 'Cancel subscription?' })}
            </h2>
          </div>
          <p className="cpm-section-hint" style={{ marginTop: 0 }}>
            {t('billing.cancel.body', {
              defaultValue: 'Your {{plan}} plan stays active until {{date}}. After that the org reverts to Free.',
              plan: planName, date: fmtDate(periodEnd),
            })}
          </p>
          <ul className="ob-modal-list">
            <li>{t('billing.cancel.b1', { defaultValue: 'No refund for the current period' })}</li>
            <li>{t('billing.cancel.b2', { defaultValue: 'Your data stays — projects & customers are preserved' })}</li>
            <li>{t('billing.cancel.b3', { defaultValue: 'You can re-subscribe any time' })}</li>
          </ul>
          <div className="auth-actions" style={{ marginTop: 16 }}>
            <button type="button" className="auth-btn-danger" onClick={onConfirm} disabled={busy}>
              {busy ? t('common.loading', { defaultValue: 'Working…' })
                : t('billing.cancel.confirm', { defaultValue: 'Cancel subscription' })}
            </button>
            <button type="button" className="crm-submit-btn" onClick={onCancel}
              style={{ marginLeft: 'auto' }} disabled={busy}>
              {t('billing.cancel.keep', { defaultValue: 'Keep subscription' })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Refund (money-back) confirm modal ────────────────────────────────
function RefundModal({ busy, onCancel, onConfirm }) {
  const { t } = useTranslation();
  return createPortal(
    <div className="auth-modal-overlay" onClick={onCancel}>
      <div className="auth-modal" onClick={e => e.stopPropagation()} style={{ width: 460 }}>
        <div className="auth-modal-body">
          <div className="auth-modal-title-row">
            <h2 className="auth-modal-title">
              {t('billing.refund.confirmTitle', { defaultValue: 'Get a full refund?' })}
            </h2>
          </div>
          <p className="cpm-section-hint" style={{ marginTop: 0 }}>
            {t('billing.refund.confirmBody', {
              defaultValue: 'We refund your latest payment in full and end the subscription now. This one-time guarantee can’t be used again on this organization.',
            })}
          </p>
          <ul className="ob-modal-list">
            <li>{t('billing.refund.b1', { defaultValue: 'Money goes back to your original payment method' })}</li>
            <li>{t('billing.refund.b2', { defaultValue: 'Your organization drops to the Free plan' })}</li>
            <li>{t('billing.refund.b3', { defaultValue: 'Your data stays — projects & customers are kept' })}</li>
          </ul>
          <div className="auth-actions" style={{ marginTop: 16 }}>
            <button type="button" className="auth-btn-danger" onClick={onConfirm} disabled={busy}>
              {busy ? t('common.loading', { defaultValue: 'Working…' })
                : t('billing.refund.confirm', { defaultValue: 'Refund & cancel' })}
            </button>
            <button type="button" className="crm-submit-btn" onClick={onCancel}
              style={{ marginLeft: 'auto' }} disabled={busy}>
              {t('billing.refund.keep', { defaultValue: 'Keep subscription' })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Change Plan Modal ────────────────────────────────────────────────
// Plan picker for in-context upgrades/downgrades. Opens from the Billing
// page's "Change subscription plan" button and auto-opens from
// /pricing?upgrade=<plan>. Mirrors the PromoCodes modal shell
// (auth-modal-head + auth-modal-close X) and re-uses the real Pricing
// PlanCard + BillingToggle so the visual matches /pricing exactly —
// no parallel design to maintain.

const PLAN_KEYS = ['free', 'standard', 'plus', 'pro', 'max'];

function ChangePlanModal({
  currentPlan, initialPlan, initialCycle,
  onClose, onSubscribe,
}) {
  const { t } = useTranslation();
  const [billing, setBilling] = useState(initialCycle === 'yearly' ? 'yearly' : 'monthly');

  function handlePick(planKey) {
    if (planKey === currentPlan) return;
    if (planKey === 'free') {
      // Downgrade to Free = cancel subscription. Close the modal so the
      // parent can render the cancel-confirm modal (single source of truth).
      onClose({ downgradeToFree: true });
      return;
    }
    // Hand off to the dedicated checkout page — the modal is a pure picker.
    // The page creates the transaction + mounts Paddle inline; this keeps
    // the heavy payment iframe out of the Billing view entirely.
    onClose({});
    onSubscribe(planKey, billing);
  }

  // Highlight the initial plan from ?upgrade= on first mount — visually a
  // subtle ring around the suggested card. Pricing cards already animate
  // hover via CSS; we just add the data-hint attribute.
  const ctaForPlan = (planKey, popular) => {
    const isCurrent = planKey === currentPlan;
    if (isCurrent) {
      return (
        <div className={`pr-card-cta pr-card-cta--current${popular ? ' pr-card-cta--solid-mute' : ''}`}>
          <CheckCircle size={14} weight="regular" />
          {t('billing.modal.currentPlan', { defaultValue: 'Current plan' })}
        </div>
      );
    }
    const isFree = planKey === 'free';
    return (
      <button type="button"
              className={`pr-card-cta pr-card-cta--btn${popular ? ' pr-card-cta--solid' : ''}`}
              onClick={() => handlePick(planKey)}>
        {isFree
          ? t('billing.modal.downgrade', { defaultValue: 'Downgrade to Free' })
          : t('billing.modal.subscribe', { defaultValue: 'Subscribe' })}
        <ArrowRight size={14} weight="bold" />
      </button>
    );
  };

  return createPortal(
    <div className="auth-modal-overlay"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose({}); }}>
      <div className="auth-modal cpm-modal cpm-modal--plans" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">
                {t('billing.modal.title', { defaultValue: 'Change subscription plan' })}
              </div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {t('billing.modal.sub', {
                    defaultValue: 'Pick a plan to upgrade or downgrade. Changes are pro-rated by Paddle.',
                  })}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" type="button" onClick={() => onClose({})}>
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          {/* Monthly / Yearly — same component as Pricing (Dynamic Block). */}
          <div className="cpm-toggle-row">
            <BillingToggle active={billing} onChange={setBilling} />
          </div>

          {/* Real Pricing plan cards — reuse, don't fork. */}
          <div className="pr-plans-grid cpm-plans-grid"
               data-hint={initialPlan && currentPlan !== initialPlan ? initialPlan : undefined}>
            {PLAN_KEYS.map(k => (
              <PlanCard key={k}
                        planKey={k}
                        popular={k === 'pro'}
                        billing={billing}
                        ctaSlot={ctaForPlan(k, k === 'pro')} />
            ))}
          </div>

          {/* Footer: link to full Pricing + Close. */}
          <div className="cpm-foot">
            <Link to="/pricing" className="cpm-foot-link">
              {t('billing.modal.seeFullPricing', { defaultValue: 'See full plan comparison' })}
              <ArrowRight size={12} weight="bold" />
            </Link>
            <button type="button" className="crm-submit-btn auth-btn-secondary"
                    onClick={() => onClose({})}
                    style={{ marginLeft: 'auto' }}>
              {t('common.cancel', { defaultValue: 'Close' })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}


// ── Page ─────────────────────────────────────────────────────────────
export default function OrgBilling() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { org } = useOutletContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sub, setSub] = useState(null);
  const [pm, setPm] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [planOpen,   setPlanOpen]   = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // ?upgrade=<plan>&cycle=<monthly|yearly> auto-opens the plan modal with
  // that plan highlighted (e.g. landed from /pricing). Strip the params
  // after consuming so a refresh doesn't re-open the modal.
  const upgradeHint = searchParams.get('upgrade');
  const cycleHint   = searchParams.get('cycle');
  useEffect(() => {
    if (upgradeHint) {
      setPlanOpen(true);
      // Defer the URL cleanup so we don't fight with route mount.
      setTimeout(() => {
        const next = new URLSearchParams(searchParams);
        next.delete('upgrade');
        next.delete('cycle');
        setSearchParams(next, { replace: true });
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const planSlug = sub?.plan_slug || 'free';
  const isFree = planSlug === 'free';
  const isPaid = !isFree && !!sub?.paddle_subscription_id;
  const planName = sub?.plan_name || 'Free';
  const periodEnd = sub?.current_period_end;
  const monthly = sub?.price_usd || 0;
  const refundEligible = !!sub?.refund_eligible;

  const reload = useCallback(async () => {
    if (!org?.id) return;
    try {
      const [subRes, pmRes, invRes] = await Promise.all([
        fetch(`${API_BASE}/api/orgs/${org.id}/subscription`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/orgs/${org.id}/billing/payment-method`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/orgs/${org.id}/billing/invoices`, { credentials: 'include' }),
      ]);
      setSub(subRes.ok ? await subRes.json() : null);
      setPm((pmRes.ok ? (await pmRes.json()).payment_method : null) || null);
      setInvoices((invRes.ok ? (await invRes.json()).invoices : []) || []);
    } catch {/* leave previous */ }
  }, [org?.id]);

  // syncFromPaddle: pull the truth from Paddle's API before reading our DB.
  // This is webhook-independent — fixes the common dev-time bug where a
  // payment completes but the webhook never reaches localhost (ngrok URL
  // rotation, destination drift, etc).
  const syncFromPaddle = useCallback(async () => {
    if (!org?.id) return;
    try {
      await fetch(`${API_BASE}/api/orgs/${org.id}/billing/sync`, {
        method: 'POST', credentials: 'include',
      });
    } catch {/* sync errors are silent — we still try to render DB state */}
    await reload();
  }, [org?.id, reload]);

  useEffect(() => {
    setLoading(true);
    syncFromPaddle().finally(() => setLoading(false));
  }, [syncFromPaddle]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  // Re-fetch on Paddle event so the UI catches the new subscription state.
  // We ALSO close Paddle's overlay as soon as `checkout.completed` fires —
  // their dark-theme success screen has a contrast bug (white secondary
  // text on white background) AND the success icon is hardcoded green,
  // both of which look out of place inside our blue/dark CRM. Closing
  // immediately replaces it with our own success toast.
  useEffect(() => {
    const off = onPaddleEvent(ev => {
      if (!ev) return;
      if (ev.name === 'checkout.completed' || ev.name === 'checkout.payment.succeeded') {
        closeCheckout();
        setTimeout(syncFromPaddle, 1500);
        setToast({
          kind: 'ok',
          msg: t('billing.updated', { defaultValue: 'Subscription updated' })
        });
      }
    });
    return off;
  }, [syncFromPaddle, t]);

  function handleUpdateCard() {
    if (!org?.slug) return;
    // The dedicated checkout page handles the update-payment-method txn +
    // inline Paddle form, same as plan changes.
    navigate(`/org/${org.slug}/checkout?action=update-card`);
  }

  async function handleCancelConfirm() {
    if (!org?.id) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${org.id}/billing/cancel`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effective_from: 'next_billing_period' }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setCancelOpen(false);
      setToast({
        kind: 'ok',
        msg: t('billing.cancelOk', { defaultValue: 'Subscription cancelled — active until period end' })
      });
      setTimeout(reload, 1800);
    } catch (e) {
      console.error('[billing/cancel]', e);
      setToast({
        kind: 'err',
        msg: t('billing.cancelFailed', { defaultValue: 'Cancellation failed — try again' })
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRefund() {
    if (!org?.id) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${org.id}/billing/refund`, {
        method: 'POST', credentials: 'include',
      });
      if (!r.ok) {
        // Surface the backend reason (incl. the real Paddle error) instead of a
        // blank "try again" — otherwise refund failures are undiagnosable.
        const body = await r.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${r.status}`);
      }
      setRefundOpen(false);
      setToast({ kind: 'ok', msg: t('billing.refund.ok', { defaultValue: 'Refunded — the money is on its way back' }) });
      setTimeout(reload, 1800);
    } catch (e) {
      console.error('[billing/refund]', e);
      setToast({ kind: 'err', msg: e.message || t('billing.refund.failed', { defaultValue: 'Refund failed — try again' }) });
    } finally {
      setBusy(false);
    }
  }

  async function handleInvoicePdf(txnId) {
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${org.id}/billing/invoices/${txnId}/pdf`,
        { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { url } = await r.json();
      if (url) window.open(url, '_blank', 'noopener');
    } catch (e) {
      console.error('[billing/pdf]', e);
      setToast({
        kind: 'err',
        msg: t('billing.pdfFailed', { defaultValue: 'Could not open invoice' })
      });
    }
  }

  if (loading) {
    return <div className="ob-page ob-page--loading"><div className="ob-skel" /></div>;
  }

  return (
    <div className="ob-page">
      <h1 className="crm-page-title">{t('billing.title', { defaultValue: 'Billing' })}</h1>
      <section className="bulk-billing">
        {/* ── Current plan ── */}
        <section className="bulk-section">
          <SectionHead
            title={t('billing.currentPlan', { defaultValue: 'Current plan' })}
            subtitle={t('billing.currentPlanSub', {
              defaultValue: 'Manage your subscription, change plan or cancel.',
            })}
          />
          <div className="bulk-section-fields bulk-section-fields--single">
            <div className="bulk-field bulk-field--noswitch bulk-field--on">
              <div className="ob-plan-row">
                <div className="ob-plan-left">
                  <span className="ob-plan-name-text">{planName}</span>
                  <StatusBadge status={sub?.status} cancelledAt={sub?.cancelled_at} />
                </div>
                <div className="ob-plan-right">
                  {isPaid && (
                    <span className="ob-plan-price-meta">
                      ${monthly}/{t('billing.month', { defaultValue: 'mo' })}
                    </span>
                  )}
                  <button type="button" className="auth-btn-check ob-primary-btn"
                          onClick={() => setPlanOpen(true)}>
                    <ArrowsClockwise size={14} weight="regular" />
                    {isFree
                      ? t('billing.upgrade', { defaultValue: 'Choose a plan' })
                      : t('billing.changePlan', { defaultValue: 'Change subscription plan' })}
                  </button>
                </div>
              </div>
              {isPaid && periodEnd && (
                <div className="ob-plan-meta">
                  {sub?.cancelled_at
                    ? t('billing.endsOn', { defaultValue: 'Ends on {{date}}', date: fmtDate(periodEnd) })
                    : t('billing.renewsOn', { defaultValue: 'Renews on {{date}}', date: fmtDate(periodEnd) })}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Payment method ── */}
        <section className="bulk-section">
          <SectionHead
            title={t('billing.paymentMethod', { defaultValue: 'Payment method' })}
            subtitle={t('billing.paymentMethodSub', {
              defaultValue: 'Card on file for future charges.',
            })}
          />
          <div className="bulk-section-fields bulk-section-fields--single">
            <div className="bulk-field bulk-field--noswitch bulk-field--on">
              {pm
                ? (
                  <div className="ob-pm-row">
                    <div className="ob-pm-text">
                      <div className="ob-pm-line1">
                        {(pm.brand || 'Card').replace(/^./, c => c.toUpperCase())}
                        {pm.last4 && (
                          <span className="ob-pm-dots"> •••• {pm.last4}</span>
                        )}
                      </div>
                      {pm.expiry && (
                        <div className="ob-pm-line2">
                          {t('billing.expires', { defaultValue: 'Expires {{date}}', date: pm.expiry })}
                        </div>
                      )}
                    </div>
                    <button type="button" className="auth-btn-check ob-primary-btn"
                      onClick={handleUpdateCard}
                      disabled={!isPaid}>
                      <PencilSimple size={14} weight="regular" />
                      {t('billing.updateCard', { defaultValue: 'Update card' })}
                    </button>
                  </div>
                )
                : (
                  <p className="ob-empty">
                    {isFree
                      ? t('billing.noCardFree', { defaultValue: 'No card on file — Free plan doesn’t require one.' })
                      : t('billing.noCard', { defaultValue: 'No card on file yet.' })}
                  </p>
                )}
            </div>
          </div>
        </section>

        {/* ── Invoices ── */}
        <section className="bulk-section">
          <SectionHead
            title={t('billing.invoices', { defaultValue: 'Invoices' })}
            subtitle={t('billing.invoicesSub', {
              defaultValue: 'Receipts and payment history from Paddle.',
            })}
          />
          {invoices.length === 0
            ? (
              <div className="bulk-section-fields bulk-section-fields--single">
                <div className="bulk-field bulk-field--noswitch bulk-field--on">
                  <p className="ob-empty" style={{ padding: 0 }}>
                    {t('billing.noInvoices', { defaultValue: 'No invoices yet.' })}
                  </p>
                </div>
              </div>
            )
            : (
              <div className="po-set-table">
                <div className="po-set-row po-set-row--head po-set-row--ob-inv">
                  <span>{t('billing.col.date', { defaultValue: 'Date' })}</span>
                  <span>{t('billing.col.amount', { defaultValue: 'Amount' })}</span>
                  <span>{t('billing.col.method', { defaultValue: 'Paid with' })}</span>
                  <span>{t('billing.col.status', { defaultValue: 'Status' })}</span>
                  <span />
                </div>
                {invoices.map(inv => (
                  <PoListRow key={inv.id} className="po-set-row--ob-inv">
                    <span>{fmtDate(inv.billed_at)}</span>
                    <span className="ob-inv-amount">{fmtMoney(inv.amount, inv.currency)}</span>
                    <span className="ob-inv-method">
                      {inv.payment_method
                        ? <>
                            {inv.payment_method.brand || '—'}
                            {inv.payment_method.last4 && (
                              <span className="ob-pm-dots"> •••• {inv.payment_method.last4}</span>
                            )}
                          </>
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </span>
                    <span><StatusBadge status={inv.status} cancelledAt={null} /></span>
                    <button type="button" className="ob-inv-pdf"
                      onClick={() => handleInvoicePdf(inv.id)}
                      title={t('billing.openPdf', { defaultValue: 'Open invoice PDF' })}>
                      <ArrowSquareOut size={14} weight="regular" />
                    </button>
                  </PoListRow>
                ))}
              </div>
            )}
        </section>

        {/* ── Money-back guarantee (only in the 14-day window, once per org) ── */}
        {refundEligible && (
          <section className="bulk-section">
            <SectionHead
              title={t('billing.refund.title', { defaultValue: '14-day money-back guarantee' })}
              subtitle={t('billing.refund.sub', {
                defaultValue: 'Not a fit? Get a full refund within 14 days of your first payment. One-time per organization.',
              })}
            />
            <div className="bulk-section-fields bulk-section-fields--single">
              <div className="bulk-field bulk-field--noswitch bulk-field--on">
                <div className="ob-cancel-row">
                  <div className="ob-cancel-label">
                    <div className="ob-pm-line1">
                      {t('billing.refund.label', { defaultValue: 'Request a full refund' })}
                    </div>
                    <div className="ob-pm-line2">
                      {t('billing.refund.hint', { defaultValue: 'Refunds your latest payment and ends the subscription.' })}
                    </div>
                  </div>
                  <button type="button" className="auth-btn-check ob-primary-btn" onClick={() => setRefundOpen(true)} disabled={busy}>
                    <ArrowUUpLeft size={14} weight="regular" />
                    {t('billing.refund.btn', { defaultValue: 'Get a refund' })}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Cancellation (paid only, not already cancelled) ── */}
        {isPaid && !sub?.cancelled_at && (
          <section className="bulk-section">
            <SectionHead
              title={t('billing.cancellation', { defaultValue: 'Cancellation' })}
              subtitle={t('billing.cancellationSub', {
                defaultValue: 'Cancel anytime. You keep access until the current period ends.',
              })}
            />
            <div className="bulk-section-fields bulk-section-fields--single">
              <div className="bulk-field bulk-field--noswitch bulk-field--on">
                <div className="ob-cancel-row">
                  <div className="ob-cancel-label">
                    <div className="ob-pm-line1">
                      {t('billing.cancelLabel', { defaultValue: 'Cancel plan' })}
                    </div>
                    <div className="ob-pm-line2">
                      {periodEnd && t('billing.cancelLabelHint', {
                        defaultValue: 'Access continues until {{date}}',
                        date: fmtDate(periodEnd),
                      })}
                    </div>
                  </div>
                  <button type="button" className="auth-btn-danger ob-cancel-btn"
                          onClick={() => setCancelOpen(true)}>
                    <Trash size={14} weight="regular" />
                    {t('billing.cancel.btn', { defaultValue: 'Cancel' })}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </section>

      {/* ── Modals + toasts ── */}
      {planOpen && (
        <ChangePlanModal
          currentPlan={planSlug}
          initialPlan={upgradeHint}
          initialCycle={cycleHint}
          onClose={({ downgradeToFree } = {}) => {
            setPlanOpen(false);
            if (downgradeToFree && isPaid && !sub?.cancelled_at) {
              setCancelOpen(true);
            }
          }}
          onSubscribe={(planKey, cycle) =>
            navigate(`/org/${org?.slug}/checkout?plan=${planKey}&cycle=${cycle}`)
          }
        />
      )}
      {cancelOpen && (
        <CancelModal
          planName={planName}
          periodEnd={periodEnd}
          busy={busy}
          onCancel={() => !busy && setCancelOpen(false)}
          onConfirm={handleCancelConfirm}
        />
      )}
      {refundOpen && (
        <RefundModal
          busy={busy}
          onCancel={() => !busy && setRefundOpen(false)}
          onConfirm={handleRefund}
        />
      )}
      {toast && createPortal(
        <div className={`auth-toast${toast.kind === 'err' ? ' auth-toast--err' : ''}`}>
          {toast.msg}
        </div>,
        document.body,
      )}
    </div>
  );
}
