// Pricing page — public marketing surface reachable from the Landing
// Header's Pricing tab and the Footer.
//
// Visual building blocks reused from the rest of the app:
//   • Header (landing mode) + Footer — same as Landing
//   • Billing toggle (Monthly/Yearly) — mirrors UseCases.jsx auth-tab
//     pattern: indicator slides via direct DOM mutation inside rAF,
//     tracks `hovered ?? active`. Yearly carries a "Save 17%" badge.
//   • Plan cards — Standard variant uses an accent border + halo (not
//     inverse fill), which reads cleanly in both light and dark themes.
//   • Compare table — `po-set-table` + `PoListRow` rows (same as Targets
//     list view). Header pill on top, rounded body rows, hover lift.
//   • FAQ — smooth open/close via the `grid-template-rows: 0fr→1fr`
//     trick (no max-height guess, no jumps); caret rotates 180°.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle, MinusCircle, ArrowRight, CaretDown,
} from '@phosphor-icons/react';
import Header from '../../Elements/Header.jsx';
import Footer from './Footer.jsx';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import { API_BASE } from '../../api.js';
import {
  getBillingConfig, openCheckout, onPaddleEvent,
} from '../../Utils/paddle.js';
import '../../Style/Landing.css';
import '../../Style/Products.css';   // po-set-table + po-set-row primitives

const PLAN_KEYS = ['free', 'standard', 'plus', 'pro'];
const COMPARE_GROUPS = ['limits', 'features'];

// Yearly numeric values — used to render the "billed as $X/year" sub-line
// below the monthly equivalent. Free stays at $0/year, so it's omitted.
const YEARLY_TOTAL = { standard: 100, plus: 250, pro: 1000 };

// ── Billing toggle ───────────────────────────────────────────────────────────

function BillingToggle({ active, onChange }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(null);
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const cur = hovered ?? active;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[cur];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, active]);

  const tabs = [
    { key: 'monthly', label: t('pricing.billing.monthly'), badge: null },
    { key: 'yearly',  label: t('pricing.billing.yearly'),  badge: t('pricing.billing.saveBadge') },
  ];

  return (
    <div className="pr-bill-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="pr-bill-toggle-ind" />
      {tabs.map(tab => (
        <button key={tab.key}
          ref={el => { btnRefs.current[tab.key] = el; }}
          className={`pr-bill-toggle-tab${active === tab.key ? ' is-active' : ''}`}
          onMouseEnter={() => setHovered(tab.key)}
          onClick={() => onChange(tab.key)}
          type="button">
          {tab.label}
          {tab.badge && <span className="pr-bill-toggle-badge">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({ planKey, popular, billing, user, ownedOrg, billingCfg, onUpgrade, busyKey }) {
  const { t } = useTranslation();
  const base = `pricing.plans.${planKey}`;
  const features = t(`${base}.features`, { returnObjects: true });
  const badge = t(`${base}.badge`, { defaultValue: '' });

  // Show monthly amount in both modes; for yearly mode, add the
  // "billed as $X/year" sub-line. Free always shows "forever".
  const isFree = planKey === 'free';
  const yearly = billing === 'yearly';
  const price  = isFree
    ? t(`${base}.priceMonthly`)
    : (yearly ? `$${(YEARLY_TOTAL[planKey] / 12).toFixed(2).replace(/\.00$/, '')}` : t(`${base}.priceMonthly`));
  const priceSub = isFree
    ? t('pricing.billing.forever')
    : t('pricing.billing.perMonth');
  const billedAs = !isFree && yearly
    ? t('pricing.billing.billedAs', { amount: YEARLY_TOTAL[planKey] })
    : null;

  // ── CTA logic ──
  // 3 distinct paths:
  //   A) Anonymous user → keep the legacy /registration link (same UX as before)
  //   B) Logged-in user, free plan card → /dashboard (their existing org/start)
  //   C) Logged-in user, paid plan card + at least one owned org + Paddle is
  //      configured → onClick triggers inline checkout (Paddle.js overlay).
  // When (C)'s preconditions aren't met (no org / Paddle not yet configured
  // on this env) we fall back to /registration so the CTA is never dead.
  const priceForPlan = !isFree && billingCfg && billingCfg.prices && billingCfg.prices[planKey]
    ? billingCfg.prices[planKey][yearly ? 'yearly' : 'monthly']
    : '';
  const canCheckout = !!user && !isFree && !!ownedOrg && !!priceForPlan;
  const isBusy = busyKey === planKey;
  const ctaLabel = t(`${base}.cta`);

  let ctaEl;
  if (canCheckout) {
    ctaEl = (
      <button type="button"
              className={`pr-card-cta pr-card-cta--btn${popular ? ' pr-card-cta--solid' : ''}`}
              onClick={() => onUpgrade(planKey, priceForPlan)}
              disabled={isBusy}>
        {isBusy
          ? t('pricing.billing.processing', { defaultValue: 'Opening checkout…' })
          : ctaLabel}
        {!isBusy && <ArrowRight size={14} weight="bold" />}
      </button>
    );
  } else {
    const to = user ? '/dashboard' : '/registration';
    ctaEl = (
      <Link to={to} className={`pr-card-cta${popular ? ' pr-card-cta--solid' : ''}`}>
        {ctaLabel} <ArrowRight size={14} weight="bold" />
      </Link>
    );
  }

  return (
    <div className={`pr-card${popular ? ' pr-card--popular' : ''}`}>
      {badge && <span className="pr-card-badge">{badge}</span>}
      <h3 className="pr-card-name">{t(`${base}.name`)}</h3>
      <p className="pr-card-tag">{t(`${base}.tagline`)}</p>
      <div className="pr-card-price">
        <span className="pr-card-price-amount">{price}</span>
        <span className="pr-card-price-sub">{priceSub}</span>
      </div>
      <p className="pr-card-billed-as">{billedAs || ' '}</p>
      {ctaEl}
      <ul className="pr-card-list">
        {Array.isArray(features) && features.map((f, i) => (
          <li key={i}>
            <CheckCircle size={14} weight="regular" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Comparison cell (used inside po-set-row) ─────────────────────────────────

function CompareCell({ value }) {
  if (value === true)  return <CheckCircle size={16} weight="regular" className="pr-cmp-ok" />;
  if (value === false) return <MinusCircle size={16} weight="regular" className="pr-cmp-no" />;
  return <span className="pr-cmp-val">{value}</span>;
}

// ── Single comparison row (po-set-row variant, tilt+gloss) ───────────────────

function CompareRow({ label, values }) {
  return (
    <PoListRow className="po-set-row--pricing">
      <span className="pr-cmp-feature">{label}</span>
      {values.map((v, i) => (
        <span key={i} className="pr-cmp-cell">
          <CompareCell value={v} />
        </span>
      ))}
    </PoListRow>
  );
}

// ── FAQ row (smooth grid-rows 0fr→1fr open) ─────────────────────────────────

function FaqRow({ qKey }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className={`pr-faq-row${open ? ' is-open' : ''}`}>
      <button className="pr-faq-q" onClick={() => setOpen(o => !o)} type="button">
        <span>{t(`pricing.faq.items.${qKey}.q`)}</span>
        <CaretDown size={14} weight="bold" className="pr-faq-caret" />
      </button>
      <div className="pr-faq-collapse">
        <div className="pr-faq-collapse-inner">
          <div className="pr-faq-a">{t(`pricing.faq.items.${qKey}.a`)}</div>
        </div>
      </div>
    </div>
  );
}

// ── Pricing page ─────────────────────────────────────────────────────────────

export default function Pricing() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [user, setUser]             = useState(null);
  const [billing, setBilling]       = useState('monthly');
  const [orgs, setOrgs]             = useState([]);   // user's orgs (each has is_owner flag)
  const [billingCfg, setBillingCfg] = useState(null); // /api/billing/config response
  const [busyKey, setBusyKey]       = useState(null); // plan currently in checkout (spinner state)
  const [toast, setToast]           = useState(null); // bottom toast: { msg, kind: 'ok' | 'err' }

  // First-owned org auto-selected for the diploma's common case (each user
  // owns one org). Multi-org users still upgrade — they just upgrade their
  // first-created owned org. Switching org for billing belongs in a future
  // dedicated billing page inside org settings.
  const ownedOrg = useMemo(
    () => (orgs || []).find(o => o && o.is_owner) || null,
    [orgs],
  );

  // Auto-dismiss toast after 3.2s — same timing as global auth-toast in
  // Authentication.css so the visual rhythm is consistent across the app.
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    // Parallel fetch — none of these depend on each other.
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => {});
    fetch(`${API_BASE}/api/orgs`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(rows => setOrgs(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    getBillingConfig().then(setBillingCfg).catch(() => setBillingCfg(null));
  }, []);

  // Subscribe to Paddle events while this page is mounted. We only react to
  // checkout.completed (success) — the "closed" event without "completed"
  // means the user dismissed Paddle's modal, which is silent.
  useEffect(() => {
    const off = onPaddleEvent(ev => {
      if (!ev) return;
      if (ev.name === 'checkout.completed' || ev.name === 'checkout.payment.succeeded') {
        setBusyKey(null);
        setToast({ msg: t('pricing.billing.success', { defaultValue: 'Plan upgraded — welcome aboard!' }), kind: 'ok' });
        // Land on the dashboard; the webhook will have updated plan_slug
        // by the time the user clicks around. Race-free in practice — Paddle
        // fires the webhook a beat before completing the overlay event.
        setTimeout(() => navigate('/dashboard'), 1200);
      } else if (ev.name === 'checkout.error' || ev.name === 'checkout.payment.failed') {
        setBusyKey(null);
        setToast({ msg: t('pricing.billing.failed', { defaultValue: 'Payment failed — try a different card.' }), kind: 'err' });
      } else if (ev.name === 'checkout.closed') {
        setBusyKey(null);  // user dismissed overlay; silent
      }
    });
    return off;
  }, [navigate, t]);

  // Click handler: POST to /billing/checkout then hand the txn_id to Paddle.js.
  // Errors flow into the bottom toast; spinner clears on event or error.
  async function handleUpgrade(planKey, priceId) {
    if (!ownedOrg) return;
    setBusyKey(planKey);
    try {
      const r = await fetch(`${API_BASE}/api/orgs/${ownedOrg.id}/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ price_id: priceId }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${r.status}`);
      }
      const { transaction_id } = await r.json();
      if (!transaction_id) throw new Error('No transaction_id returned');
      await openCheckout(transaction_id);
      // Spinner clears via Paddle event (completed/closed/error). If Paddle
      // never reports back (e.g. extension blocked Paddle.js), we still want
      // to release the spinner — a small safety timer caps it at 30s.
      setTimeout(() => setBusyKey(b => (b === planKey ? null : b)), 30000);
    } catch (e) {
      setBusyKey(null);
      setToast({ msg: t('pricing.billing.failed', { defaultValue: 'Payment failed — try a different card.' }), kind: 'err' });
      console.error('[pricing/upgrade]', e);
    }
  }

  useEffect(() => {
    document.title = t('pricing.meta.title');
  }, [t]);

  // Flatten compare groups into ordered chunks for rendering. Each group has
  // a label header + N rows; we render them as separate sub-tables so a tiny
  // group title can appear between blocks of rows.
  const groups = useMemo(() => COMPARE_GROUPS.map(g => {
    const groupBase = `pricing.compare.groups.${g}`;
    const rows = t(`${groupBase}.rows`, { returnObjects: true });
    return {
      key: g,
      title: t(`${groupBase}.title`),
      rows: rows && typeof rows === 'object' ? Object.entries(rows) : [],
    };
  }), [t]);

  const faqKeys = useMemo(() => {
    const items = t('pricing.faq.items', { returnObjects: true });
    return items && typeof items === 'object' ? Object.keys(items) : [];
  }, [t]);

  return (
    <>
      <Header user={user} landing />
      <main className="ln-page pr-page">

        {/* Hero */}
        <section className="ln-section pr-hero">
          <div className="ln-wrap pr-hero-inner">
            <span className="ln-eyebrow">{t('pricing.hero.eyebrow')}</span>
            <h1 className="ln-h1">{t('pricing.hero.title')}</h1>
            <p className="ln-lead pr-hero-sub">{t('pricing.hero.subtitle')}</p>
            <BillingToggle active={billing} onChange={setBilling} />
          </div>
        </section>

        {/* Plan grid */}
        <section className="ln-section pr-plans-section">
          <div className="ln-wrap">
            <div className="pr-plans-grid">
              {PLAN_KEYS.map(k => (
                <PlanCard key={k}
                          planKey={k}
                          popular={k === 'standard'}
                          billing={billing}
                          user={user}
                          ownedOrg={ownedOrg}
                          billingCfg={billingCfg}
                          onUpgrade={handleUpgrade}
                          busyKey={busyKey} />
              ))}
            </div>
          </div>
        </section>

        {/* Compare table — po-set-table primitive from Targets/PromoCodes */}
        <section className="ln-section pr-compare-section">
          <div className="ln-wrap">
            <div className="pr-section-head">
              <h2 className="ln-h2">{t('pricing.compare.title')}</h2>
              <p className="ln-lead">{t('pricing.compare.subtitle')}</p>
            </div>

            {groups.map(g => (
              <div key={g.key} className="pr-cmp-group-wrap">
                <h3 className="pr-cmp-group-title">{g.title}</h3>
                <div className="po-set-table">
                  <div className="po-set-row po-set-row--head po-set-row--pricing">
                    <span>{t('pricing.compare.headers.feature')}</span>
                    {PLAN_KEYS.map(k => (
                      <span key={k}>{t(`pricing.compare.headers.${k}`)}</span>
                    ))}
                  </div>
                  {g.rows.map(([rowKey, row]) => (
                    <CompareRow key={rowKey} label={row.label} values={row.values} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="ln-section pr-faq-section">
          <div className="ln-wrap pr-faq-wrap">
            <h2 className="ln-h2">{t('pricing.faq.title')}</h2>
            <div className="pr-faq-list">
              {faqKeys.map(k => <FaqRow key={k} qKey={k} />)}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="ln-section pr-cta-section">
          <div className="ln-wrap pr-cta-inner">
            <h2 className="ln-h2">{t('pricing.cta.title')}</h2>
            <p className="ln-lead pr-cta-sub">{t('pricing.cta.subtitle')}</p>
            <Link to="/registration" className="pr-cta-btn">
              {t('pricing.cta.button')} <ArrowRight size={16} weight="bold" />
            </Link>
            <p className="pr-cta-fine">{t('pricing.cta.fineprint')}</p>
          </div>
        </section>

        <Footer />
      </main>

      {/* Toast portal — bottom pill, same pattern as global auth-toast.
          Re-mounts on every (msg, kind) change so the 3.2s timer restarts
          when a second event arrives mid-display. */}
      {toast && createPortal(
        <div className={`auth-toast${toast.kind === 'err' ? ' auth-toast--err' : ''}`}>
          {toast.msg}
        </div>,
        document.body,
      )}
    </>
  );
}
