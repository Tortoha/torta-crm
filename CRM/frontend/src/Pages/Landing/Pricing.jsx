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

function PlanCard({ planKey, popular, billing }) {
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
      <Link to="/registration" className={`pr-card-cta${popular ? ' pr-card-cta--solid' : ''}`}>
        {t(`${base}.cta`)} <ArrowRight size={14} weight="bold" />
      </Link>
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
  const [user, setUser]       = useState(null);
  const [billing, setBilling] = useState('monthly');

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => {});
  }, []);

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
                <PlanCard key={k} planKey={k} popular={k === 'standard'} billing={billing} />
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
    </>
  );
}
