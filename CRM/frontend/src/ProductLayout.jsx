import { useEffect, useState, useCallback } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './Elements/Sidebar.jsx';
import Header from './Elements/Header.jsx';
import './Style/Layout.css';
import './Style/Load.css';
import { API_BASE } from './api.js';
import { decodeHash } from './Utils/hashids.js';

/**
 * Top-level layout for the product detail pages (`/product/:productHash`).
 * Same chrome as the project Layout (Header + Sidebar + main scroll area),
 * but the project context is resolved server-side from the product id rather
 * than being read from the URL.
 *
 * Sidebar.jsx detects the `/product/:hash` URL pattern on its own and swaps
 * its nav from project sections → flat product nav (Overview / Reviews / API).
 *
 * Children pages get `{ projectId, project, setProductContext }` from
 * `useOutletContext()`. `setProductContext` is what they use to surface the
 * product name in the breadcrumb (Header reads it via the `productContext` prop).
 */
function ProductLayout() {
  const { productHash } = useParams();
  const [user,    setUser]    = useState(null);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const [productContext, setProductContext] = useState(null);
  // Stable callback so children can pass it down without re-firing effects.
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

  const productId = decodeHash(productHash);

  useEffect(() => {
    if (!productId) { navigate('/dashboard'); return; }
    Promise.all([
      fetch(`${API_BASE}/api/me`, { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error('auth'); return r.json(); }),
      fetch(`${API_BASE}/api/products/${productId}/project-context`, { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error('product'); return r.json(); }),
    ])
    .then(([userData, ctx]) => {
      setUser(userData);
      setProject({
        id:       ctx.project_id,
        name:     ctx.project_name,
        api_key:  ctx.api_key,
        org_id:   ctx.org_id,
        org_name: ctx.org_name,
        org_slug: ctx.org_slug,
      });
    })
    .catch(() => navigate('/dashboard'))
    .finally(() => setLoading(false));
  }, [productId, navigate]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  if (!project) return null;

  const sidebarVar = sidebarOpen ? 'var(--sidebar-w)' : 'var(--sidebar-w-collapsed)';

  return (
    <div className="crm-root" style={{ '--current-sidebar-w': sidebarVar }}>
      <Header user={user} project={project} productContext={productContext} />
      <div className="crm-body">
        <Sidebar collapsed={!sidebarOpen} onToggle={toggleSidebar} />
        <main className="crm-main">
          <div className="crm-content crm-content--wide">
            <Outlet context={{
              projectId: project.id,
              project,
              setProductContext: handleSetProductContext,
            }} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default ProductLayout;
