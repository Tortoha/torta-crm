import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserCircle, Lock } from '@phosphor-icons/react';
import SettingsSidebar from './Elements/SettingsSidebar.jsx';
import Header from './Elements/Header.jsx';
import MobileTabBar from './Elements/MobileTabBar.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';

function SettingsLayout() {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { t }    = useTranslation();

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) return false;
    try { return localStorage.getItem('crm_sidebar') !== 'closed'; } catch { return true; }
  });

  const toggleSidebar = () => setSidebarOpen(v => {
    const next = !v;
    try { localStorage.setItem('crm_sidebar', next ? 'open' : 'closed'); } catch {}
    return next;
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, [location.pathname]);

  useEffect(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    if (sidebarOpen && isMobile) {
      document.body.classList.add('rsp-drawer-locked');
      return () => document.body.classList.remove('rsp-drawer-locked');
    }
  }, [sidebarOpen]);

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error('auth'); return r.json(); })
      .then(u => {
        // Hard ToS gate — Google-OAuth users bounce to /accept-terms.
        if (!u?.terms_accepted_at) { navigate('/accept-terms', { replace: true }); return; }
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

  const updateUser = (patch) => setUser(prev => ({ ...prev, ...patch }));

  const sidebarVar = sidebarOpen ? 'var(--sidebar-w)' : 'var(--sidebar-w-collapsed)';

  // Only 2 settings pages — show both as bottom tabs, no More button needed.
  const tabItems = [
    { to: '/settings/account', label: t('settings.profile.title'), Icon: UserCircle },
    { to: '/settings/security', label: t('security.title'), Icon: Lock },
  ];

  return (
    <div className="crm-root" style={{ '--current-sidebar-w': sidebarVar }}>
      <Header user={user} settingsMode onMobileNavToggle={toggleSidebar} />
      <div className="crm-body">
        <SettingsSidebar collapsed={!sidebarOpen} onToggle={toggleSidebar} />
        <div
          className={`rsp-drawer-backdrop${sidebarOpen ? ' rsp-drawer-backdrop--open' : ''}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
        <main className="crm-main">
          <div className="crm-content">
            <Outlet context={{ user, updateUser }} />
          </div>
        </main>
      </div>
      <MobileTabBar items={tabItems} />
    </div>
  );
}

export default SettingsLayout;
