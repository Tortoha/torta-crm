import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Rocket, Buildings, Lightning, UsersThree,
  ArrowLineLeft, ArrowLineRight,
} from '@phosphor-icons/react';

// Two static groups: CRM navigation + API/torta-js. Same sb-* primitives and
// sliding indicator as the project sidebar.
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

function DocGroup({ group, pathname, collapsed }) {
  const itemsEl = useRef(null);
  const itemEls = useRef({});
  const [hov, setHov] = useState(null);

  const activeKey = group.items.find(i => pathname === i.to || pathname.startsWith(i.to + '/'))?.to ?? null;
  const cur = hov ?? activeKey;
  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = cur ? itemEls.current[cur] : null;
      if (!el) { setInd(p => ({ ...p, opacity: 0 })); return; }
      setInd({ opacity: 1, y: el.offsetTop, h: el.offsetHeight });
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, pathname, collapsed]);

  return (
    <div className="sb-block">
      <div className="sb-group-title">{group.label}</div>
      <div className="sb-items" ref={itemsEl} onMouseLeave={() => setHov(null)}>
        <div className="sb-indicator"
          style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }} />
        {group.items.map(({ to, label, Icon }) => (
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
  );
}

export default function DocsSidebar({ collapsed, onToggle }) {
  const location = useLocation();
  const { t }    = useTranslation();
  const groups   = buildGroups(t);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-scroll">
        <div className="sb-nav-area">
          {groups.map(g => (
            <DocGroup key={g.id} group={g} pathname={location.pathname} collapsed={collapsed} />
          ))}
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
