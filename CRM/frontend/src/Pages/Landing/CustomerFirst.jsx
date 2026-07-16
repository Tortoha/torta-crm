// "Customer-first" — the customer-facing tools, shown not told: a live chat
// inbox mock (left) + copy with three points (right). Mirrors the KZ section's
// layout inverted, so the page rhythm alternates.

import { useTranslation } from 'react-i18next';
import { SignIn, ChatCircleDots, EnvelopeSimple } from '@phosphor-icons/react';
import { useInView } from '../../Utils/useInView.js';
import BrowserFrame from './mocks/BrowserFrame.jsx';
import MockChat from './mocks/MockChat.jsx';

const ITEMS = [
  { key: 'auth',       Icon: SignIn },
  { key: 'chat',       Icon: ChatCircleDots },
  { key: 'broadcasts', Icon: EnvelopeSimple },
];

export default function CustomerFirst() {
  const { t } = useTranslation();
  const { ref, inView } = useInView({ threshold: 0.15 });

  return (
    <section className="ln-section ln-cf">
      <div className="ln-wrap">
        <div className="ln-cf-grid">
          <div className={`ln-cf-visual ln-reveal${inView ? ' ln-in' : ''}`}>
            <BrowserFrame url="app.tortacrm.com/project/aurora-threads/chat"><MockChat /></BrowserFrame>
          </div>

          <div ref={ref} className={`ln-cf-copy ln-reveal ln-d2${inView ? ' ln-in' : ''}`}>
            <span className="ln-eyebrow">{t('landing.customerFirst.eyebrow')}</span>
            <h2 className="ln-section-title">{t('landing.customerFirst.title')}</h2>
            <p className="ln-section-sub">{t('landing.customerFirst.subtitle')}</p>
            <ul className="ln-kz-list">
              {ITEMS.map(({ key, Icon }) => (
                <li key={key} className="ln-kz-item">
                  <span className="ln-kz-item-ic"><Icon weight="bold" /></span>
                  <span className="ln-kz-item-txt">
                    <b>{t(`landing.customerFirst.items.${key}.title`)}</b>
                    <span>{t(`landing.customerFirst.items.${key}.desc`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
