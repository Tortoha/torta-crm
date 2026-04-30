import { useEffect, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import '../../Style/Products.css';

export default function ProductReviews() {
  const { projectId, setProductContext } = useOutletContext();
  const { productHash } = useParams();
  const productId = decodeHash(productHash);
  const pq = `?project_id=${projectId}`;

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!productId) return;
    fetch(`${API_BASE}/api/products/${productId}${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setProduct(d);
        if (d) setProductContext?.({ name: d.title, hash: productHash });
      })
      .finally(() => setLoading(false));
    return () => setProductContext?.(null);
  }, [productId, projectId, productHash]);

  const reviews = product?.reviews || [];

  return (
    <div className="prod-page po-page">
      <h1 className="crm-page-title">
        Reviews{product ? ` · ${product.title}` : ''}
      </h1>

      <section className="po-block">
        <div className="po-block-card">
          {loading && <p className="crm-placeholder">Loading…</p>}
          {!loading && reviews.length === 0 && <div className="po-empty">No reviews yet.</div>}
          {!loading && reviews.map(r => (
            <article key={r.id} className="po-review">
              <div className="po-review-head">
                <span className="po-review-author">User #{r.user_id}</span>
                <span className="po-review-stars">
                  {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                </span>
                <span className="po-review-date">
                  {r.created_at ? new Date(r.created_at).toLocaleDateString('en-US',
                    { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                </span>
              </div>
              {r.comment && <p className="po-review-comment">{r.comment}</p>}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
