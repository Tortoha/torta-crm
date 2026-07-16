// KZ wedge — the differentiator for the Kazakhstan market: run your own store
// (not a marketplace stall) while customers still pay with Kaspi, plus local
// accounting. Copy left, a live storefront-checkout mock (Kaspi flow) right.

import { useTranslation } from 'react-i18next';
import { DeviceMobile, Receipt, Storefront } from '@phosphor-icons/react';
import { useInView } from '../../Utils/useInView.js';
import BrowserFrame from './mocks/BrowserFrame.jsx';
import MockKaspi from './mocks/MockKaspi.jsx';

const ITEMS = [
  { key: 'pay',        Icon: DeviceMobile },
  { key: 'accounting', Icon: Receipt },
  { key: 'brand',      Icon: Storefront },
];

export default function KzWedge() {
  const { t } = useTranslation();
  const { ref, inView } = useInView({ threshold: 0.15 });

  return (
    <section className="ln-section ln-kz">
      <div className="ln-wrap">
        <div className="ln-kz-grid">
          <div ref={ref} className={`ln-kz-copy ln-reveal${inView ? ' ln-in' : ''}`}>
            <span className="ln-eyebrow">{t('landing.kz.eyebrow')}</span>
            <h2 className="ln-section-title">{t('landing.kz.title')}</h2>
            <p className="ln-section-sub">{t('landing.kz.subtitle')}</p>
            <ul className="ln-kz-list">
              {ITEMS.map(({ key, Icon }) => (
                <li key={key} className="ln-kz-item">
                  <span className="ln-kz-item-ic"><Icon weight="bold" /></span>
                  <span className="ln-kz-item-txt">
                    <b>{t(`landing.kz.items.${key}.title`)}</b>
                    <span>{t(`landing.kz.items.${key}.desc`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className={`ln-kz-visual ln-reveal ln-d2${inView ? ' ln-in' : ''}`}>
            <BrowserFrame url="aurorathreads.com/checkout"><MockKaspi /></BrowserFrame>
          </div>
        </div>
      </div>
    </section>
  );
}
