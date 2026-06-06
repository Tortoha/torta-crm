import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FolderSimple, ChartLine, UsersThree, CreditCard } from '@phosphor-icons/react';

// Billing can NEVER be delegated — only the owner may open these, ever.
const OWNER_ONLY_ORG_PAGES = ['billing', 'checkout'];
// Every other org-admin page maps to a delegatable permission key.
// A member passes if their org.access grants 'view' or 'manage' on that key.
const ORG_PAGE_PERM = {
  analytics: 'org_analytics',
  customers: 'org_customers',
  team: 'org_team',
  payments: 'org_payments',
  usage: 'org_usage',
  settings: 'org_settings',
};
import OrgSidebar from './Elements/OrgSidebar.jsx';
import Header from './Elements/Header.jsx';
import MobileTabBar from './Elements/MobileTabBar.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';
import { usePresence, setPresenceContext } from './Utils/usePresence.js';
import CursorOverlay from './Elements/CursorOverlay.jsx';

function OrgLayout() {
  const { orgSlug } = useParams();
  const location = useLocation();
  const { t }    = useTranslation();
  const [user,    setUser]    = useState(null);
  const [org,     setOrg]     = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Live presence — same singleton WS as Layout / SettingsLayout / etc.
  usePresence();

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
      // Publish org context so usePresence() can pin org_id to its frame,
      // mirroring what Layout does with window.__torta_project.
      try { window.__torta_org = orgData; } catch { /* no-op */ }
      // Imperative — the pathname effect already ran before this fetch
      // resolved, so the previous frame had org_id=null. Push the real
      // scope now that we have it.
      if (orgData?.id) setPresenceContext({ orgId: orgData.id });
    })
    .catch(() => navigate('/dashboard'))
    .finally(() => setLoading(false));
  }, [orgSlug, navigate]);

  // Gate org-admin pages: owner sees all; members need a delegated permission.
  // Billing/checkout are owner-only forever. Unknown segments (and the index
  // project list) are always allowed.
  useEffect(() => {
    if (!org || org.is_owner) return;
    const m = location.pathname.match(/^\/org\/[^/]+\/([^/]+)/);
    if (!m) return; // index = project list, always allowed
    const seg = m[1];
    if (OWNER_ONLY_ORG_PAGES.includes(seg)) {
      navigate(`/org/${orgSlug}`, { replace: true });
      return;
    }
    const permKey = ORG_PAGE_PERM[seg];
    if (permKey) {
      const lvl = org.access?.[permKey];
      if (lvl !== 'view' && lvl !== 'manage') {
        navigate(`/org/${orgSlug}`, { replace: true });
      }
    }
  }, [org, location.pathname, orgSlug, navigate]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  const sidebarVar = sidebarOpen ? 'var(--sidebar-w)' : 'var(--sidebar-w-collapsed)';

  // Owner sees everything; a member sees a page only when their org.access
  // grants it. Projects (the index) is always visible.
  const canOrg = (key) => !!org?.is_owner || ['view', 'manage'].includes(org?.access?.[key]);

  // Mobile bottom tab bar items — Projects is always present; the rest appear
  // only when the user can open them.
  const orgBase = `/org/${orgSlug}`;
  const tabItems = [
    { to: orgBase, label: t('nav.projects'), Icon: FolderSimple, exact: true },
    canOrg('org_analytics') && { to: `${orgBase}/analytics`, label: t('nav.analytics'), Icon: ChartLine },
    canOrg('org_team') && { to: `${orgBase}/team`, label: t('nav.team'), Icon: UsersThree },
    canOrg('org_payments') && { to: `${orgBase}/payments`, label: t('nav.payments'), Icon: CreditCard },
  ].filter(Boolean);

  return (
    <div className="crm-root" style={{ '--current-sidebar-w': sidebarVar }}>
      <Header user={user} org={org} onMobileNavToggle={toggleSidebar} />
      <div className="crm-body">
        <OrgSidebar collapsed={!sidebarOpen} onToggle={toggleSidebar} orgSlug={orgSlug} isOwner={!!org?.is_owner} access={org?.access} />
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
      {/* Live cursors of other teammates on this same org page. Mounting the
          overlay also starts reporting our own cursor over the presence WS. */}
      <CursorOverlay />
    </div>
  );
}

export default OrgLayout;
