// Mirror of CRM/frontend/src/Layout.jsx, stripped of org/project context
// (admin has neither — it's a single global console). Same shape:
// fixed Header + collapsible Sidebar + scroll Main. crm-* class names
// reused 1:1 so the copied Layout.css applies without any rewriting.

import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Elements/Sidebar.jsx';
import Header from './Elements/Header.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) return false;
    try { return localStorage.getItem('adm_sidebar') !== 'closed'; } catch { return true; }
  });

  const toggleSidebar = () => setSidebarOpen(v => {
    const next = !v;
    try { localStorage.setItem('adm_sidebar', next ? 'open' : 'closed'); } catch {}
    return next;
  });

  // Auto-close drawer on mobile route change.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, [location.pathname]);

  // Auth + admin gate. is_admin=true is required; anything else bounces to /login.
  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error('auth'); return r.json(); })
      .then(u => {
        if (!u.is_admin) { navigate('/login'); return; }
        setUser(u);
      })
      .catch(() => navigate('/login'))
      .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  const sidebarVar = sidebarOpen ? 'var(--sidebar-w)' : 'var(--sidebar-w-collapsed)';

  return (
    <div className="crm-root" style={{ '--current-sidebar-w': sidebarVar }}>
      <Header user={user} onMobileNavToggle={toggleSidebar} />
      <div className="crm-body">
        <Sidebar collapsed={!sidebarOpen} onToggle={toggleSidebar} />
        <div
          className={`rsp-drawer-backdrop${sidebarOpen ? ' rsp-drawer-backdrop--open' : ''}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
        <main className="crm-main">
          <div className="crm-content crm-content--wide">
            <Outlet context={{ user }} />
          </div>
        </main>
      </div>
    </div>
  );
}
