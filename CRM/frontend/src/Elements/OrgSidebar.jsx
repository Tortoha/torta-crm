import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FolderSimple, ChartLine, ArrowLineLeft, ArrowLineRight,
         CreditCard, GearSix, UsersThree, Users,
         ShoppingBag, ChartBar } from '@phosphor-icons/react';

function buildItems(orgSlug, isOwner, access, t) {
  const base = `/org/${orgSlug}`;
  // Projects (the index) is always visible. Each org-admin page shows only when
  // the user can open it: the owner sees all; a member sees a page when their
  // org.access grants 'view'/'manage' on its permission key. Billing is never
  // delegatable, so it stays owner-only in the nav.
  const can = (key) => isOwner || ['view', 'manage'].includes(access?.[key]);
  const items = [{ to: base, label: t('nav.projects'), Icon: FolderSimple, exact: true }];
  if (can('org_analytics')) items.push({ to: `${base}/analytics`, label: t('nav.analytics'), Icon: ChartLine  });
  if (can('org_customers')) items.push({ to: `${base}/customers`, label: t('nav.customers'), Icon: Users      });
  if (can('org_team'))      items.push({ to: `${base}/team`,      label: t('nav.team'),      Icon: UsersThree });
  if (can('org_payments'))  items.push({ to: `${base}/payments`,  label: t('nav.payments'),  Icon: CreditCard });
  if (isOwner)              items.push({ to: `${base}/billing`,   label: t('nav.billing'),   Icon: ShoppingBag});
  if (can('org_usage'))     items.push({ to: `${base}/usage`,     label: t('nav.usage'),     Icon: ChartBar   });
  if (can('org_settings'))  items.push({ to: `${base}/settings`,  label: t('nav.settings'),  Icon: GearSix    });
  return items;
}

const isActive = (pathname, to, exact) =>
  exact ? pathname === to : (pathname === to || pathname.startsWith(to + '/'));

function OrgSidebar({ collapsed, onToggle, orgSlug, isOwner, access }) {
  const location = useLocation();
  const { t }    = useTranslation();
  const items    = buildItems(orgSlug, isOwner, access, t);

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
