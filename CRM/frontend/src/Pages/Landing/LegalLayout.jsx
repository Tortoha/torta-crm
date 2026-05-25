// Shared shell for the three legal pages (Terms / Privacy / Refund). Each
// caller passes the locale namespace under `legal.<doc>` (e.g. "terms") and
// the layout pulls hero, sections and meta from that fragment. Sticky TOC on
// the left, content on the right, contact card at the bottom. Public Header
// (landing prop) keeps the same Pricing+Docs tabs as the rest of the site.

import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import Header from '../../Elements/Header.jsx';
import Footer from './Footer.jsx';
import { API_BASE } from '../../api.js';
import '../../Style/Landing.css';

export default function LegalLayout({ doc }) {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [activeId, setActiveId] = useState('');
  const base = `legal.${doc}`;

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.title = t(`${base}.meta.title`);
  }, [t, base]);

  const sections = useMemo(() => {
    const raw = t(`${base}.sections`, { returnObjects: true });
    return Array.isArray(raw) ? raw : [];
  }, [t, base]);

  // Scrollspy — highlight TOC entry as user scrolls past each section heading.
  useEffect(() => {
    const els = sections
      .map(s => document.getElementById(`sec-${s.id}`))
      .filter(Boolean);
    if (!els.length) return;
    const handle = () => {
      const probe = window.scrollY + 120;
      let current = els[0].id;
      for (const el of els) {
        if (el.offsetTop <= probe) current = el.id;
        else break;
      }
      setActiveId(current.replace('sec-', ''));
    };
    handle();
    window.addEventListener('scroll', handle, { passive: true });
    return () => window.removeEventListener('scroll', handle);
  }, [sections]);

  const email = t('legal.entity.email');
  const date = t(`${base}.hero.date`);

  return (
    <>
      <Header user={user} landing />
      <main className="ln-page lg-page">

        {/* Hero */}
        <section className="ln-section lg-hero">
          <div className="ln-wrap lg-hero-inner">
            <span className="ln-eyebrow">{t(`${base}.hero.eyebrow`)}</span>
            <h1 className="ln-h1">{t(`${base}.hero.title`)}</h1>
            <p className="ln-lead lg-hero-intro">{t(`${base}.hero.intro`)}</p>
            <p className="lg-hero-date">{t('legal.common.lastUpdated')}: {date}</p>
          </div>
        </section>

        {/* Body: TOC + content */}
        <section className="ln-section lg-body-section">
          <div className="ln-wrap lg-body">

            {/* Sticky TOC */}
            <aside className="lg-toc">
              <h6 className="lg-toc-title">{t('legal.common.tocTitle')}</h6>
              <ul>
                {sections.map(s => (
                  <li key={s.id}>
                    <a
                      href={`#sec-${s.id}`}
                      className={activeId === s.id ? 'is-active' : ''}
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </aside>

            {/* Content */}
            <article className="lg-content">
              {sections.map(s => (
                <section key={s.id} id={`sec-${s.id}`} className="lg-section">
                  <h2 className="lg-h2">{s.title}</h2>
                  {Array.isArray(s.paragraphs) && s.paragraphs.map((p, i) => (
                    <p key={i} className="lg-p">{p}</p>
                  ))}
                </section>
              ))}

              {/* Contact card */}
              <section className="lg-contact-card">
                <h3 className="lg-contact-title">{t('legal.common.contactTitle')}</h3>
                <p className="lg-contact-body">
                  <Trans
                    i18nKey="legal.common.contactBody"
                    values={{ email }}
                    components={{ a: <a href={`mailto:${email}`} className="lg-link" /> }}
                  />
                </p>
                <div className="lg-entity-block">
                  <div>{t('legal.entity.name')}</div>
                  <div>БИН / BIN: {t('legal.entity.bin')}</div>
                  <div>{t('legal.entity.address')}</div>
                  <div><a href={`mailto:${email}`} className="lg-link">{email}</a></div>
                </div>
              </section>
            </article>

          </div>
        </section>

        <Footer />
      </main>
    </>
  );
}
