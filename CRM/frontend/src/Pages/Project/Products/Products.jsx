import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Tag, FolderSimple, Archive } from '@phosphor-icons/react';
import '../../../Style/Authentication.css';
import '../../../Style/Products.css';

export default function Products() {
  const ctx        = useOutletContext();
  const location   = useLocation();
  const navigate   = useNavigate();
  const { apiKey } = useParams();
  const base       = `/project/${apiKey}/products`;

  const TABS = [
    { key: 'list',       to: base,                  label: 'Products',   Icon: Tag          },
    { key: 'categories', to: `${base}/categories`,  label: 'Categories', Icon: FolderSimple },
    { key: 'archive',    to: `${base}/archive`,     label: 'Archive',    Icon: Archive      },
  ];
  const activeKey =
    location.pathname.endsWith('/categories') ? 'categories' :
    location.pathname.endsWith('/archive')    ? 'archive'    : 'list';
  const titleByKey = { list: 'Products', categories: 'Categories', archive: 'Archive' };

  return (
    <div className="prod-page-wrap">
      <TabSwitcher tabs={TABS} activeKey={activeKey} onPick={to => navigate(to)} />
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
