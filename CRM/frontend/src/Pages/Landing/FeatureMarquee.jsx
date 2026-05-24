// Marquee of feature pills. No third-party logo wall.
// Layout (top → bottom): narrow 720px band with edge-fade masks → label
// underneath. Track duplicates the pill list so the loop is seamless when
// transform: -50% pulls the first copy off-screen.

import { useTranslation } from 'react-i18next';
import {
  Storefront, Stack, ChartLineUp, ChatCircleDots, Package, CalendarBlank,
  EnvelopeSimple, CurrencyDollar, Shield, UsersThree, Bell, Truck,
} from '@phosphor-icons/react';

const PILLS = [
  { key: 'multiStore',  Icon: Storefront },
  { key: 'allInOne',    Icon: Stack },
  { key: 'analytics',   Icon: ChartLineUp },
  { key: 'chat',        Icon: ChatCircleDots },
  { key: 'orders',      Icon: Package },
  { key: 'booking',     Icon: CalendarBlank },
  { key: 'broadcasts',  Icon: EnvelopeSimple },
  { key: 'multiCcy',    Icon: CurrencyDollar },
  { key: 'rbac',        Icon: Shield },
  { key: 'team',        Icon: UsersThree },
  { key: 'alerts',      Icon: Bell },
  { key: 'fulfil',      Icon: Truck },
];

export default function FeatureMarquee() {
  const { t } = useTranslation();
  // Render the pill list twice so the loop is seamless. The keyframe pulls
  // the track by -50% which lands the second copy exactly where the first
  // copy was at t=0.
  return (
    <div className="ln-marquee">
      <div className="ln-marquee-band">
        <div className="ln-marquee-track">
          {[...PILLS, ...PILLS].map(({ key, Icon }, i) => (
            <span key={i} className="ln-marquee-pill">
              <Icon weight="bold" />
              <span>{t(`landing.marquee.items.${key}`)}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="ln-marquee-label">{t('landing.marquee.label')}</div>
    </div>
  );
}
