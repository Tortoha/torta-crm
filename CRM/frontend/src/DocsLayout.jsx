import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  const location = useLocation();

  // ?from=landing → the user clicked the Docs tab from the landing nav,
  // so we render Docs with the LANDING Header (Pricing + Docs tabs,
  // logo→/, Get-Started/Dashboard CTA) and allow unauthenticated visits.
  // Without that param, we keep the original in-app Docs experience —
  // app-style header with "Docs" breadcrumb, login required.
  const fromLanding = new URLSearchParams(location.search).get('from') === 'landing';

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(u => {
        setUser(u);
        // Public Docs (landing mode) — anyone can read, no redirect.
        if (!u && !fromLanding) navigate('/login');
      })
      .catch(() => {
        if (!fromLanding) navigate('/login');
      })
      .finally(() => setLoading(false));
  }, [navigate, fromLanding]);

  if (loading) return (
    <div id="mask" className="mask"><svg><circle cx="50" cy="50" r="40" /></svg></div>
  );

  return (
    <div className="crm-root" style={{ '--current-sidebar-w': 'var(--sidebar-w)' }}>
      {fromLanding
        ? <Header user={user} landing />
        : <Header user={user} docsMode />
      }
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
