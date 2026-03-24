import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Elements/Sidebar.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';

function Layout() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setUser)
      .catch(() => navigate('/login'))
      .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  return (
    <div className="crm-layout">
      <Sidebar user={user} />
      <main className="crm-main">
        <div className="crm-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default Layout