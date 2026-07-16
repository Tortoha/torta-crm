// Static, faithful mock of the CRM Project Overview page (light theme only).
// Structure + values mirror Pages/Project/Project.jsx; data is hardcoded.

import {
  Pulse, EnvelopeSimple, ShoppingBag, Package, CurrencyDollar,
  CalendarCheck, CaretRight, Lightning,
} from '@phosphor-icons/react';

const HEALTH = [
  { s: 'ok',   label: 'URL Configuration', detail: 'aurorathreads.com' },
  { s: 'ok',   label: 'Authentication',    detail: 'Email · Google' },
  { s: 'warn', label: 'Inventory',         detail: '2 out of stock · 3 low' },
  { s: 'ok',   label: 'Analytics',         detail: 'Tracking active' },
];

const WIDGETS = [
  { Icon: EnvelopeSimple, label: 'Email Sign-in',  value: 'Enabled' },
  { Icon: ShoppingBag,    label: 'Subscription',   value: 'Pro' },
  { Icon: Package,        label: 'Orders',         value: '14 today', pill: '3 new' },
  { Icon: CurrencyDollar, label: "Today's revenue", value: '$2,480' },
];

const ACTIVITY = [
  { Icon: Package,       name: 'Emma Carter',   sub: 'Order #1042',    date: 'Jul 15', st: 'new',       stLabel: 'New',       amount: '$128' },
  { Icon: CalendarCheck, name: 'Studio Fitting', sub: 'Booking · 3 PM', date: 'Jul 15', st: 'confirmed', stLabel: 'Confirmed', amount: '$60' },
  { Icon: Package,       name: 'Liam Novak',    sub: 'Order #1041',    date: 'Jul 15', st: 'shipped',   stLabel: 'Shipped',   amount: '$245' },
  { Icon: Package,       name: 'Sofia Reyes',   sub: 'Order #1039',    date: 'Jul 14', st: 'delivered', stLabel: 'Delivered', amount: '$89' },
  { Icon: CalendarCheck, name: 'Consultation',  sub: 'Booking · 11 AM', date: 'Jul 14', st: 'delivered', stLabel: 'Completed', amount: '$40' },
  { Icon: Package,       name: 'Noah Kim',      sub: 'Order #1037',    date: 'Jul 13', st: 'cancelled', stLabel: 'Cancelled', amount: '$54' },
  { Icon: Package,       name: 'Ava Müller',    sub: 'Order #1035',    date: 'Jul 13', st: 'refunded',  stLabel: 'Refunded',  amount: '$132' },
];

const ADVISOR = [
  { s: 'warn', label: 'Connect a payment provider', action: 'Fix' },
  { s: 'info', label: '3 products are missing photos', action: 'Fix' },
  { s: 'ok',   label: 'Email domain verified', action: 'Done' },
];

export default function MockOverview() {
  return (
    <div className="mk-ov">
      <div className="mk-ov-top">
      <div className="mk-ov-col">
        <div className="mk-ov-titlerow">
          <h3 className="mk-ov-title">Aurora Threads</h3>
          <span className="mk-ov-keys">Copy keys <CaretRight weight="bold" /></span>
        </div>

        <div className="mk-ov-health">
          <div className="mk-ov-health-head">
            <span className="mk-ov-sq"><Pulse weight="bold" /></span>
            <span className="mk-ov-htitle">Project Health</span>
            <span className="mk-ov-pill mk-ov-pill--ok">Healthy</span>
          </div>
          <div className="mk-ov-rows">
            {HEALTH.map((r) => (
              <div key={r.label} className="mk-ov-hrow">
                <span className={`mk-ov-dot mk-ov-dot--${r.s}`} />
                <span className="mk-ov-hlabel">{r.label}</span>
                <span className="mk-ov-hdetail">{r.detail}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mk-ov-widgets">
          {WIDGETS.map((w) => (
            <div key={w.label} className="mk-ov-widget">
              <span className="mk-ov-sq"><w.Icon weight="bold" /></span>
              <div className="mk-ov-winfo">
                <span className="mk-ov-wlabel">{w.label}</span>
                <span className="mk-ov-wstatus">{w.value}</span>
              </div>
              {w.pill && <span className="mk-ov-newpill">{w.pill}</span>}
              <CaretRight className="mk-ov-warrow" weight="bold" />
            </div>
          ))}
        </div>
      </div>

      <div className="mk-ov-col">
        <div className="mk-ov-recent">
          <div className="mk-ov-recent-head">
            <span className="mk-ov-rtitle">Recent Activity</span>
            <span className="mk-ov-rnew">3 new</span>
            <span className="mk-ov-rlinks">Orders <CaretRight weight="bold" /></span>
          </div>
          <div className="mk-ov-rows">
            {ACTIVITY.map((a) => (
              <div key={a.name + a.sub} className="mk-ov-arow">
                <span className="mk-ov-akind"><a.Icon weight="bold" /></span>
                <span className="mk-ov-acell-name">
                  <span className="mk-ov-aname">{a.name}</span>
                  <span className="mk-ov-asub">{a.sub}</span>
                </span>
                <span className="mk-ov-adate">{a.date}</span>
                <span className={`mk-ov-badge mk-ov-badge--${a.st}`}>{a.stLabel}</span>
                <span className="mk-ov-amount">{a.amount}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>

      <div className="mk-ov-advisor">
        <div className="mk-ov-recent-head">
          <span className="mk-ov-sq"><Lightning weight="bold" /></span>
          <span className="mk-ov-rtitle">Store Advisor</span>
          <span className="mk-ov-pill mk-ov-pill--ok">2 to review</span>
        </div>
        <div className="mk-ov-rows">
          {ADVISOR.map((a) => (
            <div key={a.label} className="mk-ov-adv-row">
              <span className={`mk-ov-dot mk-ov-dot--${a.s}`} />
              <span className="mk-ov-adv-label">{a.label}</span>
              <span className="mk-ov-adv-fix">{a.action} <CaretRight weight="bold" /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
