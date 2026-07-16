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
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle, MinusCircle, ArrowRight, CaretDown,
} from '@phosphor-icons/react';
import Header from '../../Elements/Header.jsx';
import Footer from './Footer.jsx';
import { PoListRow } from '../../Utils/PoListRow.jsx';
import { API_BASE } from '../../api.js';
import { useSeo } from '../../Utils/useSeo.js';
import '../../Style/Landing.css';
import '../../Style/Products.css';   // po-set-table + po-set-row primitives

// 'max' ($599) is hidden for now — the price scares prospects off. Re-add 'max'
// here to restore it everywhere at once: the Pricing page cards + compare table
// (the grid tracks follow PLAN_KEYS.length) AND the landing PricingTeaser (which
// imports this same list). The in-app billing/upgrade modal is unaffected.
export const PLAN_KEYS = ['free', 'standard', 'plus', 'pro'];
const COMPARE_GROUPS = ['limits', 'features'];

// Yearly numeric values — used to render the "billed as $X/year" sub-line
// below the monthly equivalent. Free stays at $0/year, so it's omitted.
// Yearly = monthly × 11 (1 month free, ~8% off).
const YEARLY_TOTAL = { standard: 110, plus: 275, pro: 330, max: 6589 };

// ── Billing toggle ───────────────────────────────────────────────────────────

export function BillingToggle({ active, onChange }) {
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
// Exported so the Billing page's "Change subscription plan" modal can reuse
// the exact same visual without forking — we just pass `ctaSlot` to replace
// the default Link with a button that opens Paddle checkout in place.

export function PlanCard({ planKey, popular, billing, user, ownedOrgs, ctaSlot }) {
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
  // Pricing never directly opens Paddle checkout — it routes users to the
  // right place and the actual purchase happens inside the org's Billing
  // page (one clear "money lives here" surface, consistent regardless of
  // entry point):
  //   A) Anonymous → /registration
  //   B) Logged-in, free plan card → /dashboard
  //   C) Logged-in, paid plan card, owns exactly 1 org → /org/<slug>/billing
  //      with ?upgrade=<plan>&cycle=<billing> so the modal auto-opens
  //   D) Logged-in, paid plan card, owns 2+ orgs → /dashboard (let them
  //      pick which org to upgrade; one modal per org is the wrong UX)
  //   E) Logged-in, paid plan card, owns 0 orgs → /dashboard (they need
  //      to create the org first; that flow lives in Dashboard)
  // `ctaSlot` overrides the default Link entirely — used by ChangePlanModal
  // where we render a Subscribe button + Current-plan badge inline.
  const ctaLabel = t(`${base}.cta`);
  const owned = Array.isArray(ownedOrgs) ? ownedOrgs : (ownedOrgs ? [ownedOrgs] : []);
  let to;
  if (!user)                to = '/registration';
  else if (isFree)          to = '/dashboard';
  else if (owned.length === 1 && owned[0]?.slug)
                            to = `/org/${owned[0].slug}/billing?upgrade=${planKey}&cycle=${billing}`;
  else                      to = '/dashboard';   // 0 owned OR 2+ owned

  const ctaEl = ctaSlot ?? (
    <Link to={to} className={`pr-card-cta${popular ? ' pr-card-cta--solid' : ''}`}>
      {ctaLabel} <ArrowRight size={14} weight="bold" />
    </Link>
  );

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
  const [user,    setUser]    = useState(null);
  const [billing, setBilling] = useState('monthly');
  const [orgs,    setOrgs]    = useState([]); // user's orgs (each has is_owner flag)

  // All owned orgs — PlanCard routes to /org/:slug/billing only when there's
  // exactly one (auto-select). 2+ owned → /dashboard (org picker), 0 → /dashboard.
  const ownedOrgs = useMemo(
    () => (orgs || []).filter(o => o && o.is_owner),
    [orgs],
  );

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => {});
    fetch(`${API_BASE}/api/orgs`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(rows => setOrgs(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  // Per-page SEO — controlled title + description (Home resets it on the way back).
  useSeo({
    title: t('pricing.meta.title'),
    description: t('pricing.meta.description'),
    path: 'pricing',
  });

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
                          popular={k === 'pro'}
                          billing={billing}
                          user={user}
                          ownedOrgs={ownedOrgs} />
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
                <div className="po-set-table" style={{ '--pr-cols': PLAN_KEYS.length }}>
                  <div className="po-set-row po-set-row--head po-set-row--pricing">
                    <span>{t('pricing.compare.headers.feature')}</span>
                    {PLAN_KEYS.map(k => (
                      <span key={k}>{t(`pricing.compare.headers.${k}`)}</span>
                    ))}
                  </div>
                  {g.rows.map(([rowKey, row]) => (
                    <CompareRow key={rowKey} label={row.label} values={row.values.slice(0, PLAN_KEYS.length)} />
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
    </>
  );
}
