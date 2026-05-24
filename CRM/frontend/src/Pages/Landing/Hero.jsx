// Landing hero — centred copy + CTAs + a row of stats. That's it.
// The previous "fake dashboard mockup" was misleading (it didn't look like
// the actual CRM), so the merchant asked to remove it. Anything visual
// from here on lives in the marquee, the product tour and the feature
// sections below — all of which show real product surface area.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, PlayCircle } from '@phosphor-icons/react';

export default function Hero() {
  const { t } = useTranslation();

  // Split the title at the `|` delimiter so each word gets its own
  // rise animation. `titleAccentIndex` (from locale) picks the word
  // painted in --accent.
  const titleWords = t('landing.hero.title').split('|');
  const accentWordIdx = Number(t('landing.hero.titleAccentIndex'));

  return (
    <section className="ln-hero">
      <div className="ln-wrap ln-hero-inner">
        <span className="ln-eyebrow">{t('landing.hero.eyebrow')}</span>
        <h1 className="ln-hero-title">
          {titleWords.map((w, i) => {
            // A `<br>` token in the locale forces an explicit line break — keeps
            // the wrap predictable across viewports instead of relying on the
            // natural break point shifting around with font-size + container width.
            if (w === '<br>') return <br key={i} />;
            return (
              <span key={i}
                className={`ln-word${i === accentWordIdx ? ' ln-word--accent' : ''}`}
                style={{ animationDelay: `${i * 70}ms` }}>
                {w}
              </span>
            );
          })}
        </h1>
        <p className="ln-hero-sub">{t('landing.hero.subtitle')}</p>

        <div className="ln-hero-cta">
          <Link to="/login" className="ln-btn ln-btn--primary">
            {t('landing.hero.ctaPrimary')} <ArrowRight weight="bold" />
          </Link>
          <a href="#tour" className="ln-btn ln-btn--ghost">
            <PlayCircle weight="bold" /> {t('landing.hero.ctaSecondary')}
          </a>
        </div>
        {/* Three angles on the value prop (all-in-one / team-ready /
            customer-first) used to sit here as a compact stats row, but the
            merchant asked to give each one its own dedicated section further
            down. See AllInOne / TeamReady / CustomerFirst components below. */}
      </div>
    </section>
  );
}
