// Sticky scrollytelling — both the text column AND the image stage are
// pinned to the top of the viewport while the user scrolls past a tall
// outer container. As the scroll progresses, the active step advances and
// the matching screenshot cross-fades into view.
//
// Layout rules:
//  - Section header sits in the normal flow (centred 1400px wrap).
//  - `.ln-tour-stack` provides the scroll runway: tall enough that the
//    inner sticky pin has time to advance through every step.
//  - `.ln-tour-pin-inner` is wider than the page's normal 1400px wrap —
//    1700px — so the screenshot has room to breathe while in view.
//  - Inactive text steps are dimmed (opacity ~0.3) so the eye stays on
//    the active one; the matching screenshot is the only one with
//    opacity:1 in the right-hand stage.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const STEPS = [
  { key: 'products',  name: 'Products'  },
  { key: 'orders',    name: 'Orders'    },
  { key: 'bookings',  name: 'Booking'   },
  { key: 'analytics', name: 'Analytics' },
];

export default function ProductTour() {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const stackRef = useRef(null);

  // Scroll-driven active step. Math:
  //   scrolled  = how far the user has scrolled INTO the pinned period
  //   duration  = how far the pin is sticky (stack height − viewport)
  //   progress  = scrolled / duration, 0..1
  //   active    = floor(progress × stepCount)
  // We coalesce updates through requestAnimationFrame to keep the scroll
  // handler cheap and avoid re-rendering on every wheel tick.
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      const el = stackRef.current;
      if (!el) return;
      const rect      = el.getBoundingClientRect();
      const stickyTop = 96;
      const viewportH = window.innerHeight;
      const duration  = rect.height - (viewportH - stickyTop);
      if (duration <= 0) return;
      const scrolled = Math.max(0, stickyTop - rect.top);
      const progress = Math.max(0, Math.min(0.9999, scrolled / duration));
      const idx      = Math.floor(progress * STEPS.length);
      setActive(prev => prev === idx ? prev : idx);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(compute);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    compute();
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Section-head removed by request — the page reads cleaner when the
  // marquee flows straight into the pinned scrollytelling without an
  // intermediate "PRODUCT TOUR / heading" block above it.

  return (
    <section className="ln-tour" id="tour">
      {/* Tall outer container provides the scroll runway. Inline height
          is set in vh so the runway scales with viewport — one viewport
          per step gives roughly ~75vh of scroll between each transition
          once you subtract the pin's own height. */}
      <div ref={stackRef} className="ln-tour-stack"
        style={{ height: `${STEPS.length * 100}vh` }}>
        <div className="ln-tour-pin">
          <div className="ln-tour-pin-inner">
            {/* ── Left: stacked step text. Inactive steps fade out so
                the active one reads as the "current chapter". ── */}
            <div className="ln-tour-text">
              {STEPS.map((s, i) => (
                <div key={s.key}
                  className={`ln-tour-step${active === i ? ' ln-tour-step--active' : ''}`}>
                  <span className="ln-tour-step-label">
                    {t('landing.tour.stepWord')} {String(i + 1).padStart(2, '0')} · {t(`landing.tour.steps.${s.key}.label`)}
                  </span>
                  <h3 className="ln-tour-step-title">{t(`landing.tour.steps.${s.key}.title`)}</h3>
                  <p className="ln-tour-step-desc">{t(`landing.tour.steps.${s.key}.desc`)}</p>
                </div>
              ))}
            </div>

            {/* ── Right: image stage. All 4 screenshots stacked at the
                same spot, cross-faded between via opacity. Both light +
                dark variants pre-loaded so the theme toggle is instant. ── */}
            <div className="ln-tour-stage">
              {STEPS.map((s, i) => (
                <div key={s.key}
                  className={`ln-tour-shot-wrap${active === i ? ' is-active' : ''}`}>
                  <img
                    className="ln-tour-shot ln-tour-shot--light"
                    src={`/Landing/${s.name}_L.webp`}
                    alt={t(`landing.tour.steps.${s.key}.title`)}
                    width="1920" height="1080"
                    loading="lazy" />
                  <img
                    className="ln-tour-shot ln-tour-shot--dark"
                    src={`/Landing/${s.name}_B.webp`}
                    alt={t(`landing.tour.steps.${s.key}.title`)}
                    width="1920" height="1080"
                    loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
