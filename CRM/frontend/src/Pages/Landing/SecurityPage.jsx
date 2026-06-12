// /security — public marketing page that lays out our security posture.
// Sibling to Pricing/Terms/Privacy/Refund — same shell (Header in landing
// mode + Footer) and 1400px column. Distinct from the on-Landing Security
// section (Pages/Landing/Security.jsx) which is a short summary teaser;
// this is the full page reachable from the Footer's "Security" link.
//
// 4 grouped sections (Pillars / Infrastructure / Compliance / Incident
// response) + a final CTA. Each section renders a 2×2 grid of icon-cards
// that collapses to single column below 720px. Outline Phosphor icons —
// no fill, no glow, no 1px borders per the Landing design rules.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSeo } from '../../Utils/useSeo.js';
import {
  Lock, Cube, Key, UsersThree,
  Cloud, EnvelopeSimple, Shield, FloppyDisk,
  Scales, MapPin, FileText, Plugs,
  Warning, ArrowRight,
} from '@phosphor-icons/react';
import Header from '../../Elements/Header.jsx';
import Footer from './Footer.jsx';
import { API_BASE } from '../../api.js';
import '../../Style/Landing.css';

const PILLAR_ICONS     = { encryption: Lock,  isolation: Cube,           passwords: Key,      rbac: UsersThree };
const INFRA_ICONS      = { hosting: Cloud,    email: EnvelopeSimple,     access: Shield,      backups: FloppyDisk };
const COMPLIANCE_ICONS = { gdpr: Scales,      kzPdpa: MapPin,            audit: FileText,     subprocessors: Plugs };

// One-shot helper — render a 2×2 grid of icon-cards for a group section.
function CardGrid({ baseKey, iconMap, items }) {
  const { t } = useTranslation();
  return (
    <div className="sec-card-grid">
      {items.map(key => {
        const Icon = iconMap[key];
        return (
          <div key={key} className="sec-card">
            <div className="sec-card-icon">
              <Icon size={22} weight="regular" />
            </div>
            <div className="sec-card-body">
              <h3 className="sec-card-title">{t(`${baseKey}.items.${key}.title`)}</h3>
              <p className="sec-card-desc">{t(`${baseKey}.items.${key}.desc`)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function SecurityPage() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => {});
  }, []);

  // Locale-aware title + description + hreflang (the security copy is fully
  // translated, so /ru/security etc. are real localized pages).
  useSeo({
    title: t('security.meta.title'),
    description: t('security.hero.subtitle'),
    path: 'security',
  });

  // Pull contact email from the central legal entity block so we never
  // hard-code addresses in components — single source of truth.
  const legalEmail = t('legal.entity.email');

  // Splice the email value into the localised body by splitting on the
  // interpolated string. Keeps the email a real anchor without dragging
  // <Trans /> + components into the locale shape.
  const reportText = t('security.incident.report', { email: legalEmail });
  const reportChunks = reportText.split(legalEmail);

  return (
    <>
      <Header user={user} landing />
      <main className="ln-page sec-page">

        {/* Hero */}
        <section className="ln-section sec-hero">
          <div className="ln-wrap sec-hero-inner">
            <span className="ln-eyebrow">{t('security.hero.eyebrow')}</span>
            <h1 className="ln-h1">{t('security.hero.title')}</h1>
            <p className="ln-lead sec-hero-sub">{t('security.hero.subtitle')}</p>
          </div>
        </section>

        {/* The basics, done right */}
        <section className="ln-section sec-block">
          <div className="ln-wrap">
            <div className="sec-block-head">
              <h2 className="ln-h2">{t('security.pillars.title')}</h2>
              <p className="ln-lead">{t('security.pillars.subtitle')}</p>
            </div>
            <CardGrid baseKey="security.pillars" iconMap={PILLAR_ICONS}
              items={['encryption', 'isolation', 'passwords', 'rbac']} />
          </div>
        </section>

        {/* Infrastructure */}
        <section className="ln-section sec-block">
          <div className="ln-wrap">
            <div className="sec-block-head">
              <h2 className="ln-h2">{t('security.infra.title')}</h2>
              <p className="ln-lead">{t('security.infra.subtitle')}</p>
            </div>
            <CardGrid baseKey="security.infra" iconMap={INFRA_ICONS}
              items={['hosting', 'email', 'access', 'backups']} />
          </div>
        </section>

        {/* Compliance */}
        <section className="ln-section sec-block">
          <div className="ln-wrap">
            <div className="sec-block-head">
              <h2 className="ln-h2">{t('security.compliance.title')}</h2>
              <p className="ln-lead">{t('security.compliance.subtitle')}</p>
            </div>
            <CardGrid baseKey="security.compliance" iconMap={COMPLIANCE_ICONS}
              items={['gdpr', 'kzPdpa', 'audit', 'subprocessors']} />
          </div>
        </section>

        {/* Incident / responsible disclosure */}
        <section className="ln-section sec-block sec-incident-section">
          <div className="ln-wrap">
            <div className="sec-incident-card">
              <div className="sec-incident-icon">
                <Warning size={26} weight="regular" />
              </div>
              <div className="sec-incident-body">
                <h2 className="ln-h2">{t('security.incident.title')}</h2>
                <p className="ln-lead">{t('security.incident.body')}</p>
                <p className="sec-incident-report">
                  {reportChunks.map((chunk, i) => (
                    <span key={i}>
                      {chunk}
                      {i < reportChunks.length - 1 && (
                        <a href={`mailto:${legalEmail}`} className="sec-incident-mailto">{legalEmail}</a>
                      )}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="ln-section sec-cta-section">
          <div className="ln-wrap sec-cta-inner">
            <h2 className="ln-h2">{t('security.cta.title')}</h2>
            <p className="ln-lead sec-cta-sub">{t('security.cta.subtitle')}</p>
            <Link to="/registration" className="sec-cta-btn">
              {t('security.cta.button')} <ArrowRight size={16} weight="bold" />
            </Link>
            <p className="sec-cta-link">
              <Link to="/privacy">{t('security.cta.linkPrivacy')} →</Link>
            </p>
          </div>
        </section>

        <Footer />
      </main>
    </>
  );
}
