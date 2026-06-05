// Data-driven product feature page. One component renders all six pages
// (/product/:slug) from per-slug config (product/data.js) + i18n copy
// (locales/{en,ru}/product.json). Each page: hero with a signature GSAP
// illustration → truthful stat strip → capability cards → a deep-dive split
// with the concrete list of things it supports → CTA + explore links.
//
// Section reveals reuse the landing's .ln-reveal system (useInView); the
// hero illustration animates via GSAP (product/illustrations.jsx).

import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle, ArrowRight } from '@phosphor-icons/react';
import Header from '../../Elements/Header.jsx';
import Footer from './Footer.jsx';
import { API_BASE } from '../../api.js';
import { useSeo } from '../../Utils/useSeo.js';
import { useInView } from '../../Utils/useInView.js';
import { PRODUCTS, PRODUCT_SLUGS } from './product/data.js';
import { ILLUSTRATIONS } from './product/illustrations.jsx';
import '../../Style/Landing.css';
import '../../Style/Product.css';

// Reveal-on-scroll wrapper — mirrors how the landing sections fade up.
function Reveal({ as: Tag = 'div', className = '', delay, children, ...rest }) {
  const { ref, inView } = useInView({ threshold: 0.15 });
  const d = delay ? ` ln-d${delay}` : '';
  return (
    <Tag ref={ref} className={`${className} ln-reveal${d}${inView ? ' ln-in' : ''}`} {...rest}>
      {children}
    </Tag>
  );
}

export default function ProductPage({ slug: slugProp }) {
  const params = useParams();
  const slug = slugProp || params.slug;
  const cfg = PRODUCTS[slug];
  const { t } = useTranslation();
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null)).then(setUser).catch(() => {});
  }, []);

  const tp = (k, o) => (cfg ? t(`product.${slug}.${k}`, o) : '');
  useSeo({
    title: cfg ? `${tp('hero.eyebrow')} — Torta CRM` : 'Torta CRM',
    description: cfg ? tp('hero.lead') : '',
    canonical: `https://tortacrm.com/${slug}`,
  });

  // Unknown slug → home.
  if (!cfg) return <Navigate to="/" replace />;

  const Illus = ILLUSTRATIONS[slug];
  const stats = tp('stats', { returnObjects: true }) || [];
  const cards = tp('cards', { returnObjects: true }) || [];
  const points = tp('deep.points', { returnObjects: true }) || [];
  const chips = tp('deep.chips', { returnObjects: true }) || [];
  const others = PRODUCT_SLUGS.filter(s => s !== slug);

  return (
    <>
      <Header user={user} landing />
      <main className="ln-page">
        {/* ── Hero ── */}
        <section className="pf-hero">
          <div className="ln-wrap">
            <div className="pf-hero-inner">
              <div className="pf-hero-text">
                <div className="pf-hero-icon"><cfg.Icon weight="bold" /></div>
                <span className="ln-eyebrow">{tp('hero.eyebrow')}</span>
                <h1 className="ln-h1">{tp('hero.title')}</h1>
                <p className="ln-lead">{tp('hero.lead')}</p>
                <div className="pf-hero-cta">
                  <Link className="ln-btn ln-btn--primary" to="/login">
                    {t('product.meta.getStarted')}
                  </Link>
                  <Link className="ln-btn ln-btn--ghost" to={`${cfg.docsTo}?from=landing`}>
                    {t('product.meta.docs')}
                  </Link>
                </div>
              </div>
              <div className="pf-art pf-art--hero">{Illus && <Illus />}</div>
            </div>
          </div>
        </section>

        {/* ── Stat strip ── */}
        <section className="ln-section ln-section--tight">
          <div className="ln-wrap">
            <div className="pf-stats">
              {stats.map((s, i) => (
                <Reveal className="pf-stat" key={i} delay={(i % 4) + 1}>
                  <b>{s.value}</b>
                  <span>{s.label}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Capability cards ── */}
        <section className="ln-section">
          <div className="ln-wrap">
            <Reveal className="ln-section-head ln-section-head--center">
              <span className="ln-eyebrow">{tp('hero.eyebrow')}</span>
              <h2 className="ln-section-title">{t('product.meta.featuresTitle')}</h2>
            </Reveal>
            <div className="ln-features-grid">
              {cards.map((c, i) => {
                const Ic = cfg.cardIcons[i];
                return (
                  <Reveal className="ln-feature" key={i} delay={(i % 3) + 1}>
                    <div className="ln-feature-icon">{Ic && <Ic weight="bold" />}</div>
                    <h3>{c.title}</h3>
                    <p>{c.desc}</p>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Deep-dive split: points + the concrete list ── */}
        <section className="ln-section">
          <div className="ln-wrap">
            <div className="pf-split pf-split--reverse">
              <Reveal className="pf-split-text">
                <span className="ln-eyebrow">{tp('deep.eyebrow')}</span>
                <h2 className="pf-split-title">{tp('deep.title')}</h2>
                <p className="pf-split-body">{tp('deep.body')}</p>
                <ul className="pf-points">
                  {points.map((p, i) => (
                    <li key={i}><CheckCircle weight="fill" /> {p}</li>
                  ))}
                </ul>
              </Reveal>
              <Reveal className="pf-split-art" delay={1}>
                <div className="pf-art">
                  <div className="pf-chips-panel">
                    <span className="pf-chips-title">{tp('deep.chipsTitle')}</span>
                    <div className="pf-chips">
                      {chips.map((c, i) => <span className="pf-chip" key={i}>{c}</span>)}
                    </div>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── CTA + explore other products ── */}
        <section className="ln-cta">
          <div className="ln-wrap">
            <div className="ln-cta-inner">
              <span className="ln-eyebrow">{t('product.meta.ctaEyebrow')}</span>
              <h2 className="ln-cta-title">{t('product.meta.ctaTitle')}</h2>
              <p className="ln-cta-sub">{t('product.meta.ctaSub')}</p>
              <div className="pf-hero-cta" style={{ justifyContent: 'center' }}>
                <Link className="ln-btn ln-btn--primary" to="/login">
                  {t('product.meta.getStarted')}
                </Link>
                <Link className="ln-btn ln-btn--ghost" to="/pricing">
                  {t('product.meta.seePricing')}
                </Link>
              </div>
              <div className="pf-explore">
                <span className="pf-explore-label">{t('product.meta.exploreTitle')}</span>
                <div className="pf-explore-links">
                  {others.map(s => {
                    const OIc = PRODUCTS[s].Icon;
                    return (
                      <Link className="pf-explore-link" to={`/${s}`} key={s}>
                        <OIc weight="bold" /> {t(`product.nav.name.${s}`)} <ArrowRight weight="bold" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <Footer />
      </main>
    </>
  );
}
