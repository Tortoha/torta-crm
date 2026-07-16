// Pricing teaser — surfaces the real plan cards (all five) on the landing so
// "how much?" is answered without leaving the page. Reuses the exact PlanCard +
// BillingToggle from the Pricing page (same design, theme-aware) — no fork.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from '@phosphor-icons/react';
import { useInView } from '../../Utils/useInView.js';
import { PlanCard, BillingToggle, PLAN_KEYS } from './Pricing.jsx';
import { API_BASE } from '../../api.js';

export default function PricingTeaser() {
  const { t } = useTranslation();
  const { ref, inView } = useInView({ threshold: 0.1 });
  const [billing, setBilling] = useState('monthly');
  const [user, setUser] = useState(null);
  const [orgs, setOrgs] = useState([]);

  // Best-effort — lets a logged-in owner's CTA route to their org billing.
  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null)).then(setUser).catch(() => {});
    fetch(`${API_BASE}/api/orgs`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : [])).then((rows) => setOrgs(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, []);

  const ownedOrgs = (orgs || []).filter((o) => o && o.is_owner);

  return (
    <section className="ln-section ln-pricing">
      <div className="ln-wrap">
        <div ref={ref} className={`ln-section-head ln-section-head--center ln-reveal${inView ? ' ln-in' : ''}`}>
          <span className="ln-eyebrow">{t('landing.pricing.eyebrow')}</span>
          <h2 className="ln-section-title">{t('landing.pricing.title')}</h2>
          <p className="ln-section-sub">{t('landing.pricing.subtitle')}</p>
          <BillingToggle active={billing} onChange={setBilling} />
        </div>

        <div className="pr-plans-grid">
          {PLAN_KEYS.map((k) => (
            <PlanCard key={k} planKey={k} popular={k === 'pro'} billing={billing} user={user} ownedOrgs={ownedOrgs} />
          ))}
        </div>

        <Link to="/pricing" className="ln-pricing-all">
          {t('landing.pricing.allPlans')} <ArrowRight weight="bold" />
        </Link>
      </div>
    </section>
  );
}
