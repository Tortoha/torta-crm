import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Printer, DownloadSimple, X, CaretRight, CaretDown, Folder, Cube,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { Combobox, DatePicker } from '../Booking/BookingCreateModal.jsx';
import '../../../Style/Authentication.css';   // .auth-modal-* base chrome
import '../../../Style/Products.css';         // .print-bc-* layout + tree
import '../../../Style/Booking.css';          // .bk-date-pop for DatePicker

const FORMAT_OPTIONS = [
  { value: '50x30', label: 'Thermal · 50 × 30 mm' },
  { value: '70x40', label: 'Thermal · 70 × 40 mm' },
  { value: 'a4_24', label: 'A4 sheet · 24 per page' },
  { value: 'a4_30', label: 'A4 sheet · 30 per page' },
];

// What gets printed for each selected product. Three encoding families × three
// scopes = nine options:
//   SKU   — encodes products.sku / l2.sku_code (alphanumeric merchant identifier)
//   Batch — encodes the latest batch_name for the row (shelf-life / recall)
//   EAN-13 — encodes the auto-minted 13-digit barcode (scannable everywhere,
//            stays the same across batches; lives on products.barcode /
//            product_configurations_l2.barcode and is auto-generated for every
//            product + SKU using GS1 in-store prefix 200/201).
const SCOPE_OPTIONS = [
  { value: 'product',        label: 'Product barcode (SKU)' },
  { value: 'config',         label: 'Configuration barcodes (SKU)' },
  { value: 'both',           label: 'Product + configuration (SKU)' },
  { value: 'product-batch',  label: 'Product barcode (Batch)' },
  { value: 'config-batch',   label: 'Configuration barcodes (Batch)' },
  { value: 'both-batch',     label: 'Product + configuration (Batch)' },
  { value: 'product-ean13',  label: 'Product barcode (EAN-13)' },
  { value: 'config-ean13',   label: 'Configuration barcodes (EAN-13)' },
  { value: 'both-ean13',     label: 'Product + configuration (EAN-13)' },
];

// Symbology — split into format family + specific code. Only formats we can
// actually render correctly are listed: Code 128 (1D), EAN-13 (EAN/UPC),
// QR Code (2D). Other symbologies removed to avoid confusing the merchant
// with options that silently fall back to Code 128.
const SYMBOLOGY_FAMILIES = [
  { value: '1d',     label: '1D Codes' },
  { value: 'eanupc', label: 'EAN / UPC' },
  { value: '2d',     label: '2D Codes' },
];

// 1D + EAN-UPC entries render with their real python-barcode class. 2D entries
// use the `qrcode` lib — Data Matrix and GS1 2D variants render as QR codes
// with the appropriate GS1 prefix in the encoded value (true Data Matrix
// needs libdmtx system dependency which isn't installed on the VPS).
const SYMBOLOGY_CHOICES = {
  '1d': [
    { value: 'code128', label: 'Code 128' },
    { value: 'code39',  label: 'Code 39' },
    { value: 'itf',     label: 'Interleaved 2 of 5 (ITF)' },
    { value: 'gs1_128', label: 'GS1-128' },
  ],
  eanupc: [
    { value: 'ean13', label: 'EAN-13' },
    { value: 'ean8',  label: 'EAN-8' },
    { value: 'upca',  label: 'UPC-A' },
  ],
  '2d': [
    { value: 'qr',     label: 'QR Code' },
    { value: 'gs1_qr', label: 'GS1 QR Code' },
  ],
};

const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Real-printer integration: backend renders self-printable HTML, we embed it in an iframe and call iframe.contentWindow.print() ONLY when the user clicks Print.
// Resolution modes:
//   - mode='product' + productIds  → one label per product, value=products.sku/barcode (no variation expansion)
//   - mode='sku' + skuIds          → exact list of L2 SKUs
//   - mode='sku' + productIds      → expand to every L2 SKU under the product(s)
//   - mode='sku' + productIds + filterVariationId  → only SKUs under one Layer-1 variation
export default function PrintBarcodesModal({ open, pq, productIds, skuIds, filterVariationId,
                                              mode = 'sku', qrMode = false, onClose }) {
  const { projectId } = useOutletContext();
  const [items,   setItems]   = useState([]);   // [{key, depth, kind, label, sub, payload, hasQty}]
  const [loading, setLoading] = useState(true);
  const [qtyMap,  setQtyMap]  = useState({});

  // Default scope = Configuration barcodes (EAN-13). EAN-13 is the global
  // industry standard for retail scanning, and per-configuration gives one
  // permanent code per SKU that doesn't change across batches.
  const [scope, setScope] = useState('config-ean13');

  // When the scope is a batch variant, a second Combobox appears with a list
  // of every batch that contains any of the selected products' SKUs.
  // 'all' = use latest batch per row (current behaviour); a specific batch_id
  // narrows the items tree to only the rows that belong to that batch.
  const [batchFilter,    setBatchFilter]    = useState('all');
  const [batchListForUI, setBatchListForUI] = useState([]);  // for the dropdown
  // EAN-13 scopes are batch-independent so they don't trigger the Batches combobox.
  const isBatchScope = scope === 'product-batch' || scope === 'config-batch' || scope === 'both-batch';

  // Tree state — collapse + selection (the new tri-checkbox column).
  // `collapsed` hides descendants in the render; `selected` decides which rows
  // are actually included in the print payload.
  const [collapsed, setCollapsed] = useState(new Set());
  const [selected,  setSelected]  = useState(new Set());
  const toggleCollapsed = (key) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Advanced encoding toggles — applied to every encoded value before rendering.
  const [includeDate,    setIncludeDate]    = useState(false);
  const [productionDate, setProductionDate] = useState('');
  const [includeBatch,   setIncludeBatch]   = useState(false);
  const [batchName,      setBatchName]      = useState('');
  const [includeQty,     setIncludeQty]     = useState(false);
  const [qtyInBatch,     setQtyInBatch]     = useState('');
  const [includeSerial,  setIncludeSerial]  = useState(false);
  // Symbology — 2 comboboxes: family (1d / EAN-UPC / 2d) + specific code.
  // Default = EAN-13 to match the default scope (Configuration barcodes EAN-13).
  const [symFamily,    setSymFamily]    = useState('eanupc');
  const [symbology,    setSymbology]    = useState('ean13');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Changing family resets sub to that family's first choice — keeps state coherent.
  const changeFamily = (fam) => {
    setSymFamily(fam);
    const firstSub = SYMBOLOGY_CHOICES[fam]?.[0]?.value;
    if (firstSub) setSymbology(firstSub);
  };

  // Load project-level barcode defaults so the modal pre-fills with merchant's preference.
  useEffect(() => {
    if (!open) return;
    fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setIncludeDate(!!d.barcode_include_date);
        setIncludeBatch(!!d.barcode_include_batch);
        setIncludeQty(!!d.barcode_include_qty);
        setIncludeSerial(!!d.barcode_include_serial);
      })
      .catch(() => {});
  }, [open, projectId]);

  const [format,      setFormat]      = useState('50x30');
  // Barcode is on by default — that's the whole point of the modal; Title /
  // SKU / Price stay off so the default label is a clean barcode-only sticker.
  const [showSku,     setShowSku]     = useState(false);
  const [showBarcode, setShowBarcode] = useState(true);
  const [showTitle,   setShowTitle]   = useState(false);
  const [showPrice,   setShowPrice]   = useState(false);
  const [copiesAll,   setCopiesAll]   = useState(1);

  const [previewBlobUrl, setPreviewBlobUrl] = useState(null);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const iframeRef = useRef(null);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Items loader — reruns whenever scope changes. Builds a flat list with `depth`
  // so the renderer can visually nest rows (product / variation / sku / batch).
  // Header rows (kind ending in '-header') don't have their own qty input — they
  // exist for hierarchy only. Leaf rows have `payload` (the backend kind+id) +
  // `hasQty: true`.
  useEffect(() => {
    if (!open) return;
    setLoading(true); setErr('');
    (async () => {
      try {
        const list = [];

        // Resolve list of products to drive the tree. productIds takes priority;
        // skuIds path collapses to "fetch parent products of these SKUs".
        let resolvedProductIds = productIds || [];
        if (!resolvedProductIds.length && skuIds?.length) {
          const res = await fetch(`${API_BASE}/api/skus/lookup${pq}&ids=${skuIds.join(',')}`,
            { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            resolvedProductIds = [...new Set((data || []).map(r => r.product_id))];
          }
        }

        const allProducts = (await Promise.all(resolvedProductIds.map(pid =>
          fetch(`${API_BASE}/api/products/${pid}${pq}`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        ))).filter(Boolean);

        // For all batch-encoded scopes we need the batches list to pick latest
        // per product / SKU. Fetch once + filter on the FE.
        const needsBatches = scope === 'product-batch' || scope === 'config-batch' || scope === 'both-batch';
        let allBatches = [];
        if (needsBatches) {
          const res = await fetch(`${API_BASE}/api/projects/${projectId}/batches`,
            { credentials: 'include' });
          if (res.ok) {
            const j = await res.json();
            allBatches = Array.isArray(j) ? j : (j.items || []);
          }
        }

        // Build the list of SKU ids that belong to the chosen products.
        const ownSkuIds = new Set(
          allProducts.flatMap(p => (p.conf_layer_1 || p.variations || [])
            .flatMap(v => (v.conf_layer_2 || v.configurations || []).map(c => c.id)))
        );

        // Batches Combobox shows UNIQUE batch_names (not per-SKU rows). One
        // logical batch can span multiple SKUs across warehouses — they all
        // share the same name, so the merchant picks "the batch" once.
        const seenNames = new Map();   // batch_name → { name, count, latestReceivedAt }
        if (needsBatches) {
          for (const b of allBatches) {
            if (!ownSkuIds.has(b.sku_id)) continue;
            const cur = seenNames.get(b.batch_name);
            if (cur) {
              cur.count += 1;
              if ((b.received_at || '') > (cur.latestReceivedAt || ''))
                cur.latestReceivedAt = b.received_at;
            } else {
              seenNames.set(b.batch_name, {
                name: b.batch_name, count: 1, latestReceivedAt: b.received_at,
              });
            }
          }
        }
        // Sort by latest received first — most recent batch at the top of the list.
        const batchesForUI = Array.from(seenNames.values())
          .sort((a, b) => (b.latestReceivedAt || '').localeCompare(a.latestReceivedAt || ''));
        setBatchListForUI(batchesForUI);

        // If the merchant has filtered to one specific batch_name, restrict
        // every row's batch lookup to rows sharing that name.
        const effectiveBatches = (needsBatches && batchFilter !== 'all')
          ? allBatches.filter(b => b.batch_name === batchFilter)
          : allBatches;

        // Helper — latest batch row for a given SKU (most recent received_at).
        const latestBatchForSku = (skuId) => {
          const candidates = effectiveBatches.filter(b => b.sku_id === skuId);
          if (candidates.length === 0) return null;
          return candidates.reduce((a, b) =>
            (a.received_at || '') > (b.received_at || '') ? a : b);
        };

        for (const p of allProducts) {
          const layer1 = p.conf_layer_1 || p.variations || [];
          const showProductLeaf  = scope === 'product' || scope === 'both' || scope === 'product-batch' || scope === 'both-batch' || scope === 'product-ean13' || scope === 'both-ean13';
          const showConfigLeaves = scope === 'config'  || scope === 'both' || scope === 'config-batch'  || scope === 'both-batch'  || scope === 'config-ean13'  || scope === 'both-ean13';

          // Top-level product header — carries the product cover image so the
          // tree reads like the real Inventory tree. Images live on variations
          // (L1) in this schema, NOT on the product itself, so we walk the
          // variations to find the first non-empty image.
          let productImg = null;
          for (const v of layer1) {
            const arr = Array.isArray(v.images) && v.images.length > 0 ? v.images
              : (v.image_url || v.image ? [v.image_url || v.image] : []);
            if (arr[0]) { productImg = arr[0]; break; }
          }
          list.push({
            key: `phead:${p.id}`, depth: 0, kind: 'product-header',
            label: p.title,
            sub: scope === 'product' ? (p.sku || p.barcode || '(no SKU)')
               : `${layer1.length} variation${layer1.length === 1 ? '' : 's'}`,
            hasQty: false,
            imageUrl: productImg,
          });

          // Product-level leaf (SKU / batch / ean13 encoded).
          if (showProductLeaf) {
            if (scope === 'product-ean13' || scope === 'both-ean13') {
              // EAN-13 leaf — encodes products.barcode (auto-minted). Backend
              // resolves this via the same product_id payload + encode_field hint.
              list.push({
                key: `pe:${p.id}`, depth: 1, kind: 'product-ean13',
                label: 'Product EAN-13', sub: p.barcode || '(will be minted)',
                payload: { product_id: p.id, encode_field: 'ean13' }, hasQty: true,
              });
            } else if (scope === 'product-batch' || scope === 'both-batch') {
              // Pick latest batch across all SKUs of this product.
              const allSkuIds = layer1.flatMap(v => (v.conf_layer_2 || v.configurations || []).map(c => c.id));
              const candidates = effectiveBatches.filter(b => allSkuIds.includes(b.sku_id));
              const latest = candidates.length > 0
                ? candidates.reduce((a, b) => (a.received_at || '') > (b.received_at || '') ? a : b)
                : null;
              if (latest) {
                list.push({
                  key: `pb:${p.id}`, depth: 1, kind: 'product-batch',
                  label: 'Product batch barcode', sub: latest.batch_name,
                  payload: { batch_id: latest.id }, hasQty: true,
                });
              } else {
                // No batches — degrade to SKU encoding so the row isn't useless.
                list.push({
                  key: `p:${p.id}`, depth: 1, kind: 'product',
                  label: 'Product barcode (no batch yet)', sub: p.sku || '(no SKU)',
                  payload: { product_id: p.id }, hasQty: true,
                });
              }
            } else {
              list.push({
                key: `p:${p.id}`, depth: 1, kind: 'product',
                label: 'Product barcode', sub: p.sku || p.barcode || '(no SKU)',
                payload: { product_id: p.id }, hasQty: true,
              });
            }
          }

          // Per-configuration rows.
          if (showConfigLeaves) {
            for (const v of layer1) {
              if (filterVariationId && v.id !== filterVariationId) continue;
              const layer2 = v.conf_layer_2 || v.configurations || [];
              // Variation cover image (mirrors Inventory tree).
              const vArr = Array.isArray(v.images) && v.images.length > 0 ? v.images
                : (v.image_url || v.image ? [v.image_url || v.image] : []);
              list.push({
                key: `vhead:${v.id}`, depth: 1, kind: 'variation-header',
                label: v.variation_name || v.name || '—',
                sub: `${layer2.length} SKU${layer2.length === 1 ? '' : 's'}`,
                hasQty: false,
                imageUrl: vArr[0] || null,
              });
              for (const c of layer2) {
                if (scope === 'config-ean13' || scope === 'both-ean13') {
                  // EAN-13 leaf per SKU — encodes l2.barcode (auto-minted).
                  list.push({
                    key: `ce:${c.id}`, depth: 2, kind: 'sku-ean13',
                    label: c.configuration_name || c.name || '—',
                    sub: c.barcode || '(will be minted)',
                    payload: { sku_id: c.id, encode_field: 'ean13' }, hasQty: true,
                  });
                } else if (scope === 'config-batch' || scope === 'both-batch') {
                  // One leaf per SKU using the latest batch's id.
                  const latest = latestBatchForSku(c.id);
                  if (latest) {
                    list.push({
                      key: `cb:${c.id}`, depth: 2, kind: 'sku-batch',
                      label: c.configuration_name || c.name || '—',
                      sub: `batch: ${latest.batch_name}`,
                      payload: { batch_id: latest.id }, hasQty: true,
                    });
                  } else {
                    list.push({
                      key: `s:${c.id}`, depth: 2, kind: 'sku',
                      label: c.configuration_name || c.name || '—',
                      sub: `${c.sku_code || ''} · no batch yet`,
                      payload: { sku_id: c.id }, hasQty: true,
                    });
                  }
                } else {
                  // 'config' or 'both' — plain SKU-encoded leaf.
                  list.push({
                    key: `s:${c.id}`, depth: 2, kind: 'sku',
                    label: c.configuration_name || c.name || '—',
                    sub: c.sku_code || c.barcode || '',
                    payload: { sku_id: c.id }, hasQty: true,
                  });
                }
              }
            }
          }
        }

        setItems(list);
        // Default qty=1 on every leaf; preserve user-edited qtys where keys still exist.
        setQtyMap(prev => Object.fromEntries(list
          .filter(it => it.hasQty)
          .map(it => [it.key, prev[it.key] ?? 1])
        ));
        // Auto-select every leaf when the list rebuilds — merchant deselects what
        // they don't want, same UX as Pick SKUs to receive stock for.
        setSelected(new Set(list.filter(it => it.hasQty).map(it => it.key)));
      } catch (e) {
        setErr('Failed to load items');
      } finally {
        setLoading(false);
      }
    })();
  }, [open, productIds, skuIds, filterVariationId, mode, pq, scope, projectId, batchFilter]);

  // Reset batch filter to "all" when the scope flips between SKU/Batch variants.
  useEffect(() => {
    if (!isBatchScope) setBatchFilter('all');
  }, [isBatchScope]);

  useEffect(() => () => { if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl); }, [previewBlobUrl]);

  const totalLabels = useMemo(() => {
    return items
      .filter(it => it.hasQty && selected.has(it.key))
      .reduce((sum, it) => sum + Math.max(0, qtyMap[it.key] || 0) * Math.max(1, copiesAll), 0);
  }, [items, qtyMap, copiesAll, selected]);

  const generatePreview = async () => {
    setBusy(true); setErr('');
    try {
      const payloadItems = items
        .filter(it => it.hasQty && selected.has(it.key) && (qtyMap[it.key] || 0) > 0)
        .map(it => ({ ...it.payload, qty: qtyMap[it.key] }));
      if (payloadItems.length === 0) { setErr('Select at least one row + set qty ≥ 1'); setBusy(false); return; }
      if (totalLabels > 2000) { setErr('Too many labels (max 2000)'); setBusy(false); return; }

      // Map UI symbology to the backend value — backend knows every entry in
      // SYMBOLOGY_CHOICES directly. The qr_mode flag still flips the renderer
      // to QR codes for any 2D pick.
      const backendSymbology = symbology;
      const sendQrMode = qrMode || symFamily === '2d';

      const res = await fetch(`${API_BASE}/api/projects/${projectId}/print-barcodes`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: payloadItems, format,
          show_sku: showSku, show_barcode: showBarcode,
          show_title: showTitle, show_price: showPrice,
          copies_per_sku: copiesAll,
          auto_print: false,
          // Advanced encoding payload — values are interpolated into every label.
          include_date:     includeDate,
          production_date:  includeDate ? (productionDate || null) : null,
          include_batch:    includeBatch,
          batch_name:       includeBatch ? batchName : null,
          include_qty:      includeQty,
          qty_in_batch:     includeQty ? parseInt(qtyInBatch || '0', 10) : null,
          include_serial:   includeSerial,
          symbology:        backendSymbology,
          qr_mode:          sendQrMode,
        }),
      });
      if (!res.ok) { setErr('Server error'); setBusy(false); return; }
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(URL.createObjectURL(blob));
    } finally { setBusy(false); }
  };

  // Auto-generate preview when settings change (debounced).
  useEffect(() => {
    if (!open || loading || items.length === 0) return;
    const t = setTimeout(() => { generatePreview(); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, items, qtyMap, selected, format, showSku, showBarcode, showTitle, showPrice, copiesAll,
       includeDate, productionDate, includeBatch, batchName, includeQty, qtyInBatch, includeSerial,
       symFamily, symbology]);

  const triggerPrint = () => {
    const f = iframeRef.current;
    if (!f) return;
    try { f.contentWindow.focus(); f.contentWindow.print(); }
    catch { setErr('Print failed — try downloading instead'); }
  };

  const downloadHtml = () => {
    if (!previewBlobUrl) return;
    const a = document.createElement('a');
    a.href = previewBlobUrl; a.download = `barcodes-${Date.now()}.html`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  if (!open) return null;

  return createPortal(
    <div className="auth-modal-overlay print-bc-split-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="print-bc-split-pair"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>

      {/* LEFT modal — settings (cards stack scrollable; action footer is sticky) */}
      <div className="auth-modal cpm-modal print-bc-modal-left" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Print barcodes</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  <b>{totalLabels}</b> label{totalLabels === 1 ? '' : 's'} total
                </span>
              </div>
            </div>
          </div>
          {/* Close button lives on the Preview (right) modal — not here. */}
        </div>

        {/* Scrollable body — plain cpm-form with cpm-sections (no card chrome). */}
        <div className="auth-modal-body print-bc-body">
          <form className="cpm-form" onSubmit={(e) => e.preventDefault()}>

            <div className="cpm-section">
              <label className="po-field-label">Scope</label>
              <Combobox value={scope} options={SCOPE_OPTIONS} onChange={setScope} />
            </div>

            {/* Batches Combobox — only when scope is a batch variant. Lists
                UNIQUE batch_names that contain any SKU from the selected products.
                One logical batch covers many SKUs/warehouses sharing the same name. */}
            {isBatchScope && (
              <div className="cpm-section">
                <label className="po-field-label">Batches</label>
                <Combobox value={batchFilter}
                  options={[
                    { value: 'all', label: `All batches (latest per row, ${batchListForUI.length} names)` },
                    ...batchListForUI.map(b => ({
                      value: b.name,
                      label: `${b.name} · ${b.count} row${b.count === 1 ? '' : 's'}`,
                    })),
                  ]}
                  onChange={setBatchFilter} />
                <span className="cpm-section-hint">
                  Pick one batch to print only its labels, or leave "All" to use the latest batch per row.
                </span>
              </div>
            )}

            {/* Symbology — 2 comboboxes, family + specific code. Mirrors tec-it.com. */}
            <div className="cpm-section">
              <label className="po-field-label">Symbology</label>
              <div className="print-bc-symbology-row">
                <Combobox value={symFamily} options={SYMBOLOGY_FAMILIES} onChange={changeFamily} />
                <Combobox value={symbology} options={SYMBOLOGY_CHOICES[symFamily] || []} onChange={setSymbology} />
              </div>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Label format</label>
              <Combobox value={format} options={FORMAT_OPTIONS} onChange={setFormat} />
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Show on label</label>
              <div className="print-bc-checks">
                <label><input type="checkbox" className="cat-prod-checkbox" checked={showTitle}   onChange={e => setShowTitle(e.target.checked)}   /> Title</label>
                <label><input type="checkbox" className="cat-prod-checkbox" checked={showBarcode} onChange={e => setShowBarcode(e.target.checked)} /> Barcode</label>
                <label><input type="checkbox" className="cat-prod-checkbox" checked={showSku}     onChange={e => setShowSku(e.target.checked)}     /> SKU</label>
                <label><input type="checkbox" className="cat-prod-checkbox" checked={showPrice}   onChange={e => setShowPrice(e.target.checked)}   /> Price</label>
              </div>
            </div>

            <div className="cpm-section">
              <label className="po-field-label">Copies per row</label>
              <input type="number" min="1" max="50" className="crm-input" value={copiesAll}
                onChange={e => setCopiesAll(Math.max(1, Math.min(50, parseInt(e.target.value || '1', 10))))} />
              <span className="cpm-section-hint">Multiplied with per-row quantity in the items tree. Up to 50.</span>
            </div>

            {/* Advanced encoding — date / batch name / qty / serial */}
            <div className="cpm-section">
              <button type="button" className="print-bc-toggle-btn"
                onClick={() => setShowAdvanced(v => !v)}>
                {showAdvanced ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}
                Advanced encoding
                <span className="po-set-note">{showAdvanced ? '' : 'date · batch · qty · serial'}</span>
              </button>
              {showAdvanced && (
                <div className="print-bc-adv">
                  <label className="print-bc-check-row">
                    <input type="checkbox" className="cat-prod-checkbox" checked={includeDate}
                      onChange={e => setIncludeDate(e.target.checked)} />
                    <span>Include production date</span>
                    {includeDate && (
                      <span style={{ marginLeft: 'auto', minWidth: 160 }}>
                        <DatePicker value={productionDate} onChange={setProductionDate} tz={USER_TZ} />
                      </span>
                    )}
                  </label>
                  <label className="print-bc-check-row">
                    <input type="checkbox" className="cat-prod-checkbox" checked={includeBatch}
                      onChange={e => setIncludeBatch(e.target.checked)} />
                    <span>Include batch name</span>
                    {includeBatch && (
                      <input type="text" className="crm-input crm-input--sm" style={{ marginLeft: 'auto', width: 160 }}
                        value={batchName} onChange={e => setBatchName(e.target.value)}
                        placeholder="B-202605-001" maxLength={20} />
                    )}
                  </label>
                  <label className="print-bc-check-row">
                    <input type="checkbox" className="cat-prod-checkbox" checked={includeQty}
                      onChange={e => setIncludeQty(e.target.checked)} />
                    <span>Include quantity in batch</span>
                    {includeQty && (
                      <input type="number" min="1" className="crm-input crm-input--sm" style={{ marginLeft: 'auto', width: 90 }}
                        value={qtyInBatch} onChange={e => setQtyInBatch(e.target.value)} placeholder="100" />
                    )}
                  </label>
                  <label className="print-bc-check-row">
                    <input type="checkbox" className="cat-prod-checkbox" checked={includeSerial}
                      onChange={e => setIncludeSerial(e.target.checked)} />
                    <span>Include serial counter (NNNN per unit)</span>
                  </label>
                </div>
              )}
            </div>

            {/* Items tree — Pick SKUs to receive stock for style: chevron + folder + cube + TriCheckbox */}
            <div className="cpm-section">
              <label className="po-field-label">Items</label>
              <div className="po-bulk-tree print-bc-tree-list">
                {loading && <p className="crm-placeholder">Loading…</p>}
                {!loading && items.length === 0 && <p className="crm-placeholder">Nothing to print</p>}
                {!loading && renderItemsTree(items, collapsed).map(it => (
                  <ItemTreeRow key={it.key} item={it}
                    items={items}
                    selected={selected}
                    setSelected={setSelected}
                    collapsed={collapsed.has(it.key)}
                    qty={qtyMap[it.key]}
                    onToggle={() => toggleCollapsed(it.key)}
                    onQtyChange={(n) => setQtyMap(prev => ({ ...prev, [it.key]: n }))} />
                ))}
              </div>
            </div>
          </form>
        </div>

        {/* Sticky action footer — always pinned to the bottom of the modal */}
        <div className="print-bc-footer">
          {err && <p className="auth-msg auth-msg--err print-bc-footer-err">{err}</p>}
          <div className="auth-actions print-bc-actions">
            <button className="crm-submit-btn" disabled={busy || !previewBlobUrl}
              onClick={triggerPrint} type="button">
              Print {totalLabels} label{totalLabels === 1 ? '' : 's'}
            </button>
            <button className="auth-btn-check print-bc-download-btn" disabled={!previewBlobUrl}
              onClick={downloadHtml} type="button" title="Download as HTML">
              <DownloadSimple weight="bold" />
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT modal — live preview (close button lives here, top-right) */}
      <div className="auth-modal print-bc-modal-right" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">Preview</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  Exactly what the printer will produce
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body print-bc-preview-body">
          <div className="print-bc-preview">
            {busy && <div className="print-bc-busy">Generating preview…</div>}
            {!busy && !previewBlobUrl && (
              <div className="print-bc-empty">Adjust settings to see a live preview</div>
            )}
            {previewBlobUrl && (
              <iframe ref={iframeRef} title="Print preview" src={previewBlobUrl}
                className="print-bc-iframe" />
            )}
          </div>
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
}

// Walks the flat items list with `depth` markers and filters out any rows that
// are descendants of a header currently in the `collapsed` set. The renderer
// then iterates this filtered list — much simpler than reshaping into nested
// objects per scope change.
function renderItemsTree(items, collapsed) {
  const out = [];
  let skipUntilDepth = -1;
  for (const it of items) {
    if (skipUntilDepth >= 0 && it.depth > skipUntilDepth) continue;
    skipUntilDepth = -1;
    out.push(it);
    const isHeader = !it.hasQty;
    if (isHeader && collapsed.has(it.key)) {
      // Future siblings at depth <= this one are still rendered; deeper ones get cut.
      skipUntilDepth = it.depth;
    }
  }
  return out;
}

// Walk descendants of a header — returns leaf keys that belong to this subtree.
// Used by the TriCheckbox to cascade-toggle every leaf under a product/variation/SKU.
function leafKeysUnder(items, headerIndex) {
  const header = items[headerIndex];
  const out = [];
  for (let i = headerIndex + 1; i < items.length; i++) {
    if (items[i].depth <= header.depth) break;
    if (items[i].hasQty) out.push(items[i].key);
  }
  return out;
}

// Row in the items tree — mirrors the Pick SKUs to receive stock for layout:
// TriCheckbox + chevron + folder/cube icon + label + meta. Leaves carry a qty
// input on the right. Headers cascade-toggle their descendants.
function ItemTreeRow({ item, items, selected, setSelected, collapsed, onToggle, qty, onQtyChange }) {
  const isHeader = !item.hasQty;
  const depthCls = item.depth === 0 ? '' :
                   item.depth === 1 ? ' po-bulk-tree-row--depth-1' :
                   item.depth === 2 ? ' po-bulk-tree-row--depth-2' :
                                       ' po-bulk-tree-row--depth-3';

  // Selection state — leaf checks `selected.has(key)`; headers aggregate descendants.
  const idx = items.indexOf(item);
  const descendants = isHeader ? leafKeysUnder(items, idx) : null;
  const checkedCount = descendants ? descendants.filter(k => selected.has(k)).length : (selected.has(item.key) ? 1 : 0);
  const triState = isHeader
    ? (checkedCount === 0 ? 'none' : checkedCount === descendants.length ? 'all' : 'some')
    : (selected.has(item.key) ? 'all' : 'none');

  const onCheckboxChange = (checked) => {
    setSelected(prev => {
      const next = new Set(prev);
      const keys = isHeader ? descendants : [item.key];
      for (const k of keys) { if (checked) next.add(k); else next.delete(k); }
      return next;
    });
  };

  return (
    <div className={`po-bulk-tree-row${depthCls}${isHeader ? ' print-bc-tree-header' : ''}`}>
      {isHeader ? (
        <>
          <button type="button" className="po-tree-chevron" onClick={onToggle}>
            {collapsed ? <CaretRight weight="bold" /> : <CaretDown weight="bold" />}
          </button>
          <TriCheckbox state={triState} onChange={onCheckboxChange} />
          {/* Depth 0 (product) + depth 1 (variation) get cover images, just
              like the Inventory tree. Fall back to Folder/spacer when missing. */}
          {item.imageUrl
            ? <img src={item.imageUrl} alt="" className="print-bc-tree-img" />
            : item.depth === 0
              ? <Folder weight="duotone" className="po-disc-cell--strong" />
              : <span className="po-tree-chevron-spacer" />}
          <span className="po-set-strong">{item.label}</span>
          {item.sub && <span className="po-set-note po-tree-meta">· {item.sub}</span>}
        </>
      ) : (
        <>
          <span className="po-tree-chevron-spacer" />
          <TriCheckbox state={triState} onChange={onCheckboxChange} />
          <Cube className="po-disc-cell--muted" />
          <span>{item.label}</span>
          {item.sub && <span className="po-set-note po-tree-meta">· {item.sub}</span>}
          <input type="number" min="0" max="500"
            className="crm-input crm-input--sm print-bc-sku-qty"
            style={{ marginLeft: 'auto' }}
            disabled={triState === 'none'}
            value={qty ?? 1}
            onChange={e => onQtyChange(Math.max(0, Math.min(500, parseInt(e.target.value || '0', 10))))} />
        </>
      )}
    </div>
  );
}

// Tri-state checkbox copied from BulkReceiveWizard — keeps the look 1:1 with
// "Pick SKUs to receive stock for".
function TriCheckbox({ state, onChange }) {
  const checked = state === 'all';
  const indet   = state === 'some';
  return (
    <input type="checkbox" className="cat-prod-checkbox po-include-cb"
      checked={checked}
      ref={el => { if (el) el.indeterminate = indet; }}
      onChange={e => onChange(e.target.checked)}
      onClick={e => e.stopPropagation()} />
  );
}
