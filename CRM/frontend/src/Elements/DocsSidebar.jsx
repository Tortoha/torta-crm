import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Rocket, Buildings, Lightning, UsersThree,
  CaretDown, ArrowLineLeft, ArrowLineRight,
} from '@phosphor-icons/react';

// Two groups: CRM navigation + API/torta-js. Same collapsible-section design as
// the project sidebar (sb-section-block + header + chevron + sliding indicator).
function buildGroups(t) {
  return [
    {
      id: 'crm', label: t('docs.groups.crm'),
      items: [
        { to: '/docs/getting-started',        label: t('docs.pages.gettingStarted'),        Icon: Rocket },
        { to: '/docs/organizations-projects', label: t('docs.pages.organizationsProjects'), Icon: Buildings },
      ],
    },
    {
      id: 'api', label: t('docs.groups.api'),
      items: [
        { to: '/docs/quickstart', label: t('docs.pages.quickstart'), Icon: Lightning },
        { to: '/docs/customers',  label: t('docs.pages.customers'),  Icon: UsersThree },
      ],
    },
  ];
}

const isActivePath = (p, to) => p === to || p.startsWith(to + '/');

// Collapsible section — mirrors NavSection in Elements/Sidebar.jsx.
function DocSection({ section, open, onToggle, pathname }) {
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

// Icon-only flat nav for the collapsed sidebar — mirrors CollapsedNav.
function CollapsedDocNav({ items, pathname }) {
  const itemsEl = useRef(null);
  const itemEls = useRef({});
  const [hov, setHov] = useState(null);

  const activeKey = items.find(i => isActivePath(pathname, i.to))?.to ?? null;
  const cur = hov ?? activeKey;
  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = cur ? itemEls.current[cur] : null;
      if (!el) { setInd(p => ({ ...p, opacity: 0 })); return; }
      setInd({ opacity: 1, y: el.offsetTop, h: el.offsetHeight });
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, pathname]);

  return (
    <div className="sb-block sb-collapsed-block">
      <div className="sb-items" ref={itemsEl} onMouseLeave={() => setHov(null)}>
        <div className="sb-indicator"
          style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }} />
        {items.map(({ to, Icon }) => (
          <div key={to}
            ref={el => { if (el) itemEls.current[to] = el; else delete itemEls.current[to]; }}
            className={`sb-item-wrap${cur === to ? ' sb-item-wrap--current' : ''}`}
            onMouseEnter={() => setHov(to)}
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

export default function DocsSidebar({ collapsed, onToggle }) {
  const location = useLocation();
  const { t }    = useTranslation();
  const groups   = buildGroups(t);

  const [open, setOpen] = useState({ crm: true, api: true });
  const toggle = (id) => setOpen(prev => ({ ...prev, [id]: !prev[id] }));

  const allItems = groups.flatMap(g => g.items);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-scroll">
        <div className="sb-nav-area">
          {collapsed ? (
            <CollapsedDocNav items={allItems} pathname={location.pathname} />
          ) : (
            groups.map(g => (
              <DocSection key={g.id} section={g} open={open[g.id]}
                onToggle={() => toggle(g.id)} pathname={location.pathname} />
            ))
          )}
        </div>
        <div className="sb-bottom">
          <button className="sb-toggle-btn" onClick={onToggle} type="button" aria-label="Toggle sidebar">
            {collapsed
              ? <ArrowLineRight className="sb-toggle-icon" />
              : <><ArrowLineLeft className="sb-toggle-icon" /><span className="sb-toggle-label">{t('common.collapse')}</span></>
            }
          </button>
        </div>
      </div>
    </aside>
  );
}
