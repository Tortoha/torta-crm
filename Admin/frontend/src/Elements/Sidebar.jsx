// Stripped clone of CRM/frontend/src/Elements/Sidebar.jsx — same Dynamic
// Block indicator + collapsible section pattern, same sb-* classes so the
// copied Layout.css covers all styling. Differences: only 2 nav items
// (Analytics, Users), no i18n (English literals), no per-project access
// checks (admin sees everything by definition), no product detail flat-nav.

import { useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ChartLine, UsersThree, CaretDown, ArrowLineLeft, ArrowLineRight,
} from '@phosphor-icons/react';

// Single section, two items. Mirrors CRM's buildSections() return shape so
// the rest of the file (NavSection / CollapsedNav) is byte-for-byte CRM.
function buildSections() {
  return [
    {
      id: 'admin', label: 'Overview',
      items: [
        { to: '/',      label: 'Analytics', Icon: ChartLine, exact: true },
        { to: '/users', label: 'Users',     Icon: UsersThree },
      ],
    },
  ];
}

const isActivePath = (p, to, exact = false) => exact ? p === to : (p === to || p.startsWith(to + '/'));

// ── NavSection — collapsible section with Dynamic Block indicator ──────

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
          {section.items.map(({ to, label, Icon, exact }) => (
            <div key={to}
              ref={el => { if (el) itemEls.current[to] = el; else delete itemEls.current[to]; }}
              className={`sb-item-wrap${currentKey === to ? ' sb-item-wrap--current' : ''}`}
              onMouseEnter={() => setHoveredKey(to)}
              onMouseLeave={() => setHoveredKey(null)}
            >
              <NavLink to={to} end={!!exact} className="sb-item">
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

// ── CollapsedNav — icon-only when sidebar collapsed ──

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
        {items.map(({ to, Icon, exact }) => (
          <div key={to}
            ref={el => { if (el) itemEls.current[to] = el; else delete itemEls.current[to]; }}
            className={`sb-item-wrap${currentKey === to ? ' sb-item-wrap--current' : ''}`}
            onMouseEnter={() => setHoveredKey(to)}
            onMouseLeave={() => setHoveredKey(null)}
          >
            <NavLink to={to} end={!!exact} className="sb-item">
              <Icon className="sb-icon" />
            </NavLink>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sidebar ──

export default function Sidebar({ collapsed, onToggle }) {
  const location = useLocation();
  const sections = useMemo(() => buildSections(), []);

  const activeSectionId = useMemo(() => {
    for (const s of sections)
      for (const item of s.items)
        if (isActivePath(location.pathname, item.to, item.exact)) return s.id;
    return null;
  }, [location.pathname, sections]);

  const [open, setOpen] = useState({ admin: true });

  useEffect(() => {
    if (activeSectionId) setOpen(prev => prev[activeSectionId] ? prev : { ...prev, [activeSectionId]: true });
  }, [activeSectionId]);

  const toggleSection = id => setOpen(prev => {
    if (id === activeSectionId && prev[id]) return prev;
    return { ...prev, [id]: !prev[id] };
  });

  const allItems = sections.flatMap(s => s.items);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-scroll">
        <div className="sb-nav-area">
          {collapsed ? (
            <CollapsedNav items={allItems} pathname={location.pathname} />
          ) : (
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
