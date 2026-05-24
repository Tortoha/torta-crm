// "How to start" — three horizontal cards connected by arrows. No giant
// numbers; the arrows do the sequencing for the eye. On mobile the cards
// stack vertically and the arrows rotate 90° to point downward.

import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from '@phosphor-icons/react';
import { useInView } from '../../Utils/useInView.js';

const STEPS = ['setup', 'connect', 'run'];

export default function HowItWorks() {
  const { t } = useTranslation();
  const { ref, inView } = useInView({ threshold: 0.2 });

  return (
    <section className="ln-section">
      <div className="ln-wrap">
        <div ref={ref}
          className={`ln-section-head ln-section-head--center ln-reveal${inView ? ' ln-in' : ''}`}>
          <span className="ln-eyebrow">{t('landing.howItWorks.eyebrow')}</span>
          <h2 className="ln-section-title">{t('landing.howItWorks.title')}</h2>
          <p className="ln-section-sub">{t('landing.howItWorks.subtitle')}</p>
        </div>

        <div className="ln-steps">
          {STEPS.map((k, i) => (
            <Fragment key={k}>
              <div className={`ln-step ln-reveal ln-d${i + 1}${inView ? ' ln-in' : ''}`}>
                <h3>{t(`landing.howItWorks.steps.${k}.title`)}</h3>
                <p>{t(`landing.howItWorks.steps.${k}.desc`)}</p>
              </div>
              {/* Arrow between cards — last card doesn't get one. */}
              {i < STEPS.length - 1 && (
                <div className="ln-step-arrow" aria-hidden="true">
                  <ArrowRight weight="bold" />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
