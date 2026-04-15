export default function ApiPreviewTab({ product }) {
  const firstVar  = (product.variations || [])[0];
  const firstSize = firstVar?.sizes?.[0];

  const preview = {
    id: product.id, hash: `[hashid of ${product.id}]`, title: product.title,
    price: firstSize?.price ?? 0, image: firstVar?.image_url ?? null,
    seo_title: product.seo_title || null,
    seo_description: product.seo_description || null,
    seo_keywords: product.seo_keywords || null,
    custom_fields: Object.fromEntries((product.custom_fields || []).map(f => [f.field_key, f.field_value])),
  };

  const full = {
    id: product.id, product_hash: `[hashid of ${product.id}]`, title: product.title,
    description: product.description || '', characteristics: product.characteristics || '',
    seo_title: product.seo_title || null, seo_description: product.seo_description || null,
    seo_keywords: product.seo_keywords || null,
    custom_fields: Object.fromEntries((product.custom_fields || []).map(f => [f.field_key, f.field_value])),
    is_authenticated: false, is_favorite: false, can_review: false,
    reviews_count: (product.reviews || []).length, average_rating: 0,
    variations: (product.variations || []).map(v => ({
      id: v.id, variation_name: v.variation_name, image: v.image_url,
      sizes: (v.sizes || []).map(s => ({ id: s.id, size_name: s.size_name, price: s.price, stock_quantity: s.stock_quantity })),
    })),
    reviews: (product.reviews || []).slice(0, 2).map(r => ({ id: r.id, user_name: r.user_name, rating: r.rating, comment: r.comment })),
  };

  return (
    <div className="prod-tab-content">
      <p className="prod-tab-hint">Preview of what your storefront API returns for this product.</p>
      <div className="prod-api-section">
        <div className="prod-api-endpoint">
          <span className="prod-api-method">GET</span>
          <code className="prod-api-url">/{'{api_key}'}/api/products</code>
          <span className="prod-api-desc">— item in the array</span>
        </div>
        <pre className="prod-api-json">{JSON.stringify(preview, null, 2)}</pre>
      </div>
      <div className="prod-api-section">
        <div className="prod-api-endpoint">
          <span className="prod-api-method">GET</span>
          <code className="prod-api-url">/{'{api_key}'}/api/product/{'{hash}'}</code>
          <span className="prod-api-desc">— full product page</span>
        </div>
        <pre className="prod-api-json">{JSON.stringify(full, null, 2)}</pre>
      </div>
    </div>
  );
}
