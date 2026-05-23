import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import DocsSidebar from './Elements/DocsSidebar.jsx';
import Header from './Elements/Header.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import './Style/Docs.css';
import { API_BASE } from './api.js';

function DocsLayout() {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error('auth'); return r.json(); })
      .then(setUser)
      .catch(() => navigate('/login'))
      .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) return (
    <div id="mask" className="mask"><svg><circle cx="50" cy="50" r="40" /></svg></div>
  );

  return (
    <div className="crm-root" style={{ '--current-sidebar-w': 'var(--sidebar-w)' }}>
      <Header user={user} docsMode />
      <div className="crm-body">
        <DocsSidebar />
        <main className="crm-main">
          <div className="crm-content">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default DocsLayout;
