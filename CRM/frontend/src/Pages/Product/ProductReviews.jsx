import { useEffect, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Trash } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import '../../Style/Products.css';

export default function ProductReviews() {
  const { t } = useTranslation();
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

  const remove = async (id) => {
    if (!confirm(t('productDetail.reviews.deleteConfirm'))) return;
    const res = await fetch(`${API_BASE}/api/products/${productId}/reviews/${id}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) return;
    setProduct(p => (p ? { ...p, reviews: (p.reviews || []).filter(r => r.id !== id) } : p));
  };

  return (
    <div className="prod-page po-page">
      <h1 className="crm-page-title">
        {t('productDetail.reviews.title')}{product ? ` · ${product.title}` : ''}
      </h1>

      <section className="po-block">
        <div className="po-block-card">
          {loading && <p className="crm-placeholder">{t('common.loading')}</p>}
          {!loading && reviews.length === 0 && <div className="po-empty">{t('productDetail.reviews.empty')}</div>}
          {!loading && reviews.map(r => (
            <article key={r.id} className="po-review">
              <div className="po-review-head">
                <span className="po-review-author">{t('productDetail.reviews.author', { id: r.user_id })}</span>
                <span className="po-review-stars">
                  {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                </span>
                <span className="po-review-date">
                  {r.created_at ? new Date(r.created_at).toLocaleDateString('en-US',
                    { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                </span>
                <button type="button" className="crm-icon-btn crm-icon-btn--danger po-review-del"
                  onClick={() => remove(r.id)} title={t('productDetail.reviews.delete')}>
                  <Trash className="crm-icon crm-icon--sm" />
                </button>
              </div>
              {r.comment && <p className="po-review-comment">{r.comment}</p>}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
