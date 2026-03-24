import { useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ChartBarIcon, CurrencyDollarIcon, DocumentChartBarIcon, FlagIcon,
  TagIcon, ShoppingCartIcon, UsersIcon, ArchiveBoxIcon, ReceiptPercentIcon,
  ChatBubbleLeftRightIcon, CodeBracketSquareIcon, UserGroupIcon, CreditCardIcon,
  ChevronDownIcon, Cog6ToothIcon, UserCircleIcon, ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/solid';
import { API_BASE } from '../api.js';

const SECTIONS = [
  {
    id: 'overview', label: 'Overview',
    items: [
      { to: '/dashboard',  label: 'Dashboard',          Icon: ChartBarIcon },
      { to: '/revenue',    label: 'Revenue',            Icon: CurrencyDollarIcon },
      { to: '/reports',    label: 'Reports',            Icon: DocumentChartBarIcon },
      { to: '/objectives', label: 'Objectives',         Icon: FlagIcon },
    ],
  },
  {
    id: 'store', label: 'Store',
    items: [
      { to: '/products',  label: 'Products',            Icon: TagIcon },
      { to: '/orders',    label: 'Orders',              Icon: ShoppingCartIcon },
      { to: '/customers', label: 'Customers',           Icon: UsersIcon },
      { to: '/inventory', label: 'Inventory | Stock',   Icon: ArchiveBoxIcon },
      { to: '/discounts', label: 'Discounts',           Icon: ReceiptPercentIcon },
      { to: '/chat',      label: 'Chat with customers', Icon: ChatBubbleLeftRightIcon },
    ],
  },
  {
    id: 'account', label: 'Account',
    items: [
      { to: '/api',          label: 'API',                  Icon: CodeBracketSquareIcon },
      { to: '/team',         label: 'Team | Users & Roles', Icon: UserGroupIcon },
      { to: '/subscription', label: 'Subscription',         Icon: CreditCardIcon },
    ],
  },
];

const isActivePath = (p, to) => p === to || p.startsWith(to + '/');

const getRouteState = (pathname) => {
  for (const s of SECTIONS)
    for (const item of s.items)
      if (isActivePath(pathname, item.to))
        return { activeSectionId: s.id, activeItemKey: item.to };
  return { activeSectionId: null, activeItemKey: null };
};

function NavSection({ section, open, onToggle, activeItemKey, pathname }) {
  const itemsEl = useRef(null);
  const itemEls = useRef({});
  const [hoveredKey, setHoveredKey] = useState(null);

  const sectionKeys = section.items.map(i => i.to);
  const activeInSection = sectionKeys.find(k => isActivePath(pathname, k)) ?? null;
  const currentKey = hoveredKey ?? activeInSection;

  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });

  useLayoutEffect(() => {
    const container = itemsEl.current;
    const el = currentKey ? itemEls.current[currentKey] : null;

    if (!container || !el || !open) {
      setInd(p => ({ ...p, opacity: 0 }));
      return;
    }

    const cr = container.getBoundingClientRect();
    const ir = el.getBoundingClientRect();

    setInd({
      opacity: 1,
      y: ir.top - cr.top,
      h: ir.height,
    });
  }, [currentKey, open, pathname]);

  return (
    <div className="sb-block sb-section-block">
      <button type="button" className="sb-section-header" onClick={onToggle}>
        <span>{section.label}</span>
        <ChevronDownIcon className={`sb-chevron${open ? ' sb-chevron--open' : ''}`} />
      </button>

      <div className={`sb-items-wrapper${open ? ' sb-items-wrapper--open' : ''}`}>
        <div className="sb-items" ref={itemsEl}>

          <div
            className="sb-indicator"
            style={{
              opacity:   ind.opacity,
              height:    `${ind.h}px`,
              transform: `translateY(${ind.y}px)`,
            }}
          />

          {section.items.map(({ to, label, Icon }) => (
            <div
              key={to}
              ref={el => { if (el) itemEls.current[to] = el; else delete itemEls.current[to]; }}
              className={`sb-item-wrap${currentKey === to ? ' sb-item-wrap--current' : ''}`}
              onMouseEnter={() => setHoveredKey(to)}
              onMouseLeave={() => setHoveredKey(null)}
            >
              <NavLink to={to} className="sb-item">
                <Icon className="sb-icon" />
                <span>{label}</span>
              </NavLink>
            </div>
          ))}

        </div>
      </div>
    </div>
  );
}

function Sidebar({ user }) {
  const navigate = useNavigate();
  const location = useLocation();

  const { activeSectionId, activeItemKey } = useMemo(
    () => getRouteState(location.pathname), [location.pathname]
  );

  const [open, setOpen] = useState({ overview: true, store: true, account: true });

  // Нельзя закрыть секцию с активной страницей
  const toggleSection = id => setOpen(prev => {
    if (id === activeSectionId && prev[id]) return prev;
    return { ...prev, [id]: !prev[id] };
  });

  // Если активная страница в закрытой секции - открыть её
  useEffect(() => {
    if (!activeSectionId) return;
    setOpen(prev => prev[activeSectionId] ? prev : { ...prev, [activeSectionId]: true });
  }, [activeSectionId]);

  const logout = async () => {
    await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
    navigate('/');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        {SECTIONS.map(section => (
          <NavSection
            key={section.id}
            section={section}
            open={open[section.id]}
            onToggle={() => toggleSection(section.id)}
            activeItemKey={activeItemKey}
            pathname={location.pathname}
          />
        ))}

        <div className="sb-spacer" />

        <div className="sb-block sb-user-block">
          <div className="sb-user-info">
            <UserCircleIcon className="sb-user-avatar" />
            <span className="sb-user-name">{user?.name || 'User'}</span>
          </div>
          <div className="sb-user-actions">
            <button type="button" className="sb-user-btn" title="Logout" onClick={logout}>
              <ArrowRightOnRectangleIcon className="sb-icon" />
            </button>
            <button type="button" className="sb-user-btn" title="Settings">
              <Cog6ToothIcon className="sb-icon" />
            </button>
          </div>
        </div>

      </div>
    </aside>
  );
}

export default Sidebar