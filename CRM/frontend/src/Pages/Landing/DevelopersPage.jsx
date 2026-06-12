// Developers → API. A living marketing page that sells the storefront API:
// one tiny SDK, secure by default, framework-agnostic, live in minutes. Pulls
// the essence of the SDK / API Reference / Frameworks / Quickstart docs into a
// page that *sells* rather than dumps. Reuses the .ln-* + .pf-* primitives;
// the hero code animates in via GSAP, sections reveal on scroll.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import gsap from 'gsap';
import {
  CheckCircle, Key, Lock, ArrowsClockwise, ShieldCheck, ArrowRight,
} from '@phosphor-icons/react';
import Header from '../../Elements/Header.jsx';
import Footer from './Footer.jsx';
import { API_BASE } from '../../api.js';
import { useSeo } from '../../Utils/useSeo.js';
import { useInView } from '../../Utils/useInView.js';
import '../../Style/Landing.css';
import '../../Style/Product.css';
import '../../Style/Developers.css';

// Tiny syntax-coloured code tokens (colours from Landing.css .ln-cd-*).
const K = ({ children }) => <span className="ln-cd-kw">{children}</span>;
const F = ({ children }) => <span className="ln-cd-fn">{children}</span>;
const S = ({ children }) => <span className="ln-cd-str">{children}</span>;
const C = ({ children }) => <span className="ln-cd-com">{children}</span>;
const N = ({ children }) => <span className="ln-cd-num">{children}</span>;
const Line = ({ children }) => <div className="dev-code-line">{children ?? ' '}</div>;

function CodeBlock({ hero, children }) {
  return (
    <div className={`dev-code${hero ? ' dev-code--hero' : ''}`}>
      <div className="dev-code-bar"><i /><i /><i /></div>
      <div className="dev-code-body">{children}</div>
    </div>
  );
}

function Reveal({ as: Tag = 'div', className = '', delay, children, ...rest }) {
  const { ref, inView } = useInView({ threshold: 0.15 });
  const d = delay ? ` ln-d${delay}` : '';
  return (
    <Tag ref={ref} className={`${className} ln-reveal${d}${inView ? ' ln-in' : ''}`} {...rest}>
      {children}
    </Tag>
  );
}

const NAMESPACES = [
  ['products', 'Catalog'], ['cart', 'Cart'], ['orders', 'Orders'],
  ['payments', 'Checkout'], ['auth', 'Sign-in'], ['favorites', 'Wishlists'],
  ['reviews', 'Reviews'], ['booking', 'Bookings'], ['chat', 'Live chat'],
  ['track', 'Analytics'],
];

const FRAMEWORKS = ['Next.js', 'React', 'Vue', 'SvelteKit', 'Astro', 'Remix', 'Nuxt', 'Solid'];

const SECURE_ICONS = [Key, Lock, ArrowsClockwise, ShieldCheck];

export default function DevelopersPage() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const heroRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null)).then(setUser).catch(() => {});
  }, []);

  useSeo({
    title: 'Developer API — Torta CRM',
    description: t('developers.hero.lead'),
    path: 'developers',
  });

  // Hero code — stagger the lines in on mount (above the fold).
  useEffect(() => {
    if (!heroRef.current) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.dev-code--hero .dev-code-line',
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.1, ease: 'power2.out', delay: 0.15 });
    }, heroRef);
    return () => ctx.revert();
  }, []);

  const td = (k, o) => t(`developers.${k}`, o);
  const secureCards = td('secure.cards', { returnObjects: true }) || [];
  const steps = td('quickstart.steps', { returnObjects: true }) || [];
  const stepCode = [
    <Line key="1">npm <F>install</F> torta-js</Line>,
    <Line key="2"><K>const</K> store = <F>createClient</F>(url, key);</Line>,
    <Line key="3"><K>await</K> store.<F>auth</F>.<F>sendCode</F>({'{'} email {'}'});</Line>,
  ];

  return (
    <>
      <Header user={user} landing />
      <main className="ln-page">
        {/* ── Hero ── */}
        <section className="pf-hero" ref={heroRef}>
          <div className="ln-wrap">
            <div className="pf-hero-inner">
              <div className="pf-hero-text">
                <span className="ln-eyebrow">{td('hero.eyebrow')}</span>
                <h1 className="ln-h1">{td('hero.title')}</h1>
                <p className="ln-lead">{td('hero.lead')}</p>
                <div className="pf-hero-cta">
                  <Link className="ln-btn ln-btn--primary" to="/login">{td('meta.getStarted')}</Link>
                  <Link className="ln-btn ln-btn--ghost" to="/docs/quickstart?from=landing">{td('meta.docs')}</Link>
                </div>
              </div>
              <CodeBlock hero>
                <Line><K>import</K> {'{ createClient }'} <K>from</K> <S>"torta-js"</S>;</Line>
                <Line />
                <Line><C>// two browser-safe keys, from your project overview</C></Line>
                <Line><K>const</K> store = <F>createClient</F>(API_URL, API_KEY);</Line>
                <Line />
                <Line><K>const</K> {'{ data }'} = <K>await</K> store.<F>products</F>.<F>list</F>();</Line>
                <Line><K>await</K> store.<F>cart</F>.<F>add</F>(productId, variationId, sizeId, <N>1</N>);</Line>
                <Line><K>const</K> order = <K>await</K> store.<F>orders</F>.<F>place</F>(payload);</Line>
              </CodeBlock>
            </div>
          </div>
        </section>

        {/* ── One client, every endpoint ── */}
        <section className="ln-section">
          <div className="ln-wrap">
            <Reveal className="ln-section-head ln-section-head--center">
              <span className="ln-eyebrow">{td('one.eyebrow')}</span>
              <h2 className="ln-section-title">{td('one.title')}</h2>
              <p className="ln-section-sub">{td('one.lead')}</p>
            </Reveal>
            <div className="dev-ns-grid">
              {NAMESPACES.map(([ns, label], i) => (
                <Reveal className="dev-ns" key={ns} delay={(i % 5) + 1}>
                  <code className="dev-ns-code">client.{ns}</code>
                  <span className="dev-ns-label">{label}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Secure by default ── */}
        <section className="ln-section ln-section--tight">
          <div className="ln-wrap">
            <Reveal className="ln-section-head ln-section-head--center">
              <span className="ln-eyebrow">{td('secure.eyebrow')}</span>
              <h2 className="ln-section-title">{td('secure.title')}</h2>
              <p className="ln-section-sub">{td('secure.lead')}</p>
            </Reveal>
            <div className="ln-sec-grid">
              {secureCards.map((c, i) => {
                const Ic = SECURE_ICONS[i] || ShieldCheck;
                return (
                  <Reveal className="ln-sec-row" key={i} delay={(i % 4) + 1}>
                    <div className="ln-sec-icon"><Ic weight="bold" /></div>
                    <div>
                      <h4>{c.title}</h4>
                      <p>{c.desc}</p>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Same shape every time ── */}
        <section className="ln-section">
          <div className="ln-wrap">
            <div className="pf-split">
              <Reveal className="pf-split-text">
                <span className="ln-eyebrow">{td('shape.eyebrow')}</span>
                <h2 className="pf-split-title">{td('shape.title')}</h2>
                <p className="pf-split-body">{td('shape.lead')}</p>
              </Reveal>
              <Reveal className="pf-split-art" delay={1}>
                <CodeBlock>
                  <Line><K>const</K> r = <K>await</K> store.<F>products</F>.<F>list</F>();</Line>
                  <Line />
                  <Line><K>if</K> (!r.ok) <K>return</K> <F>toast</F>(r.error); <C>// ready-to-show</C></Line>
                  <Line><F>render</F>(r.data);</Line>
                  <Line />
                  <Line><C>{'// { ok, status, data, error } — every time'}</C></Line>
                </CodeBlock>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Works with your framework ── */}
        <section className="ln-section ln-section--tight">
          <div className="ln-wrap">
            <Reveal className="ln-section-head ln-section-head--center">
              <span className="ln-eyebrow">{td('frameworks.eyebrow')}</span>
              <h2 className="ln-section-title">{td('frameworks.title')}</h2>
              <p className="ln-section-sub">{td('frameworks.lead')}</p>
            </Reveal>
            <Reveal className="dev-fw-row">
              {FRAMEWORKS.map(f => <span className="dev-fw" key={f}>{f}</span>)}
            </Reveal>
          </div>
        </section>

        {/* ── Quickstart ── */}
        <section className="ln-section">
          <div className="ln-wrap">
            <Reveal className="ln-section-head ln-section-head--center">
              <span className="ln-eyebrow">{td('quickstart.eyebrow')}</span>
              <h2 className="ln-section-title">{td('quickstart.title')}</h2>
              <p className="ln-section-sub">{td('quickstart.lead')}</p>
            </Reveal>
            <div className="dev-steps">
              {steps.map((s, i) => (
                <Reveal className="dev-step" key={i} delay={(i % 3) + 1}>
                  <span className="dev-step-num">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                  <CodeBlock>{stepCode[i]}</CodeBlock>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="ln-cta">
          <div className="ln-wrap">
            <div className="ln-cta-inner">
              <span className="ln-eyebrow">{td('cta.eyebrow')}</span>
              <h2 className="ln-cta-title">{td('cta.title')}</h2>
              <p className="ln-cta-sub">{td('cta.sub')}</p>
              <div className="pf-hero-cta" style={{ justifyContent: 'center' }}>
                <Link className="ln-btn ln-btn--primary" to="/login">{td('meta.getStarted')}</Link>
                <Link className="ln-btn ln-btn--ghost" to="/docs/cheatsheet?from=landing">{td('meta.reference')}</Link>
              </div>
            </div>
          </div>
        </section>

        <Footer />
      </main>
    </>
  );
}
