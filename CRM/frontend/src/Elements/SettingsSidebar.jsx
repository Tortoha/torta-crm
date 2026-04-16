import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { UserCircle, Lock, SlidersHorizontal, Bell, ArrowLineLeft, ArrowLineRight } from '@phosphor-icons/react';

const items = [
  { to: '/settings/account',       label: 'Profile',       Icon: UserCircle },
  { to: '/settings/security',      label: 'Security',       Icon: Lock },
  { to: '/settings/preferences',   label: 'Preferences',    Icon: SlidersHorizontal },
  { to: '/settings/notifications',  label: 'Notifications',  Icon: Bell },
];

function SettingsSidebar({ collapsed, onToggle }) {
  const location = useLocation();

  const itemsEl = useRef(null);
  const itemEls = useRef({});
  const [hovKey, setHovKey] = useState(null);
  const [ind,    setInd]    = useState({ opacity: 0, y: 0, h: 0 });

  const activeKey = items.find(i => location.pathname === i.to || location.pathname.startsWith(i.to + '/'))?.to ?? null;
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
            <div className="sb-items" ref={itemsEl} onMouseLeave={() => setHovKey(null)}>
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
                >
                  <NavLink to={to} end className="sb-item">
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
              : <><ArrowLineLeft className="sb-toggle-icon" /><span className="sb-toggle-label">Collapse</span></>
            }
          </button>
        </div>
      </div>
    </aside>
  );
}

export default SettingsSidebar;
