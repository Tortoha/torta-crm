import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './Elements/Sidebar.jsx';
import Header from './Elements/Header.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';
import { ProjectContext } from './context/ProjectContext.jsx';

function Layout() {
  const { apiKey } = useParams();
  const [user,    setUser]    = useState(null);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

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
    <ProjectContext.Provider value={{ projectId: project.id, project }}>
      <div className="crm-root" style={{ '--current-sidebar-w': sidebarVar }}>
        <Header user={user} project={project} sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
        <div className="crm-body">
          <Sidebar collapsed={!sidebarOpen} />
          <main className="crm-main">
            <div className="crm-content">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </ProjectContext.Provider>
  );
}

export default Layout;
