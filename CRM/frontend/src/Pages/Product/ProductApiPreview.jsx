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

  // Mirror of what External /{api_key}/product/{hash} actually returns.
  // Tree shape: conf_1[] → conf_2[] → conf_3[] → conf_4[] → conf_5[].
  // Each level uses `name` (was variation_name / configuration_name).
  // The conf_{N+1} key is omitted on leaves so consumers can detect them.
  const mapSpecs = (arr) => (arr || []).map(s => ({ key: s.spec_key, value: s.spec_value }));

  const mapL5 = (n) => ({
    id: n.id,
    name: n.name || '',
    price: n.price ?? null,
    effective_price: n.effective_price ?? null,
    stock_quantity: n.stock_quantity || 0,
    sold_quantity: n.sold_quantity || 0,
    specifications: mapSpecs(n.specifications),
  });
  const mapL4 = (n) => {
    const out = mapL5(n);
    const kids = (n.children || []).map(mapL5);
    if (kids.length) out.conf_5 = kids;
    return out;
  };
  const mapL3 = (n) => {
    const out = mapL5(n);
    const kids = (n.children || []).map(mapL4);
    if (kids.length) out.conf_4 = kids;
    return out;
  };

  const buildPreview = () => {
    if (!product) return null;
    const conf_1 = (product.variations || []).map(v => {
      const conf_2 = (v.configurations || []).map(c => {
        const out = {
          id: c.id,
          name: c.name || c.configuration_name || '',
          price: c.effective_price != null ? c.effective_price : 0,
          effective_price: c.effective_price ?? null,
          stock_quantity: c.stock_quantity || 0,
          sold_quantity: c.sold_quantity || 0,
          is_in_cart: false,
          cart_item_id: null,
          cart_quantity: 0,
          specifications: mapSpecs(c.specifications),
        };
        const kids = (c.children || []).map(mapL3);
        if (kids.length) out.conf_3 = kids;
        return out;
      });
      const images = Array.isArray(v.images) ? v.images : [];
      const out = {
        id: v.id,
        name: v.variation_name,
        images,                        // full per-variation gallery
        image: images[0] || null,      // back-compat: cover URL
        price: v.price ?? null,
        effective_price: v.effective_price ?? null,
        stock_quantity: v.stock_quantity || 0,
        sold_quantity: v.sold_quantity || 0,
        is_in_cart: false,
        specifications: mapSpecs(v.specifications),
      };
      if (conf_2.length) out.conf_2 = conf_2;
      return out;
    });

    // Aggregate top-level summary fields the same way External does
    // (image = first variation cover, images = union of all variation galleries
    // deduped, price = lowest L2 effective_price or first variation's).
    const summaryImage = conf_1[0]?.image ?? null;
    const summaryImages = [];
    const seen = new Set();
    for (const v of conf_1) {
      for (const u of (v.images || [])) {
        if (u && !seen.has(u)) { summaryImages.push(u); seen.add(u); }
      }
    }
    const firstL2 = conf_1[0]?.conf_2?.[0] || null;
    const summaryPrice = firstL2?.effective_price ?? conf_1[0]?.effective_price ?? 0;

    return {
      id: product.id,
      product_hash: productHash,
      hash: productHash,                  // legacy alias for grid cards
      title: product.title,
      subtitle: product.subtitle || '',
      description: product.description || '',
      product_type: product.product_type || 'physical',  // physical | digital | service | event
      category_id:   product.category_id ?? null,
      category_name: product.category_name ?? null,
      category_slug: product.category_slug ?? null,
      seo_title: product.seo_title || null,
      seo_description: product.seo_description || null,
      seo_keywords: (product.seo_keywords || '').split(',').map(s => s.trim()).filter(Boolean),
      custom_fields: Object.fromEntries((product.custom_fields || []).map(f => [f.field_key, f.field_value])),
      is_authenticated: false,
      current_user_id: null,
      is_favorite: false,
      can_review: false,
      reviews_count: (product.reviews || []).length,
      average_rating: 0,
      initial_variation_index: 0,
      initial_configuration_id: conf_1[0]?.conf_2?.[0]?.id ?? null,
      image:  summaryImage,                // back-compat: cover URL
      images: summaryImages,               // full union of all variation galleries
      price:  summaryPrice,                // summary price
      // Modifier groups — preserved as-is from CRM admin payload. Same shape:
      // [{ id, name, control_type, min_select, max_select, is_required,
      //    default_item_id, position, items: [{id, name, price_delta, position}] }]
      modifier_groups: product.modifier_groups || [],
      conf_1,
      reviews: (product.reviews || []).slice(0, 2).map(r => ({
        id: r.id, user_id: r.user_id, user_name: 'User',
        rating: r.rating, comment: r.comment || '',
        created_at: r.created_at ?? null,
      })),
    };
  };

  const preview = buildPreview();

  // /{api_key}/products returns an array of the SAME payload shape — External
  // shares one assembler (`_assemble_product_payload`) between list and detail
  // endpoints. We illustrate by wrapping THIS product in a 1-element array;
  // the real endpoint returns every product in the catalog with the same shape.
  const listPreview = preview ? [preview] : null;

  return (
    <div className="prod-page po-page">
      <h1 className="crm-page-title">
        API Preview{product ? ` · ${product.title}` : ''}
      </h1>

      <section className="po-block">
        <h2 className="po-block-title">Single product</h2>
        <p className="po-block-hint">
          What your storefront receives when it calls{' '}
          <code className="po-api-code">GET /{'{api_key}'}/product/{productHash}</code>.
        </p>
        <div className="po-block-card">
          {loading && <p className="crm-placeholder">Loading…</p>}
          {!loading && preview && (
            <pre className="po-api-json">{JSON.stringify(preview, null, 2)}</pre>
          )}
        </div>
      </section>

      <section className="po-block">
        <h2 className="po-block-title">Product list</h2>
        <p className="po-block-hint">
          What your storefront receives when it calls{' '}
          <code className="po-api-code">GET /{'{api_key}'}/products</code>.
          Each item carries the exact same payload as the single-product endpoint.
          The example below wraps <i>this</i> product in a 1-element array — the real
          response contains every product in the catalog.
        </p>
        <div className="po-block-card">
          {loading && <p className="crm-placeholder">Loading…</p>}
          {!loading && listPreview && (
            <pre className="po-api-json">{JSON.stringify(listPreview, null, 2)}</pre>
          )}
        </div>
      </section>
    </div>
  );
}
