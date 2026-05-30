import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FolderSimple, ChartLine, UsersThree, CreditCard } from '@phosphor-icons/react';

// Org pages only the owner may open — members are bounced to the project list.
const OWNER_ONLY_ORG_PAGES = ['analytics', 'team', 'payments', 'billing', 'usage', 'checkout', 'settings'];
import OrgSidebar from './Elements/OrgSidebar.jsx';
import Header from './Elements/Header.jsx';
import MobileTabBar from './Elements/MobileTabBar.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';

function OrgLayout() {
  const { orgSlug } = useParams();
  const location = useLocation();
  const { t }    = useTranslation();
  const [user,    setUser]    = useState(null);
  const [org,     setOrg]     = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) return false;
    try { return localStorage.getItem('crm_sidebar') !== 'closed'; } catch { return true; }
  });

  const toggleSidebar = () => setSidebarOpen(v => {
    const next = !v;
    try { localStorage.setItem('crm_sidebar', next ? 'open' : 'closed'); } catch {}
    return next;
  });

  // Mobile: auto-close drawer on route change.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, [location.pathname]);

  // Mobile: lock background scroll when drawer is open.
  useEffect(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    if (sidebarOpen && isMobile) {
      document.body.classList.add('rsp-drawer-locked');
      return () => document.body.classList.remove('rsp-drawer-locked');
    }
  }, [sidebarOpen]);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/me`, { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error('auth'); return r.json(); }),
      fetch(`${API_BASE}/api/orgs/by-slug/${orgSlug}`, { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error('org'); return r.json(); }),
    ])
    .then(([userData, orgData]) => {
      // Hard ToS gate — Google-OAuth users bounce to /accept-terms.
      if (!userData?.terms_accepted_at) { navigate('/accept-terms', { replace: true }); return; }
      setUser(userData); setOrg(orgData);
    })
    .catch(() => navigate('/dashboard'))
    .finally(() => setLoading(false));
  }, [orgSlug, navigate]);

  // Members can't open the org-admin pages — bounce them to the project list.
  useEffect(() => {
    if (!org || org.is_owner) return;
    const m = location.pathname.match(/^\/org\/[^/]+\/([^/]+)/);
    if (m && OWNER_ONLY_ORG_PAGES.includes(m[1])) {
      navigate(`/org/${orgSlug}`, { replace: true });
    }
  }, [org, location.pathname, orgSlug, navigate]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  const sidebarVar = sidebarOpen ? 'var(--sidebar-w)' : 'var(--sidebar-w-collapsed)';

  // Mobile bottom tab bar items — owner sees 4 tabs; member only Projects.
  const orgBase = `/org/${orgSlug}`;
  const tabItems = org?.is_owner
    ? [
        { to: orgBase, label: t('nav.projects'), Icon: FolderSimple, exact: true },
        { to: `${orgBase}/analytics`, label: t('nav.analytics'), Icon: ChartLine },
        { to: `${orgBase}/team`, label: t('nav.team'), Icon: UsersThree },
        { to: `${orgBase}/payments`, label: t('nav.payments'), Icon: CreditCard },
      ]
    : [
        { to: orgBase, label: t('nav.projects'), Icon: FolderSimple, exact: true },
      ];

  return (
    <div className="crm-root" style={{ '--current-sidebar-w': sidebarVar }}>
      <Header user={user} org={org} onMobileNavToggle={toggleSidebar} />
      <div className="crm-body">
        <OrgSidebar collapsed={!sidebarOpen} onToggle={toggleSidebar} orgSlug={orgSlug} isOwner={!!org?.is_owner} />
        <div
          className={`rsp-drawer-backdrop${sidebarOpen ? ' rsp-drawer-backdrop--open' : ''}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
        <main className="crm-main">
          <div className="crm-content">
            <Outlet context={{ org, user }} />
          </div>
        </main>
      </div>
      <MobileTabBar items={tabItems} onMore={() => setSidebarOpen(true)} />
    </div>
  );
}

export default OrgLayout;
