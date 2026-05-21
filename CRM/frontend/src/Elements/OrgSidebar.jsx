import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FolderSimple, ChartLine, ArrowLineLeft, ArrowLineRight,
         CreditCard, GearSix, UsersThree } from '@phosphor-icons/react';

function buildItems(orgSlug, isOwner, t) {
  const base = `/org/${orgSlug}`;
  // Members only see the project list; the org-admin pages (Analytics / Team /
  // Payments / Settings) are owner-only (backend enforces require_org_owner).
  const items = [{ to: base, label: t('nav.projects'), Icon: FolderSimple, exact: true }];
  if (isOwner) items.push(
    { to: `${base}/analytics`, label: t('nav.analytics'), Icon: ChartLine  },
    { to: `${base}/team`,      label: t('nav.team'),      Icon: UsersThree },
    { to: `${base}/payments`,  label: t('nav.payments'),  Icon: CreditCard },
    { to: `${base}/settings`,  label: t('nav.settings'),  Icon: GearSix    },
  );
  return items;
}

const isActive = (pathname, to, exact) =>
  exact ? pathname === to : (pathname === to || pathname.startsWith(to + '/'));

function OrgSidebar({ collapsed, onToggle, orgSlug, isOwner }) {
  const location = useLocation();
  const { t }    = useTranslation();
  const items    = buildItems(orgSlug, isOwner, t);

  const itemsEl  = useRef(null);
  const itemEls  = useRef({});
  const [hovKey, setHovKey] = useState(null);
  const [ind,    setInd]    = useState({ opacity: 0, y: 0, h: 0 });

  const activeKey = items.find(i => isActive(location.pathname, i.to, i.exact))?.to ?? null;
  const curKey    = hovKey ?? activeKey;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = curKey ? itemEls.current[curKey] : null;
      if (!el) { setInd(p => ({ ...p, opacity: 0 })); return; }
      setInd({ opacity: 1, y: el.offsetTop, h: el.offsetHeight });
    });
    return () => cancelAnimationFrame(raf);
  }, [curKey, collapsed, location.pathname]);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-scroll">
        <div className="sb-nav-area">
          <div className="sb-block">
            <div className="sb-items" ref={itemsEl}>
              <div
                className="sb-indicator"
                style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }}
              />
              {items.map(({ to, label, Icon }) => (
                <div
                  key={to}
                  ref={el => { if (el) itemEls.current[to] = el; else delete itemEls.current[to]; }}
                  className={`sb-item-wrap${curKey === to ? ' sb-item-wrap--current' : ''}`}
                  onMouseEnter={() => setHovKey(to)}
                  onMouseLeave={() => setHovKey(null)}
                >
                  <NavLink to={to} end={!!items.find(i => i.to === to)?.exact} className="sb-item">
                    <Icon className="sb-icon" />
                    <span className="sb-item-label">{label}</span>
                  </NavLink>
                </div>
              ))}
            </div>
          </div>
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

export default OrgSidebar;
