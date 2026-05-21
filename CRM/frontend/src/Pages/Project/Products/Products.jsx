import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Tag, FolderSimple, Archive, Ticket, Percent, ChartBar, Warehouse, ListBullets, GearSix, Stack } from '@phosphor-icons/react';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';

export default function Products() {
  const ctx        = useOutletContext();
  const location   = useLocation();
  const navigate   = useNavigate();
  const { apiKey } = useParams();
  const base       = `/project/${apiKey}/products`;

  const TABS = [
    { key: 'list',          to: base,                     label: 'Products',     Icon: Tag,          page: 'products' },
    { key: 'categories',    to: `${base}/categories`,     label: 'Categories',   Icon: FolderSimple, page: 'products' },
    { key: 'inventory',     to: `${base}/inventory`,      label: 'Inventory',    Icon: ListBullets,  page: 'inventory' },
    { key: 'batches',       to: `${base}/batches`,        label: 'Batches',      Icon: Stack,        page: 'batches' },
    { key: 'promo-codes',   to: `${base}/promo-codes`,    label: 'Promo codes',  Icon: Ticket,       page: 'promo_codes' },
    { key: 'discounts',     to: `${base}/discounts`,      label: 'Discount',     Icon: Percent,      page: 'discounts' },
    { key: 'tier-pricing',  to: `${base}/tier-pricing`,   label: 'Tier pricing', Icon: ChartBar,     page: 'tier_pricing' },
    { key: 'warehouses',    to: `${base}/warehouses`,     label: 'Warehouses',   Icon: Warehouse,    page: 'warehouses' },
    { key: 'archive',       to: `${base}/archive`,        label: 'Archive',      Icon: Archive,      page: 'archive' },
    { key: 'settings',      to: `${base}/settings`,       label: 'Settings',     Icon: GearSix,      page: 'product_settings' },
  ];
  // Hide sub-tabs the member's role can't view; redirect off a hidden one.
  const access = ctx?.access;
  const canViewTab = (page) =>
    !access || access.is_owner || ['view', 'manage'].includes(access.permissions?.[page]);
  const visibleTabs = TABS.filter(t => canViewTab(t.page));
  const path = location.pathname;
  const activeKey =
    path.endsWith('/categories')   ? 'categories'   :
    path.endsWith('/inventory')    ? 'inventory'    :
    path.endsWith('/batches')      ? 'batches'      :
    path.endsWith('/promo-codes')  ? 'promo-codes'  :
    path.endsWith('/discounts')    ? 'discounts'    :
    path.endsWith('/tier-pricing') ? 'tier-pricing' :
    path.endsWith('/warehouses')   ? 'warehouses'   :
    path.endsWith('/settings')     ? 'settings'     :
    path.endsWith('/archive')      ? 'archive'      : 'list';
  const titleByKey = {
    list: 'Products', categories: 'Categories', archive: 'Archive',
    inventory: 'Inventory', settings: 'Product settings',
    batches: 'Batches',
    'promo-codes': 'Promo codes', discounts: 'Discount',
    'tier-pricing': 'Tier pricing', warehouses: 'Warehouses',
  };

  useEffect(() => {
    if (!access || access.is_owner) return;
    const active = TABS.find(t => t.key === activeKey);
    if (active && !canViewTab(active.page) && visibleTabs.length > 0) {
      navigate(visibleTabs[0].to, { replace: true });
    }
  }, [activeKey, access]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="prod-page-wrap">
      <TabSwitcher tabs={visibleTabs} activeKey={activeKey} onPick={to => navigate(to)} />
      <h1 className="crm-page-title">{titleByKey[activeKey]}</h1>
      <Outlet context={ctx} />
    </div>
  );
}

// ── Tab switcher: centered pill (mirrors Booking/Authentication) ─

function TabSwitcher({ tabs, activeKey, onPick }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curKey = hovered ?? activeKey;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[curKey];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curKey, activeKey]);

  return (
    <div className="auth-tab-wrapper">
      <div className="auth-tab-switcher" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef} className="auth-tab-indicator" />
        {tabs.map(({ key, to, label, Icon }) => (
          <button key={key}
            ref={el => { btnRefs.current[key] = el; }}
            className={`auth-tab-btn${curKey === key ? ' auth-tab-btn--active' : ''}`}
            onMouseEnter={() => setHovered(key)}
            onClick={() => onPick(to)}
            type="button">
            <Icon className="auth-tab-icon" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
