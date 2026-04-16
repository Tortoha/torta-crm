import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import SettingsSidebar from './Elements/SettingsSidebar.jsx';
import Header from './Elements/Header.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';

function SettingsLayout() {
  const [user,    setUser]    = useState(null);
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
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error('auth'); return r.json(); })
      .then(setUser)
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
      <Header user={user} settingsMode />
      <div className="crm-body">
        <SettingsSidebar collapsed={!sidebarOpen} onToggle={toggleSidebar} />
        <main className="crm-main">
          <div className="crm-content">
            <Outlet context={{ user }} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default SettingsLayout;
