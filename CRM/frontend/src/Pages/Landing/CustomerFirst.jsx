// "Customer-first" — bento layout, mirrored from TeamReady. The two small
// cards (One-tap login + Live chat) sit on the left; the large card on the
// right (Email campaigns) carries a small mock email preview. Mirroring
// gives the page a left/right alternation rhythm — no two sections in a
// row look the same.

import { useTranslation } from 'react-i18next';
import { SignIn, ChatCircleDots, EnvelopeSimple } from '@phosphor-icons/react';
import { useInView } from '../../Utils/useInView.js';

export default function CustomerFirst() {
  const { t } = useTranslation();
  const { ref, inView } = useInView({ threshold: 0.2 });

  return (
    <section className="ln-section">
      <div className="ln-wrap">
        <div ref={ref}
          className={`ln-section-head ln-section-head--center ln-reveal${inView ? ' ln-in' : ''}`}>
          <span className="ln-eyebrow">{t('landing.customerFirst.eyebrow')}</span>
          <h2 className="ln-section-title">{t('landing.customerFirst.title')}</h2>
          <p className="ln-section-sub">{t('landing.customerFirst.subtitle')}</p>
        </div>

        <div className="ln-bento ln-bento--right">
          {/* Two smaller cards on the left */}
          <div className={`ln-bento-card ln-reveal ln-d1${inView ? ' ln-in' : ''}`}>
            <header className="ln-bento-card-head">
              <div className="ln-feature-icon">
                <SignIn weight="bold" />
              </div>
              <h3>{t('landing.customerFirst.items.auth.title')}</h3>
            </header>
            <p>{t('landing.customerFirst.items.auth.desc')}</p>
          </div>

          <div className={`ln-bento-card ln-reveal ln-d2${inView ? ' ln-in' : ''}`}>
            <header className="ln-bento-card-head">
              <div className="ln-feature-icon">
                <ChatCircleDots weight="bold" />
              </div>
              <h3>{t('landing.customerFirst.items.chat.title')}</h3>
            </header>
            <p>{t('landing.customerFirst.items.chat.desc')}</p>
          </div>

          {/* Large card on the right — anchor */}
          <div className={`ln-bento-card ln-bento-card--lg ln-reveal ln-d3${inView ? ' ln-in' : ''}`}>
            <header className="ln-bento-card-head">
              <div className="ln-feature-icon">
                <EnvelopeSimple weight="bold" />
              </div>
              <h3>{t('landing.customerFirst.items.broadcasts.title')}</h3>
            </header>
            <p>{t('landing.customerFirst.items.broadcasts.desc')}</p>

            {/* Mini email mockup — header lines that look like a composer
                preview. Decorative; nothing to interact with. */}
            <div className="ln-bento-mock ln-bento-mock--email">
              <div className="ln-bento-mock-line">
                <span>From</span>
                <em>hello@your-store.com</em>
              </div>
              <div className="ln-bento-mock-line">
                <span>To</span>
                <em>1,248 subscribers</em>
              </div>
              <div className="ln-bento-mock-line ln-bento-mock-line--subj">
                <span>Subject</span>
                <em>Spring drop is live</em>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
