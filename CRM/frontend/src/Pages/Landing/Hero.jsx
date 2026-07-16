// Landing hero — value copy (left) + an interactive console "screenshot"
// (right). The accent line types itself in; the pills switch the live mock
// (Overview / Orders / Products / Bookings / Analytics), each a faithful,
// scaled render of the real page — not an image. Frame height is fixed so the
// switch doesn't jump.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, PlayCircle, Check } from '@phosphor-icons/react';
import { useTypewriter } from '../../Utils/useTypewriter.js';
import BrowserFrame from './mocks/BrowserFrame.jsx';
import MockOverview from './mocks/MockOverview.jsx';
import MockOrders from './mocks/MockOrders.jsx';
import MockBooking from './mocks/MockBooking.jsx';
import MockAnalytics from './mocks/MockAnalytics.jsx';

const BASE = 'app.tortacrm.com/project/aurora-threads';
const VIEWS = [
  { key: 'overview',  Mock: MockOverview,  url: BASE },
  { key: 'orders',    Mock: MockOrders,    url: `${BASE}/orders` },
  { key: 'bookings',  Mock: MockBooking,   url: `${BASE}/bookings` },
  { key: 'analytics', Mock: MockAnalytics, url: `${BASE}/analytics` },
];

export default function Hero() {
  const { t } = useTranslation();
  const [view, setView] = useState('overview');
  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0];

  const accent = t('landing.hero.titleAccent');
  const { displayed, done } = useTypewriter(accent, { speed: 55, startDelay: 700 });

  const trust = t('landing.hero.trust', { returnObjects: true });
  const trustList = Array.isArray(trust) ? trust : [];

  return (
    <section className="ln-hero">
      <div className="ln-wrap ln-hero-inner">
        <div className="ln-hero-copy">
          <span className="ln-eyebrow">{t('landing.hero.eyebrow')}</span>
          <h1 className="ln-hero-title">
            <span className="ln-word">{t('landing.hero.titleLead')}</span>
            <span className="ln-hero-accent">
              {displayed}
              <span className={`ln-tw-cursor${done ? ' ln-tw-cursor--done' : ''}`} aria-hidden="true" />
            </span>
          </h1>
          <p className="ln-hero-sub">{t('landing.hero.subtitle')}</p>

          <div className="ln-hero-cta">
            <Link to="/registration" className="ln-btn ln-btn--primary ln-btn--lg">
              {t('landing.hero.ctaPrimary')} <ArrowRight weight="bold" />
            </Link>
            <a href="#tour" className="ln-btn ln-btn--ghost ln-btn--lg">
              <PlayCircle weight="bold" /> {t('landing.hero.ctaSecondary')}
            </a>
          </div>

          <ul className="ln-hero-trust">
            {trustList.map((item, i) => (
              <li key={i}><Check weight="bold" /> <span>{item}</span></li>
            ))}
          </ul>
        </div>

        <div className="ln-hero-visual">
          <div className="ln-hero-tabs" role="tablist">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" role="tab" aria-selected={view === v.key}
                className={`ln-hero-tab${view === v.key ? ' ln-hero-tab--on' : ''}`}
                onClick={() => setView(v.key)}>
                {t(`landing.hero.tabs.${v.key}`)}
              </button>
            ))}
          </div>
          <div key={view} className="ln-hero-shot">
            <BrowserFrame url={active.url} screenHeight={418}>
              <active.Mock />
            </BrowserFrame>
          </div>
        </div>
      </div>
    </section>
  );
}
