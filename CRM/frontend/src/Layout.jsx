import { useEffect, useState, useCallback } from 'react';
import { Outlet, useNavigate, useParams, useLocation } from 'react-router-dom';
import Sidebar from './Elements/Sidebar.jsx';
import Header from './Elements/Header.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';

// First URL segment after /project/:apiKey → the permission pages that govern
// that route ('' = Project Overview index). Section routes list every sub-tab
// key — the route is allowed if the member can view ANY of them; the page's
// own TabSwitcher then hides the sub-tabs they can't view.
const ROUTE_PAGES = {
  '':               ['overview'],
  'analytics':      ['analytics'],
  'alerts':         ['alerts'],
  'targets':        ['goals'],
  'products':       ['products', 'inventory', 'batches', 'promo_codes', 'discounts', 'tier_pricing', 'warehouses', 'archive', 'product_settings'],
  'orders':         ['orders', 'returns'],
  'customers':      ['customers'],
  'booking':        ['booking', 'booking_services', 'booking_staff', 'booking_settings'],
  'chat':           ['chat', 'channels'],
  'emails':         ['emails'],
  'authentication': ['auth_providers', 'url_config'],
  'integrations':   ['integrations'],
  'documents':      ['documents'],
  'settings':       ['settings'],
  'api':            ['api'],
};
// Priority order for choosing where to bounce a member with no access here.
const ROUTE_ORDER = ['', 'products', 'orders', 'customers', 'booking', 'chat',
  'emails', 'analytics', 'alerts', 'targets', 'authentication', 'integrations',
  'documents', 'settings', 'api'];

function Layout() {
  const { apiKey } = useParams();
  const location = useLocation();
  const [user,    setUser]    = useState(null);
  const [project, setProject] = useState(null);
  const [access,  setAccess]  = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const [productContext, setProductContext] = useState(null);

  const handleSetProductContext = useCallback((ctx) => setProductContext(ctx), []);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return false;
    try { return localStorage.getItem('crm_sidebar') !== 'closed'; } catch { return true; }
  });

  const toggleSidebar = () => setSidebarOpen(v => {
    const next = !v;
    try { localStorage.setItem('crm_sidebar', next ? 'open' : 'closed'); } catch {}
    return next;
  });

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/me`, { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error('auth'); return r.json(); }),
      fetch(`${API_BASE}/api/projects/by-key/${apiKey}`, { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error('project'); return r.json(); }),
    ])
    .then(([userData, projectData]) => {
      setUser(userData);
      setProject(projectData);
      // Resolve the current user's per-project permission map (drives sidebar
      // gating + the forbidden-page redirect below). Non-fatal: owners get
      // full access; a 403 here means no access → the redirect sends them out.
      fetch(`${API_BASE}/api/projects/${projectData.id}/my-access`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(a => setAccess(a))
        .catch(() => {});
      // One-shot per-session TZ correction: if this project's booking_settings.timezone
      // is still the default 'UTC' and the merchant is browsing from a different TZ,
      // auto-update so customer-facing slots use the merchant's actual local time.
      // Runs at Layout mount = ANY project page (not just /bookings) — so the merchant
      // can never miss it. Idempotent: backend silently skips if timezone is already set.
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (browserTz && browserTz !== 'UTC') {
        const pq = `?project_id=${projectData.id}`;
        fetch(`${API_BASE}/api/booking/settings${pq}`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : null)
          .then(s => {
            if (!s || (s.timezone && s.timezone !== 'UTC')) return;
            const { configured, ...payload } = s;
            payload.timezone = browserTz;
            return fetch(`${API_BASE}/api/booking/settings${pq}`, {
              method: 'PUT', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
          })
          .catch(() => { /* not fatal — booking might be unused */ });
      }
    })
    .catch(() => navigate('/dashboard'))
    .finally(() => setLoading(false));
  }, [apiKey, navigate]);

  // Auto-timezone sync — when `project.tz_auto` is TRUE, keep the
  // project's stored timezone in sync with whatever browser TZ the
  // merchant is currently in. Fires on mount (catch-up) and every 30
  // minutes after (handles long-running sessions / travel mid-session).
  //
  // Skips when the user has explicitly picked a tz from Settings
  // (tz_auto=FALSE) — their manual choice wins until they click the
  // "Use browser timezone" toggle again. Reloads the page after a
  // successful sync so all module-level fmtDate / fmtMoney pick up the
  // new value without the user having to navigate away.
  useEffect(() => {
    if (!project || !project.tz_auto) return;
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const syncIfDifferent = () => {
      // Re-read project from the backend in case Settings was edited in
      // another tab — avoids overwriting a fresh manual choice with a
      // stale cached `project.tz_auto` from this tab's mount.
      fetch(`${API_BASE}/api/projects/${project.id}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(p => {
          if (!p || !p.tz_auto) return;
          if (p.timezone === browserTz) return;
          return fetch(`${API_BASE}/api/projects/${project.id}`, {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timezone: browserTz, tz_auto: true }),
          }).then(r => { if (r.ok) window.location.reload(); });
        })
        .catch(() => { /* offline / transient — try again next tick */ });
    };
    syncIfDifferent();
    const id = setInterval(syncIfDifferent, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [project?.id, project?.tz_auto]);

  // Forbidden-page redirect — a member who lands on (or types) a page their
  // role can't view is bounced to their first allowed page (or the dashboard
  // if they have none). Owner / not-yet-loaded access is a no-op.
  useEffect(() => {
    if (!access || access.is_owner) return;
    const seg = (location.pathname.match(/^\/project\/[^/]+\/?([^/]*)/)?.[1]) || '';
    const pages = ROUTE_PAGES[seg];
    if (!pages) return;                         // unknown route — leave alone
    const canView = (pgs) => pgs.some(p => {
      const l = access.permissions?.[p];
      return l === 'view' || l === 'manage';
    });
    if (canView(pages)) return;
    const target = ROUTE_ORDER.find(rk => ROUTE_PAGES[rk] && canView(ROUTE_PAGES[rk]));
    if (target != null) navigate(`/project/${apiKey}/${target}`, { replace: true });
    else                navigate('/dashboard', { replace: true });
  }, [access, location.pathname, apiKey, navigate]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  const sidebarVar = sidebarOpen ? 'var(--sidebar-w)' : 'var(--sidebar-w-collapsed)';

  return (
    <div className="crm-root" style={{ '--current-sidebar-w': sidebarVar }}>
      <Header user={user} project={project} productContext={productContext} />
      <div className="crm-body">
        <Sidebar collapsed={!sidebarOpen} onToggle={toggleSidebar} access={access} />
        <main className="crm-main">
          <div className="crm-content crm-content--wide">
            <Outlet context={{ projectId: project.id, project, access, setProductContext: handleSetProductContext }} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;
