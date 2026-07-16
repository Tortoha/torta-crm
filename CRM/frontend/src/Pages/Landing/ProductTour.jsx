// Sticky scrollytelling — text column + a pinned "screenshot" stage. As the
// user scrolls the tall runway, the active step advances and the matching CRM
// mock cross-fades in. The mocks are live, scaled DOM (not images), so they
// stay crisp and always light-themed.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BrowserFrame from './mocks/BrowserFrame.jsx';
import MockProducts from './mocks/MockProducts.jsx';
import MockOrders from './mocks/MockOrders.jsx';
import MockBooking from './mocks/MockBooking.jsx';
import MockAnalytics from './mocks/MockAnalytics.jsx';

const STEPS = [
  { key: 'products',  Mock: MockProducts,  url: 'app.tortacrm.com/project/aurora-threads/products' },
  { key: 'orders',    Mock: MockOrders,    url: 'app.tortacrm.com/project/aurora-threads/orders' },
  { key: 'bookings',  Mock: MockBooking,   url: 'app.tortacrm.com/project/aurora-threads/bookings' },
  { key: 'analytics', Mock: MockAnalytics, url: 'app.tortacrm.com/project/aurora-threads/analytics' },
];

export default function ProductTour() {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const stackRef = useRef(null);

  // Scroll-driven active step: progress through the pinned runway → step index.
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      const el = stackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const stickyTop = 96;
      const duration = rect.height - (window.innerHeight - stickyTop);
      if (duration <= 0) return;
      const scrolled = Math.max(0, stickyTop - rect.top);
      const progress = Math.max(0, Math.min(0.9999, scrolled / duration));
      const idx = Math.floor(progress * STEPS.length);
      setActive((prev) => (prev === idx ? prev : idx));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    window.addEventListener('scroll', onScroll, { passive: true });
    compute();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  return (
    <section className="ln-tour" id="tour">
      <div ref={stackRef} className="ln-tour-stack" style={{ height: `${STEPS.length * 100}vh` }}>
        <div className="ln-tour-pin">
          <div className="ln-tour-pin-inner">
            <div className="ln-tour-text">
              {STEPS.map((s, i) => (
                <div key={s.key} className={`ln-tour-step${active === i ? ' ln-tour-step--active' : ''}`}>
                  <span className="ln-tour-step-label">
                    {t('landing.tour.stepWord')} {String(i + 1).padStart(2, '0')} · {t(`landing.tour.steps.${s.key}.label`)}
                  </span>
                  <h2 className="ln-tour-step-title">{t(`landing.tour.steps.${s.key}.title`)}</h2>
                  <p className="ln-tour-step-desc">{t(`landing.tour.steps.${s.key}.desc`)}</p>
                </div>
              ))}
            </div>

            <div className="ln-tour-stage">
              {STEPS.map((s, i) => (
                <div key={s.key} className={`ln-tour-shot-wrap${active === i ? ' is-active' : ''}`}>
                  <BrowserFrame url={s.url}><s.Mock /></BrowserFrame>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
