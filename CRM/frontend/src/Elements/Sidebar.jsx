import { useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import { NavLink, useLocation, useParams } from 'react-router-dom';
import { ChartBar, CurrencyDollar, Tag, CodeBlock, Envelope, GoogleLogo, Globe, CaretDown } from '@phosphor-icons/react';

function buildSections(apiKey) {
  const base = `/project/${apiKey}`;
  return [
    {
      id: 'overview', label: 'Overview',
      items: [
        { to: `${base}/dashboard`, label: 'Dashboard', Icon: ChartBar },
        { to: `${base}/revenue`,   label: 'Revenue',   Icon: CurrencyDollar },
      ],
    },
    {
      id: 'store', label: 'Store',
      items: [
        { to: `${base}/products`, label: 'Products', Icon: Tag },
      ],
    },
    {
      id: 'account', label: 'Account',
      items: [
        { to: `${base}/api`,        label: 'API',        Icon: CodeBlock },
        { to: `${base}/email`,      label: 'Email',      Icon: Envelope },
        { to: `${base}/oauth`,      label: 'OAuth',      Icon: GoogleLogo },
        { to: `${base}/url-config`, label: 'URL Config', Icon: Globe },
      ],
    },
  ];
}

const isActivePath = (p, to) => p === to || p.startsWith(to + '/');

const getRouteState = (pathname, sections) => {
  for (const s of sections)
    for (const item of s.items)
      if (isActivePath(pathname, item.to))
        return { activeSectionId: s.id, activeItemKey: item.to };
  return { activeSectionId: null, activeItemKey: null };
};


function NavSection({ section, open, onToggle, activeItemKey, pathname, onNavClick }) {
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
              <NavLink to={to} className="sb-item" onClick={onNavClick}>
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


function SidebarContent({ sections, activeSectionId, activeItemKey, location, open, setOpen, onNavClick }) {
  const toggleSection = id => setOpen(prev => {
    if (id === activeSectionId && prev[id]) return prev;
    return { ...prev, [id]: !prev[id] };
  });

  return (
    <>
      {sections.map(section => (
        <NavSection
          key={section.id}
          section={section}
          open={open[section.id]}
          onToggle={() => toggleSection(section.id)}
          activeItemKey={activeItemKey}
          pathname={location.pathname}
          onNavClick={onNavClick}
        />
      ))}
    </>
  );
}

function CollapsedNav({ sections, activeItemKey, pathname, onNavClick }) {
  const allItems = sections.flatMap(s => s.items);
  const itemsEl  = useRef(null);
  const itemEls  = useRef({});
  const [hoveredKey, setHoveredKey] = useState(null);

  const activeInAll = allItems.find(i => isActivePath(pathname, i.to))?.to ?? null;
  const currentKey  = hoveredKey ?? activeInAll;

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
        <div
          className="sb-indicator"
          style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }}
        />
        {allItems.map(({ to, Icon }) => (
          <div
            key={to}
            ref={el => { if (el) itemEls.current[to] = el; else delete itemEls.current[to]; }}
            className={`sb-item-wrap${currentKey === to ? ' sb-item-wrap--current' : ''}`}
            onMouseEnter={() => setHoveredKey(to)}
            onMouseLeave={() => setHoveredKey(null)}
          >
            <NavLink to={to} className="sb-item" onClick={onNavClick}>
              <Icon className="sb-icon" />
            </NavLink>
          </div>
        ))}
      </div>
    </div>
  );
}


function Sidebar({ collapsed }) {
  const location   = useLocation();
  const { apiKey } = useParams();

  const sections = useMemo(() => buildSections(apiKey), [apiKey]);

  const { activeSectionId, activeItemKey } = useMemo(
    () => getRouteState(location.pathname, sections), [location.pathname, sections]
  );

  const [open, setOpen] = useState({ overview: true, store: true, account: true });

  useEffect(() => {
    if (!activeSectionId) return;
    setOpen(prev => prev[activeSectionId] ? prev : { ...prev, [activeSectionId]: true });
  }, [activeSectionId]);

  const sharedProps = { sections, activeSectionId, activeItemKey, location, open, setOpen };

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-scroll">
        {collapsed
          ? <CollapsedNav sections={sections} activeItemKey={activeItemKey} pathname={location.pathname} onNavClick={undefined} />
          : <SidebarContent {...sharedProps} onNavClick={undefined} />
        }
      </div>
    </aside>
  );
}

export default Sidebar;
