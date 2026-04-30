import { useEffect, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import '../../Style/Products.css';

export default function ProductApiPreview() {
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
  }, [productId, projectId, productHash]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildPreview = () => {
    if (!product) return null;
    return {
      id: product.id,
      product_hash: productHash,
      title: product.title,
      subtitle: product.subtitle || '',
      description: product.description || '',
      category_id:   product.category_id ?? null,
      category_name: product.category_name ?? null,
      category_slug: product.category_slug ?? null,
      seo_title: product.seo_title || null,
      seo_description: product.seo_description || null,
      seo_keywords: product.seo_keywords || null,
      custom_fields: Object.fromEntries((product.custom_fields || []).map(f => [f.field_key, f.field_value])),
      is_authenticated: false, is_favorite: false, can_review: false,
      reviews_count: (product.reviews || []).length,
      average_rating: 0,
      initial_variation_index: 0,
      initial_configuration_id: product.variations?.[0]?.configurations?.[0]?.id ?? null,
      variations: (product.variations || []).map(v => ({
        id: v.id, variation_name: v.variation_name, image: v.image_url,
        configurations: (v.configurations || []).map(c => ({
          id: c.id,
          configuration_name: c.configuration_name,
          price: c.price,
          stock_quantity: c.stock_quantity,
          sold_quantity: c.sold_quantity,
          is_in_cart: false, cart_item_id: null, cart_quantity: 0,
        })),
      })),
      reviews: (product.reviews || []).slice(0, 2).map(r => ({
        id: r.id, user_id: r.user_id, user_name: 'User',
        rating: r.rating, comment: r.comment || '',
      })),
    };
  };

  const preview = buildPreview();

  return (
    <div className="prod-page po-page">
      <h1 className="crm-page-title">
        API Preview{product ? ` · ${product.title}` : ''}
      </h1>

      <section className="po-block">
        <p className="po-block-hint">
          What your storefront receives when it calls{' '}
          <code className="po-api-code">GET /{'{api_key}'}/products/{productHash}</code>.
        </p>
        <div className="po-block-card">
          {loading && <p className="crm-placeholder">Loading…</p>}
          {!loading && preview && (
            <pre className="po-api-json">{JSON.stringify(preview, null, 2)}</pre>
          )}
        </div>
      </section>
    </div>
  );
}
