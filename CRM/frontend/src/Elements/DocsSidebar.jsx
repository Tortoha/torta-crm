import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Rocket, Buildings, Lightning, UsersThree, Plugs, Compass,
  Lock, Storefront, ShoppingCart, Star, CalendarCheck, ChatCircle, ChartLine,
  House, Target, Tag, Package, Users, EnvelopeSimple, FileText, GearSix,
  CreditCard, CaretDown, MapTrifold,
} from '@phosphor-icons/react';

// Three groups: CRM navigation + API guides + API reference. Same collapsible-
// section design as the project sidebar (sb-section-block + header + chevron +
// sliding indicator).
function buildGroups(t) {
  return [
    {
      id: 'crm', label: t('docs.groups.crm'),
      items: [
        { to: '/docs/getting-started',        label: t('docs.pages.gettingStarted'),        Icon: Rocket },
        { to: '/docs/organizations-projects', label: t('docs.pages.organizationsProjects'), Icon: Buildings },
        { to: '/docs/team',                   label: t('docs.pages.team'),                  Icon: UsersThree },
      ],
    },
    {
      id: 'console', label: t('docs.groups.console'),
      items: [
        { to: '/docs/overview',       label: t('docs.pages.overview'),       Icon: House },
        { to: '/docs/analytics',      label: t('docs.pages.analytics'),      Icon: ChartLine },
        { to: '/docs/targets',        label: t('docs.pages.targetsAlerts'),  Icon: Target },
        { to: '/docs/products',       label: t('docs.pages.products'),       Icon: Tag },
        { to: '/docs/orders',         label: t('docs.pages.orders'),         Icon: Package },
        { to: '/docs/booking-page',   label: t('docs.pages.bookingPage'),    Icon: CalendarCheck },
        { to: '/docs/customers-page', label: t('docs.pages.customersPage'),  Icon: Users },
        { to: '/docs/emails',         label: t('docs.pages.emails'),         Icon: EnvelopeSimple },
        { to: '/docs/chat-page',      label: t('docs.pages.chatPage'),       Icon: ChatCircle },
        { to: '/docs/authentication', label: t('docs.pages.authentication'), Icon: Lock },
        { to: '/docs/integrations',   label: t('docs.pages.integrations'),   Icon: Plugs },
        { to: '/docs/payments',       label: t('docs.pages.payments'),       Icon: CreditCard },
        { to: '/docs/documents',      label: t('docs.pages.documents'),      Icon: FileText },
        { to: '/docs/settings',       label: t('docs.pages.settings'),       Icon: GearSix },
      ],
    },
    {
      id: 'apiGuides', label: t('docs.groups.apiGuides'),
      items: [
        { to: '/docs/quickstart', label: t('docs.pages.quickstart'), Icon: Lightning },
        { to: '/docs/cheatsheet', label: t('docs.pages.cheatsheet'), Icon: MapTrifold },
        { to: '/docs/frameworks', label: t('docs.pages.frameworks'), Icon: Plugs },
        { to: '/docs/concepts',   label: t('docs.pages.concepts'),   Icon: Compass },
      ],
    },
    {
      id: 'apiRef', label: t('docs.groups.apiRef'),
      items: [
        { to: '/docs/auth',              label: t('docs.pages.auth'),             Icon: Lock },
        { to: '/docs/catalog',           label: t('docs.pages.catalog'),          Icon: Storefront },
        { to: '/docs/cart-orders',       label: t('docs.pages.cartOrders'),       Icon: ShoppingCart },
        { to: '/docs/payments-api',      label: t('docs.pages.paymentsApi'),      Icon: CreditCard },
        { to: '/docs/reviews-favorites', label: t('docs.pages.reviewsFavorites'), Icon: Star },
        { to: '/docs/booking',           label: t('docs.pages.booking'),          Icon: CalendarCheck },
        { to: '/docs/chat',              label: t('docs.pages.chat'),             Icon: ChatCircle },
        { to: '/docs/tracking',          label: t('docs.pages.tracking'),         Icon: ChartLine },
        { to: '/docs/customers',         label: t('docs.pages.customers'),        Icon: UsersThree },
      ],
    },
  ];
}

const isActivePath = (p, to) => p === to || p.startsWith(to + '/');

// Collapsible section — mirrors NavSection in Elements/Sidebar.jsx.
// `searchParams` is the raw `location.search` string (e.g. "?from=landing")
// piped through so every NavLink keeps it on click.
function DocSection({ section, open, onToggle, pathname, searchParams }) {
  const itemsEl = useRef(null);
  const itemEls = useRef({});
  const [hov, setHov] = useState(null);

  const activeKey = section.items.find(i => isActivePath(pathname, i.to))?.to ?? null;
  const cur = hov ?? activeKey;
  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = cur ? itemEls.current[cur] : null;
      if (!el || !open) { setInd(p => ({ ...p, opacity: 0 })); return; }
      setInd({ opacity: 1, y: el.offsetTop, h: el.offsetHeight });
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, open, pathname]);

  return (
    <div className="sb-block sb-section-block">
      <button type="button" className="sb-section-header" onClick={onToggle}>
        <span className="sb-section-label">{section.label}</span>
        <CaretDown className={`sb-chevron${open ? ' sb-chevron--open' : ''}`} />
      </button>
      <div className={`sb-items-wrapper${open ? ' sb-items-wrapper--open' : ''}`}>
        <div className="sb-items" ref={itemsEl} onMouseLeave={() => setHov(null)}>
          <div className="sb-indicator"
            style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }} />
          {section.items.map(({ to, label, Icon }) => (
            <div key={to}
              ref={el => { if (el) itemEls.current[to] = el; else delete itemEls.current[to]; }}
              className={`sb-item-wrap${cur === to ? ' sb-item-wrap--current' : ''}`}
              onMouseEnter={() => setHov(to)}
            >
              {/* Preserve the `?from=landing` flag (and any other search
                  params) as the user clicks through Docs sidebar items —
                  otherwise the landing-style header would switch back to
                  the app header on the first internal navigation. */}
              <NavLink to={{ pathname: to, search: searchParams }} className="sb-item">
                <Icon className="sb-icon" />
                <span className="sb-item-label">{label}</span>
              </NavLink>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DocsSidebar({ collapsed = false } = {}) {
  const location = useLocation();
  const { t }    = useTranslation();
  const groups   = buildGroups(t);

  const [open, setOpen] = useState({ crm: true, console: true, apiGuides: true, apiRef: true });
  const toggle = (id) => setOpen(prev => ({ ...prev, [id]: !prev[id] }));

  // `collapsed` only matters in the mobile drawer flow — desktop docs sidebar
  // is always expanded. The CSS in Layout.css uses `.sidebar--collapsed` to
  // hide the drawer (translateX(-100%)) below 1024px.
  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-scroll">
        <div className="sb-nav-area">
          {groups.map(g => (
            <DocSection key={g.id} section={g} open={open[g.id]}
              onToggle={() => toggle(g.id)} pathname={location.pathname}
              searchParams={location.search} />
          ))}
        </div>
      </div>
    </aside>
  );
}
