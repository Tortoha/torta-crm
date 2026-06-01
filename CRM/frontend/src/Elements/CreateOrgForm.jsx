// Shared "create organization" form body — used by both the Dashboard modal
// and the Header org-switcher modal.
//
// Two paths:
//   • Free plan  → POST /api/orgs, done.
//   • Paid plan  → the org is NOT created up front. Picking a paid plan opens a
//     Paddle transaction for a brand-new org (POST /api/billing/new-org-transaction,
//     no org_id) and mounts Paddle's INLINE checkout on a white card inside the
//     modal. The org is created ONLY after checkout.completed: the client then
//     POSTs /api/orgs and links the paid subscription via /billing/claim.
//
// Why this shape: the org must not exist before payment (close the modal and
// nothing is created). Reading the exact transaction at claim time is precise —
// it never attaches the wrong subscription for a user who owns several paid orgs,
// and it works locally without waiting on a webhook to reach localhost.
//
// Props:
//   labels                — { name, namePlaceholder, plan, create, creating, nameRequired, error }
//   onOrgCreated(org)     — fired once a row appears in the DB (free submit OR
//                           the post-payment create); caller prepends it.
//   onDone(org, { paid }) — fired when the flow finishes; caller closes + navigates.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../api.js';
import { openInlineCheckout, onPaddleEvent, getBillingConfig } from '../Utils/paddle.js';
import PlanSelect from './PlanSelect.jsx';

const FRAME_TARGET = 'paddle-create-frame';

// Monthly price for the order-summary line (mirrors Pricing / OrgCheckout).
const PLAN_PRICE = { standard: 10, plus: 25, pro: 30, max: 599 };

export default function CreateOrgForm({ labels, onOrgCreated, onDone }) {
  const { t } = useTranslation();

  const [name,   setName]   = useState('');
  const [plan,   setPlan]   = useState('free');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  // Paid sub-flow.
  const [payStatus, setPayStatus] = useState('idle');  // idle | need-name | preparing | ready | finalizing | finalize-error | done | error
  const [payErr,    setPayErr]    = useState('');

  const txnIdRef    = useRef(null);    // current Paddle transaction id
  const txnPlanRef  = useRef(null);    // plan the live txn was opened for
  const pendingRef  = useRef(null);    // plan to (re)start once the in-flight op settles
  const busyRef     = useRef(false);
  const completedRef = useRef(false);  // guards double-handling of the completed event
  const paidOrgRef  = useRef(null);    // org created post-payment (kept for retry)

  // Keep the latest callbacks reachable from the Paddle listener (registered once).
  const onOrgCreatedRef = useRef(onOrgCreated); onOrgCreatedRef.current = onOrgCreated;
  const onDoneRef       = useRef(onDone);       onDoneRef.current       = onDone;

  // ── API helpers ───────────────────────────────────────────────────────
  const createOrgApi = async orgName => {
    const res  = await fetch(`${API_BASE}/api/orgs`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: orgName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || labels.error);
    return data;
  };

  // Open a Paddle transaction for a NOT-YET-CREATED org (returns transaction_id).
  const openNewOrgTxnApi = async targetPlan => {
    const cfg = await getBillingConfig();
    if (!cfg) throw new Error('not_configured');
    const priceId = cfg.prices?.[targetPlan]?.monthly;
    if (!priceId) throw new Error('plan_not_configured');
    const r = await fetch(`${API_BASE}/api/billing/new-org-transaction`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_id: priceId }),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      throw new Error(b.detail || `HTTP ${r.status}`);
    }
    const { transaction_id } = await r.json();
    if (!transaction_id) throw new Error('no_txn');
    return transaction_id;
  };

  const claimApi = async (orgId, txnId) => {
    const r = await fetch(`${API_BASE}/api/orgs/${orgId}/billing/claim`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: txnId }),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      throw new Error(b.detail || `HTTP ${r.status}`);
    }
    return r.json().catch(() => ({}));
  };

  const mountWidget = txnId => {
    // The frame div is already in the DOM (rendered for the whole paid branch);
    // open on the next tick so it's visible (display:block) when Paddle mounts.
    // Pin LIGHT theme: the form sits on a fixed white card (.hdr-pay-card) — the
    // same deliberate "secure payment" panel as the OrgCheckout page.
    setTimeout(() => {
      openInlineCheckout(txnId, FRAME_TARGET, { theme: 'light' }).catch(e => {
        console.error('[create-org/inline]', e);
        setPayErr(t('common.createOrg.error'));
        setPayStatus('error');
      });
    }, 0);
  };

  // Open a Paddle txn for `targetPlan` and mount the inline form. No org yet.
  const startPaid = async targetPlan => {
    if (!name.trim()) { pendingRef.current = targetPlan; setPayStatus('need-name'); return; }
    if (busyRef.current) { pendingRef.current = targetPlan; return; }
    busyRef.current = true;
    setPayStatus('preparing'); setPayErr('');
    try {
      const txnId = await openNewOrgTxnApi(targetPlan);
      txnIdRef.current   = txnId;
      txnPlanRef.current = targetPlan;
      setPayStatus('ready');
      mountWidget(txnId);
    } catch (e) {
      console.error('[create-org/paid]', e);
      setPayErr(
        e.message === 'plan_not_configured' || e.message === 'not_configured'
          ? t('common.createOrg.notConfigured')
          : t('common.createOrg.error'));
      setPayStatus('error');
    } finally {
      busyRef.current = false;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next && next !== 'free' && next !== txnPlanRef.current) startPaid(next);
    }
  };

  // Payment succeeded → NOW create the org and attach the subscription.
  const finalize = async () => {
    setPayStatus('finalizing'); setPayErr('');
    try {
      let org = paidOrgRef.current;
      if (!org) {                                   // create once; retry reuses it
        org = await createOrgApi(name.trim());
        paidOrgRef.current = org;
        onOrgCreatedRef.current?.(org);
      }
      await claimApi(org.id, txnIdRef.current);
      setPayStatus('done');
      setTimeout(() => onDoneRef.current?.(org, { paid: true }), 900);
    } catch (e) {
      console.error('[create-org/finalize]', e);
      setPayErr(t('common.createOrg.finalizeError'));
      setPayStatus('finalize-error');
    }
  };

  // The Paddle listener below is registered ONCE, so it must call the LATEST
  // finalize (current name/refs) — not a stale first-render closure where the
  // name was still empty. That stale capture was the "setup didn't finish" bug.
  const finalizeRef = useRef(null);
  finalizeRef.current = finalize;

  const handlePlanChange = next => {
    setPlan(next);
    setErr('');
    if (next === 'free') { pendingRef.current = null; setPayStatus('idle'); return; }
    if (next === txnPlanRef.current && payStatus === 'ready') return;   // already showing this plan
    startPaid(next);
  };

  // Free path.
  const submitFree = async e => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setErr(labels.nameRequired); return; }
    setSaving(true); setErr('');
    try {
      const created = await createOrgApi(trimmed);
      onOrgCreatedRef.current?.(created);
      onDoneRef.current?.(created, { paid: false });
    } catch (e2) {
      setErr(e2?.message || t('common.networkError'));
    } finally {
      setSaving(false);
    }
  };

  // Picked a paid plan with an empty name → start the moment a name is typed.
  useEffect(() => {
    if (payStatus === 'need-name' && name.trim() && pendingRef.current) {
      const p = pendingRef.current; pendingRef.current = null; startPaid(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Paddle checkout lifecycle (registered once for this modal).
  useEffect(() => {
    const off = onPaddleEvent(ev => {
      if (!ev) return;
      if (ev.name === 'checkout.completed' || ev.name === 'checkout.payment.succeeded') {
        if (completedRef.current) return;   // both events can fire — handle once
        completedRef.current = true;
        finalizeRef.current?.();
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPaid    = plan !== 'free';
  const planTitle = isPaid ? plan.charAt(0).toUpperCase() + plan.slice(1) : '';

  return (
    <form onSubmit={submitFree}>
      <div className="hdr-modal-field">
        <h4 className="hdr-modal-label">{labels.name} <span style={{ color: '#ef4444' }}>*</span></h4>
        <input
          className="hdr-modal-input"
          placeholder={labels.namePlaceholder}
          value={name}
          onChange={e => { setName(e.target.value); setErr(''); }}
          autoFocus
          maxLength={100}
        />
      </div>

      <div className="hdr-modal-field">
        <h4 className="hdr-modal-label">{labels.plan}</h4>
        <PlanSelect value={plan} onChange={handlePlanChange} />
      </div>

      {!isPaid ? (
        <>
          {err && <span className="hdr-modal-err">{err}</span>}
          <button className="hdr-modal-submit" type="submit" disabled={saving || !name.trim()}>
            {saving ? labels.creating : labels.create}
          </button>
        </>
      ) : (
        <div className="hdr-pay">
          <div className="hdr-pay-summary">
            <span className="hdr-pay-plan">{planTitle}</span>
            <span className="hdr-pay-price">${PLAN_PRICE[plan]}{t('common.createOrg.perMonth')}</span>
          </div>

          {payStatus === 'need-name' ? (
            <p className="hdr-pay-hint">{t('common.createOrg.needName')}</p>
          ) : (
            /* Fixed white "secure payment" card (Paddle pinned to light), the
               same deliberate panel as the OrgCheckout page. */
            <div className="hdr-pay-card">
              {payStatus === 'preparing' && (
                <div className="hdr-pay-state-l">
                  <span className="hdr-pay-spinner-l" />
                  {t('common.createOrg.preparing')}
                </div>
              )}
              {payStatus === 'finalizing' && (
                <div className="hdr-pay-state-l">
                  <span className="hdr-pay-spinner-l" />
                  {t('common.createOrg.finalizing')}
                </div>
              )}
              {payStatus === 'error' && (
                <div className="hdr-pay-state-l">
                  <span className="hdr-pay-err-l">{payErr}</span>
                  <button type="button" className="hdr-modal-submit" style={{ marginTop: 0 }}
                    onClick={() => startPaid(plan)}>
                    {t('common.createOrg.retry')}
                  </button>
                </div>
              )}
              {payStatus === 'finalize-error' && (
                <div className="hdr-pay-state-l">
                  <span className="hdr-pay-err-l">{payErr}</span>
                  <button type="button" className="hdr-modal-submit" style={{ marginTop: 0 }}
                    onClick={finalize}>
                    {t('common.createOrg.retry')}
                  </button>
                </div>
              )}
              {payStatus === 'done' && (
                <div className="hdr-pay-state-l hdr-pay-state-l--done">{t('common.createOrg.done')}</div>
              )}

              {/* Paddle mounts its iframe into this div (class === FRAME_TARGET). */}
              <div className={FRAME_TARGET} style={{ display: payStatus === 'ready' ? 'block' : 'none' }} />
            </div>
          )}
        </div>
      )}
    </form>
  );
}
