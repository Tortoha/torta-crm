// Centered final call-to-action. Plain headline, plain button, plain
// fineprint. No magnetic hover, no breathing blob — just the message.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from '@phosphor-icons/react';
import { useInView } from '../../Utils/useInView.js';

export default function FinalCta() {
  const { t } = useTranslation();
  const { ref, inView } = useInView({ threshold: 0.25 });

  return (
    <section className="ln-cta" ref={ref}>
      <div className="ln-wrap">
        <div className={`ln-cta-inner ln-reveal${inView ? ' ln-in' : ''}`}>
          <h2 className="ln-cta-title">{t('landing.cta.title')}</h2>
          <p className="ln-cta-sub">{t('landing.cta.subtitle')}</p>
          <Link to="/login" className="ln-btn ln-btn--primary ln-btn--lg">
            {t('landing.cta.button')} <ArrowRight weight="bold" />
          </Link>
          <span className="ln-cta-foot">{t('landing.cta.fineprint')}</span>
        </div>
      </div>
    </section>
  );
}
