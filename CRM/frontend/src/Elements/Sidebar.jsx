import { useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import { NavLink, useLocation, useParams } from 'react-router-dom';
import {
  House, Tag, LockKey, GearSix,
  CaretDown, ArrowLineLeft, ArrowLineRight,
  Cube, ChatCircleText, Code,
  Package, ChatCircleDots, CalendarBlank, Plug,
  ListBullets, ChartLine, Target, Bell, FileText, UsersThree, EnvelopeSimple,
} from '@phosphor-icons/react';

// ── Nav configs ────────────────────────────────────────────────

function buildSections(apiKey) {
  const base = `/project/${apiKey}`;
  // `pages` = the permission keys this nav item covers. Section pages (Products,
  // Orders, Booking, Chat, Authentication) list every sub-tab key — the item is
  // shown if the member can view ANY of them.
  return [
    {
      id: 'overview', label: 'Overview',
      items: [
        { to: `${base}`,           label: 'Project Overview', Icon: House,     exact: true, pages: ['overview'] },
        { to: `${base}/analytics`, label: 'Analytics',        Icon: ChartLine, pages: ['analytics'] },
        { to: `${base}/alerts`,    label: 'Alerts',           Icon: Bell,      pages: ['alerts'] },
        { to: `${base}/targets`,   label: 'Targets',          Icon: Target,    pages: ['goals'] },
      ],
    },
    {
      id: 'store', label: 'Business',
      items: [
        { to: `${base}/products`,  label: 'Products',  Icon: Tag,
          pages: ['products', 'inventory', 'batches', 'promo_codes', 'discounts', 'tier_pricing', 'warehouses', 'archive', 'product_settings'] },
        { to: `${base}/orders`,    label: 'Orders',    Icon: Package,       pages: ['orders', 'returns'] },
        { to: `${base}/booking`,   label: 'Bookings',  Icon: CalendarBlank, pages: ['booking', 'booking_services', 'booking_staff', 'booking_settings'] },
        { to: `${base}/customers`, label: 'Customers', Icon: UsersThree,    pages: ['customers'] },
        { to: `${base}/emails`,    label: 'Emails', Icon: EnvelopeSimple,   pages: ['emails'] },
        { to: `${base}/chat`,      label: 'Chat with Customers', Icon: ChatCircleDots, pages: ['chat', 'channels'] },
      ],
    },
    {
      id: 'account', label: 'Account',
      items: [
        { to: `${base}/authentication`, label: 'Authentication', Icon: LockKey,  pages: ['auth_providers', 'url_config'] },
        { to: `${base}/integrations`,   label: 'Integrations',   Icon: Plug,     pages: ['integrations'] },
        { to: `${base}/documents`,      label: 'Documents',      Icon: FileText, pages: ['documents'] },
        { to: `${base}/settings`,       label: 'Settings',       Icon: GearSix,  pages: ['settings'] },
      ],
    },
  ];
}

function buildProductItems(productHash) {
  const base = `/product/${productHash}`;
  return [
    { to: base,                    label: 'Product Overview', Icon: Cube,            exact: true },
    { to: `${base}/edit-history`,  label: 'Edit history',     Icon: ListBullets    },
    { to: `${base}/reviews`,       label: 'Reviews',          Icon: ChatCircleText },
    { to: `${base}/api-preview`,   label: 'API Preview',      Icon: Code           },
    { to: `${base}/settings`,      label: 'Settings',         Icon: GearSix        },
  ];
}

// ── Helpers ────────────────────────────────────────────────────

const isActivePath = (p, to, exact = false) => exact ? p === to : (p === to || p.startsWith(to + '/'));

// ── FlatNav — product page: items without a collapsible section ─

function FlatNav({ items, pathname }) {
  const itemsEl = useRef(null);
  const itemEls = useRef({});
  const [hoveredKey, setHoveredKey] = useState(null);

  const activeKey = items.find(i => isActivePath(pathname, i.to, i.exact))?.to ?? null;
  const currentKey = hoveredKey ?? activeKey;

  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });

  useLayoutEffect(() => {
    const container = itemsEl.current;
    const el = currentKey ? itemEls.current[currentKey] : null;
    if (!container || !el) { setInd(p => ({ ...p, opacity: 0 })); return; }
    const cr = container.getBoundingClientRect();
    const ir = el.getBoundingClientRect();
    setInd({ opacity: 1, y: ir.top - cr.top, h: ir.height });
  }, [currentKey, pathname]);

  return (
    <div className="sb-block">
      <div className="sb-items" ref={itemsEl}>
        <div className="sb-indicator"
          style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }} />
        {items.map(({ to, label, Icon }) => (
          <div key={to}
            ref={el => { if (el) itemEls.current[to] = el; else delete itemEls.current[to]; }}
            className={`sb-item-wrap${currentKey === to ? ' sb-item-wrap--current' : ''}`}
            onMouseEnter={() => setHoveredKey(to)}
            onMouseLeave={() => setHoveredKey(null)}
          >
            <NavLink to={to} end={!!to.match(/\/product\/[^/]+$/)} className="sb-item">
              <Icon className="sb-icon" />
              <span className="sb-item-label">{label}</span>
            </NavLink>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── NavSection — collapsible section ──────────────────────────

function NavSection({ section, open, onToggle, pathname }) {
  const itemsEl = useRef(null);
  const itemEls = useRef({});
  const [hoveredKey, setHoveredKey] = useState(null);

  const activeKey  = section.items.find(i => isActivePath(pathname, i.to, i.exact))?.to ?? null;
  const currentKey = hoveredKey ?? activeKey;

  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });

  useLayoutEffect(() => {
    const container = itemsEl.current;
    const el = currentKey ? itemEls.current[currentKey] : null;
    if (!container || !el || !open) { setInd(p => ({ ...p, opacity: 0 })); return; }
    const cr = container.getBoundingClientRect();
    const ir = el.getBoundingClientRect();
    setInd({ opacity: 1, y: ir.top - cr.top, h: ir.height });
  }, [currentKey, open, pathname]);

  return (
    <div className="sb-block sb-section-block">
      <button type="button" className="sb-section-header" onClick={onToggle}>
        <span className="sb-section-label">{section.label}</span>
        <CaretDown className={`sb-chevron${open ? ' sb-chevron--open' : ''}`} />
      </button>
      <div className={`sb-items-wrapper${open ? ' sb-items-wrapper--open' : ''}`}>
        <div className="sb-items" ref={itemsEl}>
          <div className="sb-indicator"
            style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }} />
          {section.items.map(({ to, label, Icon }) => (
            <div key={to}
              ref={el => { if (el) itemEls.current[to] = el; else delete itemEls.current[to]; }}
              className={`sb-item-wrap${currentKey === to ? ' sb-item-wrap--current' : ''}`}
              onMouseEnter={() => setHoveredKey(to)}
              onMouseLeave={() => setHoveredKey(null)}
            >
              <NavLink to={to} className="sb-item">
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

// ── CollapsedNav — icon-only mode ──────────────────────────────

function CollapsedNav({ items, pathname }) {
  const itemsEl = useRef(null);
  const itemEls = useRef({});
  const [hoveredKey, setHoveredKey] = useState(null);

  const activeKey  = items.find(i => isActivePath(pathname, i.to, i.exact))?.to ?? null;
  const currentKey = hoveredKey ?? activeKey;

  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });

  useLayoutEffect(() => {
    const container = itemsEl.current;
    const el = currentKey ? itemEls.current[currentKey] : null;
    if (!container || !el) { setInd(p => ({ ...p, opacity: 0 })); return; }
    const cr = container.getBoundingClientRect();
    const ir = el.getBoundingClientRect();
    setInd({ opacity: 1, y: ir.top - cr.top, h: ir.height });
  }, [currentKey, pathname]);

  return (
    <div className="sb-block sb-collapsed-block">
      <div className="sb-items" ref={itemsEl}>
        <div className="sb-indicator"
          style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }} />
        {items.map(({ to, Icon }) => (
          <div key={to}
            ref={el => { if (el) itemEls.current[to] = el; else delete itemEls.current[to]; }}
            className={`sb-item-wrap${currentKey === to ? ' sb-item-wrap--current' : ''}`}
            onMouseEnter={() => setHoveredKey(to)}
            onMouseLeave={() => setHoveredKey(null)}
          >
            <NavLink to={to} className="sb-item">
              <Icon className="sb-icon" />
            </NavLink>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────

export default function Sidebar({ collapsed, onToggle, access }) {
  const location   = useLocation();
  const { apiKey } = useParams();

  // Hide nav items the member's role can't view (shown if ANY of the item's
  // pages is viewable). Owner / not-yet-loaded → show all (backend still
  // enforces; this is UX only).
  const canView = (pages) => {
    if (!access || access.is_owner) return true;
    return (pages || []).some(p => {
      const lvl = access.permissions?.[p];
      return lvl === 'view' || lvl === 'manage';
    });
  };

  // Detect product detail page so sidebar swaps project sections → flat product nav.
  const productMatch = useMemo(
    () => location.pathname.match(/^\/product\/([^/]+)/),
    [location.pathname]
  );
  const productHash = productMatch?.[1] ?? null;

  const sections     = useMemo(
    () => buildSections(apiKey)
            .map(s => ({ ...s, items: s.items.filter(i => canView(i.pages)) }))
            .filter(s => s.items.length > 0),
    [apiKey, access]);   // eslint-disable-line react-hooks/exhaustive-deps
  const productItems = useMemo(
    () => productHash ? buildProductItems(productHash) : null,
    [productHash]
  );

  // For section open/close state (only used in normal mode)
  const activeSectionId = useMemo(() => {
    if (productHash) return null;
    for (const s of sections)
      for (const item of s.items)
        if (isActivePath(location.pathname, item.to, item.exact)) return s.id;
    return null;
  }, [location.pathname, sections, productHash]);

  const [open, setOpen] = useState({ overview: true, store: true, booking: true, communication: true, account: true });

  useEffect(() => {
    if (activeSectionId) setOpen(prev => prev[activeSectionId] ? prev : { ...prev, [activeSectionId]: true });
  }, [activeSectionId]);

  const toggleSection = id => setOpen(prev => {
    if (id === activeSectionId && prev[id]) return prev;
    return { ...prev, [id]: !prev[id] };
  });

  // All items flat (for collapsed mode)
  const allItems = productItems ?? sections.flatMap(s => s.items);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-scroll">
        <div className="sb-nav-area">
          {collapsed ? (
            <CollapsedNav items={allItems} pathname={location.pathname} />
          ) : productItems ? (
            // Product page: flat list, no collapsible section header
            <FlatNav items={productItems} pathname={location.pathname} />
          ) : (
            // Normal project pages: collapsible sections
            sections.map(section => (
              <NavSection
                key={section.id}
                section={section}
                open={open[section.id]}
                onToggle={() => toggleSection(section.id)}
                pathname={location.pathname}
              />
            ))
          )}
        </div>
        <div className="sb-bottom">
          <button className="sb-toggle-btn" onClick={onToggle} type="button" aria-label="Toggle sidebar">
            {collapsed
              ? <ArrowLineRight className="sb-toggle-icon" />
              : <><ArrowLineLeft className="sb-toggle-icon" /><span className="sb-toggle-label">Collapse</span></>
            }
          </button>
        </div>
      </div>
    </aside>
  );
}
