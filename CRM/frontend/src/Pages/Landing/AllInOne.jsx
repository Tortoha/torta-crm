// "All-in-one" — the consolidation pitch. Replaces the small "All-in-one"
// stat tile that used to sit in the hero. Visual: a compact 4×2 grid of
// feature chips with icons, framed by a centred headline + subtitle.

import { useTranslation } from 'react-i18next';
import {
  Package, ShoppingCart, CalendarBlank, Users, EnvelopeSimple, ChatCircleDots,
  UsersThree, ChartLineUp,
} from '@phosphor-icons/react';
import { useInView } from '../../Utils/useInView.js';

const CHIPS = [
  { key: 'products',   Icon: Package },
  { key: 'orders',     Icon: ShoppingCart },
  { key: 'bookings',   Icon: CalendarBlank },
  { key: 'customers',  Icon: Users },
  { key: 'marketing',  Icon: EnvelopeSimple },
  { key: 'chat',       Icon: ChatCircleDots },
  { key: 'team',       Icon: UsersThree },
  { key: 'analytics',  Icon: ChartLineUp },
];

export default function AllInOne() {
  const { t } = useTranslation();
  const { ref: headRef, inView: headIn } = useInView({ threshold: 0.25 });

  return (
    <section className="ln-section">
      <div className="ln-wrap">
        <div ref={headRef}
          className={`ln-section-head ln-section-head--center ln-reveal${headIn ? ' ln-in' : ''}`}>
          <span className="ln-eyebrow">{t('landing.allInOne.eyebrow')}</span>
          <h2 className="ln-section-title">{t('landing.allInOne.title')}</h2>
          <p className="ln-section-sub">{t('landing.allInOne.subtitle')}</p>
        </div>

        <div className="ln-aio-grid">
          {CHIPS.map(({ key, Icon }) => (
            <div key={key} className="ln-aio-chip">
              <span className="ln-aio-chip-icon">
                <Icon weight="bold" />
              </span>
              <span className="ln-aio-chip-label">
                {t(`landing.allInOne.items.${key}`)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
