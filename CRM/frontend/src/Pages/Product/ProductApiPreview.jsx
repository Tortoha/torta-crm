import { useEffect, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import '../../Style/Products.css';

export default function ProductApiPreview() {
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
  }, [productId, projectId, productHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror External /{api_key}/product/{hash}: conf_layer_1..5 tree, `name` per level, leaves omit next layer key.
  // Specs are flat ({key,value,group}) AND nested under named sections (spec_groups),
  // exactly like External. The CRM GET returns node.spec_groups = [{id,name,specs}] +
  // group_id on each flat spec, so build a group_id→name lookup per node.
  const gmapOf = (node) => Object.fromEntries((node?.spec_groups || []).map(g => [g.id, g.name]));
  const mapSpecs = (arr, gmap) => (arr || []).map(s => ({
    key: s.spec_key, value: s.spec_value, group: (gmap || {})[s.group_id] || '',
  }));
  const mapSpecGroups = (node) => {
    const gmap = gmapOf(node);
    return (node?.spec_groups || []).map(g => ({ name: g.name, specs: mapSpecs(g.specs, gmap) }));
  };

  const mapL5 = (n) => {
    const out = {
      id: n.id,
      name: n.name || '',
      price: n.price ?? null,
      effective_price: n.effective_price ?? null,
      stock_quantity: n.stock_quantity || 0,
      sold_quantity: n.sold_quantity || 0,
      specifications: mapSpecs(n.specifications, gmapOf(n)),
    };
    const sg = mapSpecGroups(n);
    if (sg.length) out.spec_groups = sg;
    return out;
  };
  const mapL4 = (n) => {
    const out = mapL5(n);
    const kids = (n.children || []).map(mapL5);
    if (kids.length) out.conf_layer_5 = kids;
    return out;
  };
  const mapL3 = (n) => {
    const out = mapL5(n);
    const kids = (n.children || []).map(mapL4);
    if (kids.length) out.conf_layer_4 = kids;
    return out;
  };

  // Mirror External's _media_type — extension-based dispatch.
  const mediaType = (url) => {
    const u = (url || '').toLowerCase();
    if (/\.(mp4|webm|mov)(\?|$)/.test(u)) return 'video';
    if (/\.(glb|usdz)(\?|$)/.test(u))     return 'model';
    return 'image';
  };

  const buildPreview = () => {
    if (!product) return null;
    const nowIso = new Date().toISOString();
    const conf_layer_1 = (product.variations || []).map(v => {
      const conf_layer_2 = (v.configurations || []).map(c => {
        // Sale-active mirrors External: substitute price + push original to compare_at_price for strikethrough.
        const sp = c.sale_price;
        const ss = c.sale_starts_at;
        const se = c.sale_ends_at;
        const saleActive = !!(sp && sp > 0 &&
          (!ss || ss <= nowIso) && (!se || se >= nowIso));
        const ownPrice = c.price ?? c.effective_price ?? 0;
        const finalPrice = saleActive ? sp : (c.effective_price ?? ownPrice ?? 0);
        const cmpAt = saleActive ? ownPrice : (c.compare_at_price ?? null);
        const out = {
          id: c.id,
          name: c.name || c.configuration_name || '',
          price: finalPrice,
          effective_price: c.effective_price ?? null,
          compare_at_price: cmpAt,
          on_sale: saleActive,
          sku_code:   c.sku_code ?? '',
          barcode:    c.barcode  ?? '',
          cost_price: c.cost_price ?? null,
          weight_g:   c.weight_g  ?? null,
          length_cm:  c.length_cm ?? null,
          width_cm:   c.width_cm  ?? null,
          height_cm:  c.height_cm ?? null,
          stock_quantity: c.stock_quantity || 0,
          sold_quantity: c.sold_quantity || 0,
          is_in_cart: false,
          cart_item_id: null,
          cart_quantity: 0,
          specifications: mapSpecs(c.specifications, gmapOf(c)),
        };
        const csg = mapSpecGroups(c);
        if (csg.length) out.spec_groups = csg;
        const kids = (c.children || []).map(mapL3);
        if (kids.length) out.conf_layer_3 = kids;
        return out;
      });
      const images = Array.isArray(v.images) ? v.images : [];
      const altArr = Array.isArray(v.media_alt) ? v.media_alt : [];
      const media  = images.map((u, i) => ({
        url: u, type: mediaType(u), alt: altArr[i] || '',
      }));
      const out = {
        id: v.id,
        name: v.variation_name,
        images,                        // full per-variation gallery
        media,                         // typed: image | video | model + alt
        image: images[0] || null,      // back-compat: cover URL
        price: v.price ?? null,
        effective_price: v.effective_price ?? null,
        stock_quantity: v.stock_quantity || 0,
        sold_quantity: v.sold_quantity || 0,
        is_in_cart: false,
        specifications: mapSpecs(v.specifications, gmapOf(v)),
      };
      const vsg = mapSpecGroups(v);
      if (vsg.length) out.spec_groups = vsg;
      if (conf_layer_2.length) out.conf_layer_2 = conf_layer_2;
      return out;
    });

    // Top-level summary mirrors External: cover from V1, deduped union of galleries, price from first L2 / V1.
    const summaryImage = conf_layer_1[0]?.image ?? null;
    const summaryImages = [];
    const seen = new Set();
    for (const v of conf_layer_1) {
      for (const u of (v.images || [])) {
        if (u && !seen.has(u)) { summaryImages.push(u); seen.add(u); }
      }
    }
    const firstL2 = conf_layer_1[0]?.conf_layer_2?.[0] || null;
    const summaryPrice = firstL2?.effective_price ?? conf_layer_1[0]?.effective_price ?? 0;

    return {
      id: product.id,
      product_hash: productHash,
      hash: productHash,                  // legacy alias for grid cards
      title: product.title,
      subtitle: product.subtitle || '',
      description: product.description || '',
      product_type: product.product_type || 'physical',  // physical | digital | service
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
      initial_configuration_id: conf_layer_1[0]?.conf_layer_2?.[0]?.id ?? null,
      image:  summaryImage,                // back-compat: cover URL
      images: summaryImages,               // full union of all variation galleries
      price:  summaryPrice,                // summary price
      // Modifier groups — preserved as-is from CRM admin payload (same shape: id/name/control_type/items[]).
      modifier_groups: product.modifier_groups || [],
      // Phase 1 — SaaS-grade physical product fields exposed to storefront.
      sku:                    product.sku || '',
      barcode:                product.barcode || '',
      brand:                  product.brand || '',
      manufacturer:           product.manufacturer || '',
      country_of_origin:      product.country_of_origin || '',
      og_image_url:           product.og_image_url ?? null,
      requires_shipping:      product.requires_shipping !== false,
      ships_internationally:  !!product.ships_internationally,
      shipping_class:         product.shipping_class || 'standard',
      lead_time_days:         product.lead_time_days || 0,
      continue_selling_oos:   !!product.continue_selling_oos,
      moq:                    product.moq || 1,
      order_increment:        product.order_increment || 1,
      low_stock_threshold:    product.low_stock_threshold || 0,
      is_pre_order:           !!product.is_pre_order,
      pre_order_release_at:   product.pre_order_release_at ?? null,
      tax: product.tax_category_id ? {
        category_id:   product.tax_category_id,
        category_name: product.tax_category_name ?? null,
        rate:          Number(product.tax_rate) || 0,
      } : null,
      conf_layer_1,
      reviews: (product.reviews || []).slice(0, 2).map(r => ({
        id: r.id, user_id: r.user_id, user_name: 'User',
        rating: r.rating, comment: r.comment || '',
        created_at: r.created_at ?? null,
      })),
    };
  };

  const preview = buildPreview();

  // /{api_key}/products returns same payload shape (shared `_assemble_product_payload`); 1-element preview here.
  const listPreview = preview ? [preview] : null;

  return (
    <div className="prod-page po-page">
      <h1 className="crm-page-title">
        {t('productDetail.apiPreview.title')}{product ? ` · ${product.title}` : ''}
      </h1>

      <section className="po-block">
        <h2 className="po-block-title">{t('productDetail.apiPreview.single')}</h2>
        <p className="po-block-hint">
          {t('productDetail.apiPreview.singleHint')}{' '}
          <code className="po-api-code">GET /{'{api_key}'}/product/{productHash}</code>.
        </p>
        <div className="po-block-card">
          {loading && <p className="crm-placeholder">{t('common.loading')}</p>}
          {!loading && preview && (
            <pre className="po-api-json">{JSON.stringify(preview, null, 2)}</pre>
          )}
        </div>
      </section>

      <section className="po-block">
        <h2 className="po-block-title">{t('productDetail.apiPreview.list')}</h2>
        <p className="po-block-hint">
          {t('productDetail.apiPreview.listHintPre')}{' '}
          <code className="po-api-code">GET /{'{api_key}'}/products</code>
          {t('productDetail.apiPreview.listHintPost')}
        </p>
        <div className="po-block-card">
          {loading && <p className="crm-placeholder">{t('common.loading')}</p>}
          {!loading && listPreview && (
            <pre className="po-api-json">{JSON.stringify(listPreview, null, 2)}</pre>
          )}
        </div>
      </section>
    </div>
  );
}
