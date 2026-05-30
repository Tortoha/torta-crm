// Org Checkout — /org/:slug/checkout.
//
// A dedicated, walled-off page that hosts Paddle's INLINE checkout inside
// our own layout (Sidebar + Header stay visible — no dark overlay). Keeping
// it on its own route means the Billing page's clean design is never
// disturbed by the third-party payment iframe.
//
// Query params drive what transaction we create:
//   ?plan=standard&cycle=monthly   → subscribe / change plan
//   ?action=update-card            → update the saved payment method
//
// Flow:
//   1. mount → POST the right endpoint → get transaction_id
//   2. openInlineCheckout(txn, 'paddle-checkout-frame') mounts Paddle's form
//   3. on checkout.completed → toast + navigate back to /billing
//   4. on error → inline error with a Back-to-billing escape hatch

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle, ShieldCheck, Lock } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { openInlineCheckout, onPaddleEvent, getBillingConfig } from '../../Utils/paddle.js';
import '../../Style/Landing.css';      // .pr-card-list checkmark rows
import '../../Style/OrgCheckout.css';

const FRAME_TARGET = 'paddle-checkout-frame';

// Plan display data (mirrors Pricing). Kept local — tiny + avoids importing
// the whole Pricing module just for names/prices.
const PLAN_META = {
  standard: { name: 'Standard', monthly: 10,  yearlyTotal: 110  },
  plus:     { name: 'Plus',     monthly: 25,  yearlyTotal: 275  },
  pro:      { name: 'Pro',      monthly: 30,  yearlyTotal: 330  },
  max:      { name: 'Max',      monthly: 599, yearlyTotal: 6589 },
};

export default function OrgCheckout() {
  const { t }     = useTranslation();
  const navigate  = useNavigate();
  const { org }   = useOutletContext();
  const [params]  = useSearchParams();

  const plan   = params.get('plan');        // 'standard' | 'plus' | 'pro'
  const cycle  = params.get('cycle') === 'yearly' ? 'yearly' : 'monthly';
  const action = params.get('action');      // 'update-card' | null

  const isCardUpdate = action === 'update-card';
  const planMeta     = plan ? PLAN_META[plan] : null;

  const [status, setStatus] = useState('loading');   // loading | ready | error | done
  const [errMsg, setErrMsg] = useState('');
  const startedRef = useRef(false);

  const backToBilling = () => navigate(`/org/${org?.slug}/billing`);

  // Subscribe to Paddle events for THIS page's checkout lifecycle.
  useEffect(() => {
    const off = onPaddleEvent(ev => {
      if (!ev) return;
      if (ev.name === 'checkout.completed' || ev.name === 'checkout.payment.succeeded') {
        setStatus('done');
        // Give the webhook/sync a beat, then return to Billing where the
        // page mount re-syncs from Paddle and shows the new state.
        setTimeout(() => navigate(`/org/${org?.slug}/billing`), 1400);
      }
    });
    return off;
  }, [navigate, org?.slug]);

  // Create the transaction + mount the inline frame once.
  useEffect(() => {
    if (!org?.id || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        // Sanity: Paddle must be configured client-side.
        const cfg = await getBillingConfig();
        if (!cfg) throw new Error('not_configured');

        let txnId;
        if (isCardUpdate) {
          const r = await fetch(
            `${API_BASE}/api/orgs/${org.id}/billing/update-payment-method`,
            { method: 'POST', credentials: 'include' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          ({ transaction_id: txnId } = await r.json());
        } else {
          const priceId = cfg.prices?.[plan]?.[cycle];
          if (!priceId) throw new Error('plan_not_configured');
          const r = await fetch(`${API_BASE}/api/orgs/${org.id}/billing/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ price_id: priceId }),
          });
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body.detail || `HTTP ${r.status}`);
          }
          ({ transaction_id: txnId } = await r.json());
        }
        if (!txnId) throw new Error('no_txn');

        setStatus('ready');
        // The frame div is rendered when status==='ready'; mount on next tick.
        // Force LIGHT theme regardless of the CRM theme — Paddle's inline
        // branding is a single global Dashboard config, so we pin the form
        // to one look (light) and host it on a white card below. This keeps
        // the payment form consistent for every user instead of half-matching
        // a dark CRM with white inputs.
        setTimeout(() => {
          openInlineCheckout(txnId, FRAME_TARGET, { theme: 'light' }).catch(e => {
            console.error('[checkout/inline]', e);
            setErrMsg(t('checkout.error', { defaultValue: 'Could not load the payment form.' }));
            setStatus('error');
          });
        }, 0);
      } catch (e) {
        console.error('[checkout]', e);
        setErrMsg(
          e.message === 'plan_not_configured'
            ? t('checkout.notConfigured', { defaultValue: 'This plan is not available yet.' })
            : t('checkout.error', { defaultValue: 'Could not start checkout. Please try again.' }));
        setStatus('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  // Guard: neither a plan nor a card-update action → bounce to billing.
  useEffect(() => {
    if (!isCardUpdate && !planMeta) backToBilling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headerTitle = isCardUpdate
    ? t('checkout.titleCard', { defaultValue: 'Update payment method' })
    : t('checkout.titlePlan', { defaultValue: 'Subscribe to {{plan}}', plan: planMeta?.name || '' });

  const priceLine = !isCardUpdate && planMeta && (
    cycle === 'yearly'
      ? t('checkout.priceYearly', {
          defaultValue: '${{m}}/mo · billed ${{y}}/year',
          m: (planMeta.yearlyTotal / 12) % 1 === 0
            ? planMeta.yearlyTotal / 12
            : (planMeta.yearlyTotal / 12).toFixed(2),
          y: planMeta.yearlyTotal,
        })
      : t('checkout.priceMonthly', { defaultValue: '${{m}}/mo', m: planMeta.monthly })
  );

  const featureKey = plan ? `pricing.plans.${plan}.features` : null;
  const features = featureKey ? t(featureKey, { returnObjects: true }) : null;

  return (
    <div className="oc-page">
      <button className="oc-back" type="button" onClick={backToBilling}>
        <ArrowLeft size={16} weight="bold" />
        {t('checkout.back', { defaultValue: 'Back to billing' })}
      </button>

      <h1 className="crm-page-title oc-title">{headerTitle}</h1>

      <div className="oc-grid">
        {/* ── Left: order summary ── */}
        <aside className="oc-summary">
          <div className="oc-summary-card">
            <div className="oc-summary-head">
              {isCardUpdate
                ? t('checkout.summaryCard', { defaultValue: 'New card on file' })
                : t('checkout.summaryPlan', { defaultValue: 'Order summary' })}
            </div>

            {!isCardUpdate && planMeta && (
              <>
                <div className="oc-summary-row">
                  <span className="oc-summary-plan">{planMeta.name}</span>
                  <span className="oc-summary-price">{priceLine}</span>
                </div>
                {Array.isArray(features) && (
                  <ul className="pr-card-list oc-features">
                    {features.slice(0, 6).map((f, i) => (
                      <li key={i}>
                        <CheckCircle size={14} weight="regular" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {isCardUpdate && (
              <p className="oc-card-note">
                {t('checkout.cardNote', {
                  defaultValue: 'Your subscription and plan stay exactly the same — only the saved card changes.',
                })}
              </p>
            )}

            <div className="oc-trust">
              <span className="oc-trust-item"><Lock size={13} weight="regular" /> {t('checkout.secure', { defaultValue: 'Secure checkout' })}</span>
              <span className="oc-trust-item"><ShieldCheck size={13} weight="regular" /> {t('checkout.byPaddle', { defaultValue: 'Payments by Paddle' })}</span>
            </div>
          </div>
        </aside>

        {/* ── Right: Paddle inline frame ── */}
        <section className="oc-pay">
          {status === 'loading' && (
            <div className="oc-state">
              <div className="oc-spinner" />
              <p>{t('checkout.preparing', { defaultValue: 'Preparing secure checkout…' })}</p>
            </div>
          )}

          {status === 'error' && (
            <div className="oc-state oc-state--error">
              <p>{errMsg}</p>
              <button className="crm-submit-btn" type="button" onClick={backToBilling}>
                {t('checkout.back', { defaultValue: 'Back to billing' })}
              </button>
            </div>
          )}

          {status === 'done' && (
            <div className="oc-state oc-state--done">
              <CheckCircle size={40} weight="fill" className="oc-done-icon" />
              <p>{t('checkout.done', { defaultValue: 'All set! Taking you back…' })}</p>
            </div>
          )}

          {/* Paddle mounts its iframe into this div (class === FRAME_TARGET).
              Always rendered once we leave 'loading' so the target exists;
              hidden under the success state when done. */}
          <div
            className={FRAME_TARGET}
            style={{ display: status === 'ready' ? 'block' : 'none' }}
          />
        </section>
      </div>
    </div>
  );
}
