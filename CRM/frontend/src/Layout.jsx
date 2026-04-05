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

  return (
    <ProjectContext.Provider value={{ projectId: project.id, project }}>
      <div className="crm-layout">
        <Sidebar />
        <main className="crm-main">
          <Header user={user} project={project} />
          <div className="crm-content">
            <Outlet />
          </div>
        </main>
      </div>
    </ProjectContext.Provider>
  );
}

export default Layout
