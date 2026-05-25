import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import DocsSidebar from './Elements/DocsSidebar.jsx';
import Header from './Elements/Header.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import './Style/Docs.css';
import { API_BASE } from './api.js';

function DocsLayout() {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // ?from=landing → the user clicked the Docs tab from the landing nav,
  // so we render Docs with the LANDING Header (Pricing + Docs tabs,
  // logo→/, Get-Started/Dashboard CTA) and allow unauthenticated visits.
  // Without that param, we keep the original in-app Docs experience —
  // app-style header with "Docs" breadcrumb, login required.
  const fromLanding = new URLSearchParams(location.search).get('from') === 'landing';

  // Drawer state — desktop sidebar is always expanded (Docs never collapses),
  // but on tablet/mobile the same .sidebar element becomes a slide-in drawer.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleDrawer = () => setDrawerOpen(v => !v);

  // Live-tracked viewport flag so we know when to add the `.sidebar--collapsed`
  // class. On desktop (≥1024) we never collapse — the Docs nav should always
  // be visible. Only on tablet/mobile do we apply collapse to drive the drawer
  // (translateX) behaviour from Layout.css.
  const [isMobileVp, setIsMobileVp] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1024
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobileVp(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Mobile: auto-close drawer on route change.
  useEffect(() => {
    if (isMobileVp) setDrawerOpen(false);
  }, [location.pathname, isMobileVp]);

  // Mobile: lock background scroll when drawer is open.
  useEffect(() => {
    if (drawerOpen && isMobileVp) {
      document.body.classList.add('rsp-drawer-locked');
      return () => document.body.classList.remove('rsp-drawer-locked');
    }
  }, [drawerOpen, isMobileVp]);

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(u => {
        setUser(u);
        // Public Docs (landing mode) — anyone can read, no redirect.
        if (!u && !fromLanding) navigate('/login');
      })
      .catch(() => {
        if (!fromLanding) navigate('/login');
      })
      .finally(() => setLoading(false));
  }, [navigate, fromLanding]);

  if (loading) return (
    <div id="mask" className="mask"><svg><circle cx="50" cy="50" r="40" /></svg></div>
  );

  return (
    <div className="crm-root" style={{ '--current-sidebar-w': 'var(--sidebar-w)' }}>
      {fromLanding
        ? <Header user={user} landing onMobileNavToggle={toggleDrawer} />
        : <Header user={user} docsMode onMobileNavToggle={toggleDrawer} />
      }
      <div className="crm-body">
        {/* Desktop: always expanded. Mobile: drawer state controls collapsed class. */}
        <DocsSidebar collapsed={isMobileVp && !drawerOpen} />
        <div
          className={`rsp-drawer-backdrop${drawerOpen ? ' rsp-drawer-backdrop--open' : ''}`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
        <main className="crm-main">
          <div className="crm-content">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default DocsLayout;
