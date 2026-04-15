import { useEffect, useState } from 'react';
import { useParams, useLocation, useOutletContext, NavLink } from 'react-router-dom';
import { API_BASE } from '../api.js';
import { decodeHash } from '../Utils/hashids.js';
import InfoTab        from './Product/InfoTab.jsx';
import VariationsTab  from './Product/VariationsTab.jsx';
import SeoTab         from './Product/SeoTab.jsx';
import CustomFieldsTab from './Product/CustomFieldsTab.jsx';
import ReviewsTab     from './Product/ReviewsTab.jsx';
import ApiPreviewTab  from './Product/ApiPreviewTab.jsx';
import '../Style/Products.css';

// ── Tab map: URL key → label + component ──────────────────────

const TABS = [
  { key: '',              label: 'Info',          Comp: InfoTab         },
  { key: 'variations',   label: 'Variations',    Comp: VariationsTab   },
  { key: 'seo',          label: 'SEO',           Comp: SeoTab          },
  { key: 'custom-fields',label: 'Custom Fields', Comp: CustomFieldsTab },
  { key: 'reviews',      label: 'Reviews',       Comp: ReviewsTab      },
  { key: 'api-preview',  label: 'API Preview',   Comp: ApiPreviewTab   },
];

// ── ProductPage ────────────────────────────────────────────────

export default function ProductPage() {
  const { productHash } = useParams();
  const location = useLocation();
  const { projectId, project, setProductContext } = useOutletContext();
  const pq = `?project_id=${projectId}`;

  const [product,  setProduct]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);

  const productId = decodeHash(productHash);

  useEffect(() => {
    if (!productId) { setNotFound(true); setLoading(false); return; }
    setLoading(true);
    fetch(`${API_BASE}/api/products/${productId}${pq}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        setProduct(data);
        setProductContext?.({ name: data.title, hash: productHash });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [productId, projectId]);

  // Clear breadcrumb on unmount
  useEffect(() => () => setProductContext?.(null), []);

  if (loading)  return <div className="prod-page pp-page"><p className="crm-placeholder" style={{ paddingTop: 64 }}>Loading…</p></div>;
  if (notFound) return <div className="prod-page pp-page"><p className="crm-placeholder" style={{ paddingTop: 64 }}>Product not found.</p></div>;

  const base      = `/product/${productHash}`;
  const activeKey = location.pathname.startsWith(base + '/') ? location.pathname.slice(base.length + 1) : '';
  const TabComp   = TABS.find(t => t.key === activeKey)?.Comp ?? InfoTab;

  return (
    <div className="prod-page pp-page">
      <div className="pp-header">
        <div className="pp-title-row">
          <h1 className="crm-page-title pp-title">{product.title}</h1>
          <span className="pp-hash-badge">{productHash}</span>
        </div>
      </div>

      <div className="pp-body">
        <nav className="pp-tabs">
          {TABS.map(({ key, label }) => (
            <NavLink
              key={key}
              to={key ? `${base}/${key}` : base}
              end={!key}
              className={({ isActive }) => `pp-tab${isActive ? ' pp-tab--active' : ''}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <TabComp
          product={product}
          productId={productId}
          pq={pq}
          onSaved={upd => {
            setProduct(prev => ({ ...prev, ...upd }));
            if (upd.title) setProductContext?.({ name: upd.title, hash: productHash });
          }}
        />
      </div>
    </div>
  );
}
