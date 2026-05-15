import { useEffect, useState, useCallback } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './Elements/Sidebar.jsx';
import Header from './Elements/Header.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';

function Layout() {
  const { apiKey } = useParams();
  const [user,    setUser]    = useState(null);
  const [project, setProject] = useState(null);
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
        <Sidebar collapsed={!sidebarOpen} onToggle={toggleSidebar} />
        <main className="crm-main">
          <div className="crm-content crm-content--wide">
            <Outlet context={{ projectId: project.id, project, setProductContext: handleSetProductContext }} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;
