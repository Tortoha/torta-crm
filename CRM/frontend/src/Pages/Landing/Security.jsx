// "Built for trust" — 4 short bullets in a 2×2 grid. No competitor logos, no
// fake certifications. Just an honest list of what's wired in by default.

import { useTranslation } from 'react-i18next';
import { Shield, KeyReturn, Lock, FileText } from '@phosphor-icons/react';
import { useInView } from '../../Utils/useInView.js';

const ITEMS = [
  { key: 'twoKey',  Icon: Shield },
  { key: 'dkim',    Icon: KeyReturn },
  { key: 'rbac',    Icon: Lock },
  { key: 'audit',   Icon: FileText },
];

export default function Security() {
  const { t } = useTranslation();
  const { ref, inView } = useInView({ threshold: 0.2 });
  return (
    <section className="ln-section ln-section--tight">
      <div className="ln-wrap">
        <div ref={ref} className={`ln-section-head ln-reveal${inView ? ' ln-in' : ''}`}>
          <span className="ln-eyebrow">{t('landing.security.eyebrow')}</span>
          <h2 className="ln-section-title">{t('landing.security.title')}</h2>
          <p className="ln-section-sub">{t('landing.security.subtitle')}</p>
        </div>

        <div className="ln-sec-grid">
          {ITEMS.map(({ key, Icon }, i) => (
            <div key={key} className={`ln-sec-row ln-reveal ln-d${(i % 4) + 1}${inView ? ' ln-in' : ''}`}>
              <div className="ln-sec-icon">
                <Icon weight="bold" />
              </div>
              <div>
                <h3>{t(`landing.security.items.${key}.title`)}</h3>
                <p>{t(`landing.security.items.${key}.desc`)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
