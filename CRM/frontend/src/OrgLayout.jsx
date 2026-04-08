import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import OrgSidebar from './Elements/OrgSidebar.jsx';
import Header from './Elements/Header.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';

function OrgLayout() {
  const { orgSlug } = useParams();
  const [user,    setUser]    = useState(null);
  const [org,     setOrg]     = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(() => {
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
      fetch(`${API_BASE}/api/orgs/by-slug/${orgSlug}`, { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error('org'); return r.json(); }),
    ])
    .then(([userData, orgData]) => { setUser(userData); setOrg(orgData); })
    .catch(() => navigate('/dashboard'))
    .finally(() => setLoading(false));
  }, [orgSlug, navigate]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  const sidebarVar = sidebarOpen ? 'var(--sidebar-w)' : 'var(--sidebar-w-collapsed)';

  return (
    <div className="crm-root" style={{ '--current-sidebar-w': sidebarVar }}>
      <Header user={user} org={org} />
      <div className="crm-body">
        <OrgSidebar collapsed={!sidebarOpen} onToggle={toggleSidebar} orgSlug={orgSlug} />
        <main className="crm-main">
          <div className="crm-content">
            <Outlet context={{ org, user }} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default OrgLayout;
