import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { Plus, Trash, CaretDown, ArrowCounterClockwise, DotsSixVertical, ArrowsOut, X, MagicWand } from '@phosphor-icons/react';
import CodeMirror from '@uiw/react-codemirror';
import { json as cmJson } from '@codemirror/lang-json';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { API_BASE } from '../../api.js';
import { decodeHash } from '../../Utils/hashids.js';
import { DynamicBlock } from '../../Utils/DynamicBlock.js';
import { useUndoStack } from '../../Utils/UndoStack.js';
import { useUndoableSave } from '../../Utils/useUndoableSave.js';
import { RowContextMenu } from '../../Utils/RowContextMenu.jsx';
import LayerBlock, { snapshotLayerNode } from './LayerBlock.jsx';
import SpecificationsBlock from './SpecificationsBlock.jsx';
import { CpmCategorySelect } from '../Project/Products/CreateProductModal.jsx';
import { Combobox } from '../Project/Booking/BookingCreateModal.jsx';
import '../../Style/Authentication.css';
import '../../Style/Organization.css';
import '../../Style/Products.css';
import '../../Style/Booking.css';


export default function ProductOverview() {
  const { projectId, setProductContext } = useOutletContext();
  const { productHash } = useParams();
  const productId = decodeHash(productHash);
  const pq = `?project_id=${projectId}`;

  const [product,  setProduct]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [toast,    setToast]    = useState('');
  // Selected row id at each layer 1..5. chain[N-1] = id of selected row at layer N.
  const [chain, setChain] = useState([null, null, null, null, null]);
  // How many layers are visible. Min = max(1, backend max_layer); user expands via "Create new layer".
  const [shownLayers, setShownLayers] = useState(1);
  const toastRef = useRef(null);
  const { register: registerUndo, undo: performUndo, toast: undoToast, dismissToast: dismissUndo } = useUndoStack();

  // Bulk-select: single source of truth; switching scope auto-clears the previous one.
  const [bulk, setBulk] = useState({ scope: null, ids: [], actions: null });
  const clearBulk = useCallback(() => setBulk({ scope: null, ids: [], actions: null }), []);

  useEffect(() => {
    const onKey = (e) => {
      // Esc clears; Delete/Backspace fires bulk delete (skipped inside text inputs).
      const t = e.target;
      const tag = t?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable;
      if (e.key === 'Escape' && bulk.ids.length) {
        e.preventDefault();
        clearBulk();
        return;
      }
      if (!inField && bulk.ids.length && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        bulk.actions?.delete?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bulk, clearBulk]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 2400);
  }, []);

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
  }, [productId, projectId, productHash, pq, setProductContext]);

  useEffect(() => () => setProductContext?.(null), [setProductContext]);

  // Reset chain + shownLayers on product change.
  useEffect(() => {
    setShownLayers(1);
    setChain([null, null, null, null, null]);
  }, [productId]);

  const reloadProduct = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/products/${productId}${pq}`, { credentials: 'include' });
    if (res.ok) setProduct(await res.json());
  }, [productId, pq]);

  // Greedy chain-fill: keep current id if still valid, else auto-pick first row at that layer.
  const fillChain = useCallback((startChain, productData) => {
    const next = [...startChain];
    if (!productData) return next;
    let level = productData.variations || [];
    for (let i = 0; i < 5; i++) {
      if (!level || level.length === 0) {
        for (let j = i; j < 5; j++) next[j] = null;
        break;
      }
      const cur = next[i];
      let chosen = cur != null ? level.find(x => x.id === cur) : null;
      if (!chosen) chosen = level[0];
      next[i] = chosen.id;
      level = i === 0 ? (chosen.configurations || []) : (chosen.children || []);
    }
    return next;
  }, []);

  // Sync shownLayers from backend's max_layer; auto-pick first row at each layer.
  useEffect(() => {
    if (!product) return;
    const maxLayer = product.max_layer || 1;
    setShownLayers(prev => Math.max(prev, maxLayer));
    setChain(prev => fillChain(prev, product));
  }, [product, fillChain]);

  // Walk the tree per chain → items at each layer + parent's effective_price for placeholder.
  const layers = useMemo(() => {
    if (!product) return null;
    const out = [{ items: product.variations || [], parentId: null, parentEffectivePrice: null }];
    let level = product.variations || [];
    for (let i = 0; i < 5; i++) {
      const sel = level.find(x => x.id === chain[i]);
      if (!sel) break;
      const nextItems = i === 0 ? (sel.configurations || []) : (sel.children || []);
      out.push({
        items: nextItems,
        parentId: sel.id,
        parentEffectivePrice: sel.effective_price ?? null,
      });
      level = nextItems;
    }
    return out;
  }, [product, chain]);

  const setChainAt = (level, id) => {
    setChain(prev => {
      const next = [...prev];
      next[level] = id;
      for (let i = level + 1; i < 5; i++) next[i] = null;
      return fillChain(next, product);
    });
  };

  // fillChain already keeps the chain greedily filled, so just bump shownLayers.
  const createNewLayer = () => setShownLayers(n => Math.min(n + 1, 5));

  const deleteLastLayer = async () => {
    if (shownLayers <= 1) return;
    if (!confirm(`Delete entire Layer ${shownLayers}?\nAll rows at this layer will be lost. Carts/orders referencing them will break.`)) return;
    // Snapshot every row at the target layer (with subtree) for Undo.
    const layerN = shownLayers;
    const rows = [];
    const walk = (items, currentLayer, parentId) => {
      if (!items) return;
      if (currentLayer === layerN) {
        for (const it of items) rows.push({ parent_id: parentId, data: snapshotLayerNode(it) });
        return;
      }
      for (const it of items) {
        const kids = currentLayer === 1 ? (it.configurations || []) : (it.children || []);
        walk(kids, currentLayer + 1, it.id);
      }
    };
    walk(product.variations || [], 1, null);
    const res = await fetch(`${API_BASE}/api/products/${productId}/layers/${layerN}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) return;
    setShownLayers(prev => Math.max(prev - 1, 1));
    await reloadProduct();
    if (rows.length && registerUndo) {
      registerUndo({
        description: `Layer ${layerN} deleted (${rows.length} row${rows.length === 1 ? '' : 's'})`,
        undo: async () => {
          const r = await fetch(`${API_BASE}/api/products/${productId}/restore${pq}`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'layer', layer: layerN, rows }),
          });
          if (!r.ok) return;
          setShownLayers(prev => Math.max(prev, layerN));
          await reloadProduct();
        },
      });
    }
  };

  if (loading)  return <Shell><p className="crm-placeholder">Loading…</p></Shell>;
  if (notFound) return <Shell><p className="crm-placeholder">Product not found.</p></Shell>;

  const lastLayerItems = layers?.[shownLayers - 1]?.items || [];
  const canCreateNewLayer = shownLayers < 5 && lastLayerItems.length > 0;

  return (
    <Shell>
      <h1 className="crm-page-title">{product.title || 'Untitled'}</h1>

      <GeneralBlock product={product} pq={pq} setProduct={setProduct}
        setProductContext={setProductContext} productHash={productHash}
        showToast={showToast} registerUndo={registerUndo} />

      {/* Service-type products: full inline editor that PATCHes booking_services. */}
      {product.product_type === 'service' && (
        <ServiceDetailsBlock product={product} pq={pq}
          registerUndo={registerUndo} showToast={showToast} />
      )}

      {/* Event details — datetime + venue. Stored as reserved Custom Fields. */}
      {product.product_type === 'event' && (
        <EventDetailsBlock product={product} productId={productId} pq={pq}
          setProduct={setProduct} showToast={showToast} />
      )}

      {/* Digital files — primary block for type=digital. */}
      {product.product_type === 'digital' && (
        <DigitalFilesBlock product={product} productId={productId} pq={pq}
          setProduct={setProduct} showToast={showToast} />
      )}

      {/* Hide layers + specs for digital/service (single-SKU). Event keeps them as ticket types. */}
      {product.product_type !== 'digital' && product.product_type !== 'service' && layers && [1, 2, 3, 4, 5].map(n => {
        if (n > shownLayers) return null;
        const layerData = layers[n - 1];
        if (!layerData) return null;
        const isLeaf = n === shownLayers;
        const showDelete = n >= 2 && n === shownLayers;
        return (
          <LayerBlock key={n}
            layer={n}
            items={layerData.items}
            parentId={layerData.parentId}
            inheritedPrice={layerData.parentEffectivePrice}
            productId={productId} pq={pq}
            reloadProduct={reloadProduct}
            selectedId={chain[n - 1]}
            onSelect={(id) => setChainAt(n - 1, id)}
            isLeaf={isLeaf}
            onDeleteLayer={showDelete ? deleteLastLayer : null}
            registerUndo={registerUndo}
            bulk={bulk} setBulk={setBulk} clearBulk={clearBulk}
            productType={product.product_type} />
        );
      })}

      {product.product_type !== 'digital' && product.product_type !== 'service' && canCreateNewLayer && (
        <button className="po-add-layer-btn" type="button" onClick={createNewLayer}>
          <Plus weight="bold" /> Create Configuration Layer {shownLayers + 1}
        </button>
      )}

      {/* Modifiers — multi-select add-ons (e.g. food: extra cheese / no onion). */}
      {product.product_type === 'physical' && (
        <ModifiersBlock product={product} productId={productId} pq={pq}
          reloadProduct={reloadProduct} registerUndo={registerUndo} />
      )}

      {product.product_type !== 'digital' && product.product_type !== 'service' && (
        <SpecificationsBlock
          product={product}
          productId={productId} pq={pq}
          chain={chain}
          shownLayers={shownLayers}
          reloadProduct={reloadProduct}
          registerUndo={registerUndo}
          bulk={bulk} setBulk={setBulk} clearBulk={clearBulk} />
      )}

      {product.product_type !== 'service' && (
        <CustomFieldsBlock product={product} productId={productId} pq={pq}
          setProduct={setProduct} showToast={showToast} registerUndo={registerUndo}
          bulk={bulk} setBulk={setBulk} clearBulk={clearBulk} />
      )}

      {product.product_type !== 'service' && (
        <SeoBlock product={product} pq={pq} setProduct={setProduct} showToast={showToast} registerUndo={registerUndo} />
      )}

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body
      )}

      {undoToast && createPortal(
        <div className="undo-toast" role="status">
          <ArrowCounterClockwise weight="bold" className="undo-toast-icon" />
          <span className="undo-toast-text">{undoToast.description}</span>
          <button type="button" className="undo-toast-btn"
            onClick={() => { performUndo(); }}>Undo</button>
          <button type="button" className="undo-toast-close" aria-label="Dismiss"
            onClick={dismissUndo}>×</button>
        </div>,
        document.body
      )}

      {bulk.ids.length > 0 && createPortal(
        <BulkBar bulk={bulk} clearBulk={clearBulk} />,
        document.body
      )}
    </Shell>
  );
}

// Figma-style floating bulk-select toolbar.
function BulkBar({ bulk, clearBulk }) {
  const label = bulkScopeLabel(bulk.scope, bulk.ids.length);
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
      <span className="bulk-bar-count">
        <span className="bulk-bar-dot" />
        {bulk.ids.length} {label}
      </span>
      <div className="bulk-bar-divider" />
      <button type="button" className="bulk-bar-btn bulk-bar-btn--danger"
        onClick={() => bulk.actions?.delete?.()} title="Delete selected (or press Delete)">
        <Trash weight="bold" /> Delete
      </button>
      <button type="button" className="bulk-bar-btn" onClick={clearBulk} title="Cancel (Esc)">
        Cancel
      </button>
    </div>
  );
}

function bulkScopeLabel(scope, n) {
  const plural = n === 1 ? '' : 's';
  if (scope === 'layer1')   return `variation${plural}`;
  if (scope === 'specs')    return `spec${plural}`;
  if (scope === 'cf')       return `field${plural}`;
  if (scope?.startsWith?.('layer-')) return `row${plural}`;
  return `item${plural}`;
}

function Shell({ children }) {
  return <div className="prod-page po-page">{children}</div>;
}

const PRODUCT_TYPE_OPTIONS = [
  { value: 'physical', label: 'Physical' },
  { value: 'digital',  label: 'Digital'  },
  { value: 'service',  label: 'Service'  },
  { value: 'event',    label: 'Event'    },
];

function GeneralBlock({ product, pq, setProduct, setProductContext, productHash, showToast, registerUndo }) {
  const [title,    setTitle]    = useState(product.title || '');
  const [subtitle, setSubtitle] = useState(product.subtitle || '');
  const [desc,     setDesc]     = useState(product.description || '');
  const [catId,    setCatId]    = useState(product.category_id ?? '');
  const [ptype,    setPtype]    = useState(product.product_type || 'physical');
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/categories${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCategories(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [pq]);

  const patch = useCallback(async (body) => {
    const res = await fetch(`${API_BASE}/api/products/${product.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { showToast('Save failed'); return false; }
    setProduct(p => ({ ...p, ...body }));
    showToast('Saved');
    return true;
  }, [product.id, pq, setProduct, showToast]);

  useUndoableSave({
    value: title, setValue: setTitle, serverValue: product.title || '',
    save: async (v) => {
      const trimmed = (v || '').trim();
      if (!trimmed) return false;
      const ok = await patch({ title: trimmed });
      if (ok) setProductContext?.({ name: trimmed, hash: productHash });
      return ok;
    },
    registerUndo, label: 'Title',
    shouldSave: (v) => !!(v || '').trim(),
  });
  useUndoableSave({
    value: subtitle, setValue: setSubtitle, serverValue: product.subtitle || '',
    save: (v) => patch({ subtitle: v }),
    registerUndo, label: 'Subtitle',
  });
  useUndoableSave({
    value: desc, setValue: setDesc, serverValue: product.description || '',
    save: (v) => patch({ description: v }),
    registerUndo, label: 'Description',
  });
  useUndoableSave({
    value: catId, setValue: setCatId, serverValue: product.category_id ?? '',
    save: (v) => patch({ category_id: v === '' ? null : Number(v) }),
    registerUndo, label: 'Category',
    silent: false,
    debounceMs: 50,
  });
  useUndoableSave({
    value: ptype, setValue: setPtype, serverValue: product.product_type || 'physical',
    save: (v) => patch({ product_type: v }),
    registerUndo, label: 'Type',
    silent: false,
    debounceMs: 50,
  });

  const titleEmpty = !title.trim();

  return (
    <section className="po-block">
      <div className="po-form">
        <Field label="Title" required error={titleEmpty ? 'Title is required' : null}>
          <input className={`crm-input po-input${titleEmpty ? ' po-input--invalid' : ''}`} value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Product name" maxLength={200} />
        </Field>
        <Field label="Subtitle">
          <input className="crm-input po-input" value={subtitle}
            onChange={e => setSubtitle(e.target.value)}
            placeholder="Short tagline shown under the title" maxLength={300} />
        </Field>
        <Field label="Description">
          <textarea className="crm-input po-textarea" value={desc} rows={5}
            onChange={e => setDesc(e.target.value)}
            placeholder="Full product description, materials, features…" />
        </Field>
        {ptype !== 'service' && (
          <Field label="Category">
            <CpmCategorySelect
              value={catId == null ? '' : String(catId)}
              categories={categories}
              onChange={setCatId} />
          </Field>
        )}
        <Field label="Type">
          <CfCombobox value={ptype} options={PRODUCT_TYPE_OPTIONS} onChange={setPtype} size="md" />
        </Field>
      </div>
    </section>
  );
}

function Field({ label, required, error, children }) {
  return (
    <div className="po-field">
      <label className="po-field-label1">
        {label}
        {required && <span className="po-field-required" aria-hidden="true">*</span>}
      </label>
      {children}
      {error && <span className="po-field-error">{error}</span>}
    </div>
  );
}


// ─── Custom Fields ────────────────────────────────────────────────
const CF_TYPE_OPTIONS = [
  { value: 'string',   label: 'string'   },
  { value: 'number',   label: 'number'   },
  { value: 'boolean',  label: 'boolean'  },
  { value: 'datetime', label: 'datetime' },
  { value: 'file',     label: 'file'     },
  { value: 'json',     label: 'json'     },
];
const CF_GLOBAL_OPTIONS = [
  { value: 'no',  label: 'No'  },
  { value: 'yes', label: 'Yes' },
];

function CustomFieldsBlock({ product, productId, pq, setProduct, showToast, registerUndo, bulk, setBulk, clearBulk }) {
  const fields = product.custom_fields || [];
  const realKeys = fields.filter(f => !f.is_placeholder).map(f => f.field_key);

  // POST — create new row (also turns a placeholder into a real one).
  const create = async (body) => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/custom-fields${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { showToast('Save failed'); return false; }
    const data = await res.json().catch(() => ({}));
    const saved = { ...body, field_key: data.field_key || body.field_key, is_placeholder: false };
    setProduct(p => {
      const arr = (p.custom_fields || []).filter(f => f.field_key !== saved.field_key);
      return { ...p, custom_fields: [...arr, saved] };
    });
    return true;
  };

  // PUT by old key — supports renaming.
  const update = async (originalKey, body) => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/custom-fields/${encodeURIComponent(originalKey)}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Save failed');
      return false;
    }
    const data = await res.json().catch(() => ({}));
    setProduct(p => {
      const arr = [...(p.custom_fields || [])];
      const idx = arr.findIndex(f => f.field_key === originalKey && !f.is_placeholder);
      if (idx >= 0) arr[idx] = { ...arr[idx], ...body, field_key: data.field_key || body.field_key, is_placeholder: false };
      return { ...p, custom_fields: arr };
    });
    return true;
  };

  const remove = async (key) => {
    const target = fields.find(f => f.field_key === key && !f.is_placeholder);
    if (!target) return;
    const isGlobal = !!target.is_global;
    const msg = isGlobal
      ? `Delete global field "${key}"?\nIt will be removed from EVERY product in this project.`
      : `Delete field "${key}"?`;
    if (!confirm(msg)) return;
    const res = await fetch(`${API_BASE}/api/products/${productId}/custom-fields/${encodeURIComponent(key)}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) { showToast('Delete failed'); return; }
    const data = await res.json().catch(() => ({}));
    const removedRows = Array.isArray(data?.removed) ? data.removed : [];
    setProduct(p => ({ ...p, custom_fields: (p.custom_fields || []).filter(f => f.field_key !== key) }));
    registerUndo?.({
      description: isGlobal
        ? `Global field "${key}" deleted (${removedRows.length} product${removedRows.length === 1 ? '' : 's'})`
        : `Field "${key}" deleted`,
      undo: async () => {
        const r = await fetch(`${API_BASE}/api/products/${productId}/restore${pq}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'custom_fields', rows: removedRows }),
        });
        if (!r.ok) { showToast('Restore failed'); return; }
        // Other products' rows reappear on their own next reload.
        const ownRow = removedRows.find(rr => rr.product_id === productId);
        if (ownRow) {
          setProduct(p => ({
            ...p,
            custom_fields: [
              ...(p.custom_fields || []),
              { ...ownRow, is_placeholder: false },
            ],
          }));
        }
        showToast(isGlobal ? 'Field restored across all products' : 'Field restored');
      },
    });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 300, tolerance: 5 } }));
  const [ctxMenu, setCtxMenu] = useState(null);

  // Placeholders aren't owned here, so reorder only persists real rows.
  const persistOrder = async (newKeys) => {
    await fetch(`${API_BASE}/api/products/${productId}/custom-fields/reorder${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_keys: newKeys }),
    });
  };

  const onDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const realFields = fields.filter(f => !f.is_placeholder);
    const oldOrder = realFields.map(f => f.field_key);
    if (!oldOrder.includes(active.id) || !oldOrder.includes(over.id)) return;
    const oldIdx = oldOrder.indexOf(active.id);
    const newIdx = oldOrder.indexOf(over.id);
    const newOrder = arrayMove(oldOrder, oldIdx, newIdx);
    // Optimistic reorder so UI doesn't snap back.
    setProduct(p => {
      const placeholders = (p.custom_fields || []).filter(f => f.is_placeholder);
      const byKey = Object.fromEntries(realFields.map(f => [f.field_key, f]));
      return { ...p, custom_fields: [...newOrder.map(k => byKey[k]).filter(Boolean), ...placeholders] };
    });
    await persistOrder(newOrder);
    registerUndo?.({
      description: 'Custom fields reordered',
      undo: async () => {
        await persistOrder(oldOrder);
        setProduct(p => {
          const placeholders = (p.custom_fields || []).filter(f => f.is_placeholder);
          const byKey = Object.fromEntries(realFields.map(f => [f.field_key, f]));
          return { ...p, custom_fields: [...oldOrder.map(k => byKey[k]).filter(Boolean), ...placeholders] };
        });
      },
    });
  };

  const realFields = fields.filter(f => !f.is_placeholder);
  const placeholders = fields.filter(f => f.is_placeholder);
  const sortableIds = realFields.map(f => f.field_key);

  // ── Bulk-select wiring ────────────────────────────────────────────
  const SCOPE = 'cf';
  const inScope = bulk?.scope === SCOPE;
  const bulkIds = inScope ? bulk.ids : [];

  const bulkDelete = useCallback(async (keys) => {
    if (!keys.length) return;
    // Server's removed[] includes cascade rows for global keys.
    const allRemoved = [];
    for (const k of keys) {
      const r = await fetch(`${API_BASE}/api/products/${productId}/custom-fields/${encodeURIComponent(k)}${pq}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!r.ok) continue;
      const d = await r.json().catch(() => ({}));
      if (Array.isArray(d?.removed)) allRemoved.push(...d.removed);
    }
    setProduct(p => ({ ...p, custom_fields: (p.custom_fields || []).filter(f => !keys.includes(f.field_key)) }));
    clearBulk?.();
    showToast(`${keys.length} field${keys.length === 1 ? '' : 's'} deleted`);
    if (allRemoved.length && registerUndo) {
      registerUndo({
        description: `${keys.length} field${keys.length === 1 ? '' : 's'} deleted`,
        undo: async () => {
          await fetch(`${API_BASE}/api/products/${productId}/restore${pq}`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'custom_fields', rows: allRemoved }),
          });
          // Re-add own rows visually
          const own = allRemoved.filter(r => r.product_id === productId);
          setProduct(p => ({
            ...p,
            custom_fields: [...(p.custom_fields || []), ...own.map(r => ({ ...r, is_placeholder: false }))],
          }));
        },
      });
    }
  }, [productId, pq, setProduct, clearBulk, showToast, registerUndo]);

  const toggleInBulk = useCallback((fieldKey) => {
    setBulk(prev => {
      const list = prev.scope === SCOPE ? [...prev.ids] : [];
      const idx = list.indexOf(fieldKey);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(fieldKey);
      return list.length ? {
        scope: SCOPE, ids: list,
        actions: { delete: () => bulkDelete(list) },
      } : { scope: null, ids: [], actions: null };
    });
  }, [setBulk, bulkDelete]);

  const onRowClick = useCallback((e, fieldKey) => {
    if (!(e.shiftKey || e.metaKey || e.ctrlKey || inScope)) return false;
    e.stopPropagation();
    e.preventDefault();
    toggleInBulk(fieldKey);
    return true;
  }, [inScope, toggleInBulk]);

  const openCtxMenu = useCallback((e, fieldKey) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, id: fieldKey });
  }, []);

  return (
    <section className="po-block">
      <h2 className="po-block-title">Custom Fields</h2>
      <p className="po-block-hint">
        Free-form attributes returned by the storefront API. Set Global to Yes to make the key appear on every product in the project — each product still has its own value.
      </p>
      <div className="cfg-block-body">
        <div className="cfg-list">
          <div className={`cfg-list-head cf-list-head${inScope ? ' cfg-list-head--bulk-mode cf-list-head--bulk-mode' : ''}`}>
            {inScope && <span className="cfg-col cfg-col-bulk" />}
            <span className="cfg-col">Key</span>
            <span className="cfg-col">Value</span>
            <span className="cfg-col">Type</span>
            <span className="cfg-col">Global</span>
            <span className="cfg-col cfg-col-actions" />
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {realFields.map(f => (
                <SortableCfRow key={f.field_key} field={f}
                  onCreate={create} onUpdate={update} registerUndo={registerUndo}
                  onDelete={() => remove(f.field_key)}
                  onRowClick={onRowClick}
                  onContextMenu={(e) => openCtxMenu(e, f.field_key)}
                  bulkSelected={bulkIds.includes(f.field_key)}
                  bulkActive={inScope}
                  onBulkToggle={() => toggleInBulk(f.field_key)}
                  productId={productId} pq={pq} />
              ))}
            </SortableContext>
          </DndContext>
          {placeholders.map(f => (
            <CfRow key={f.field_key} field={f}
              onCreate={create} onUpdate={update} registerUndo={registerUndo}
              onDelete={() => remove(f.field_key)}
              bulkActive={inScope}
              productId={productId} pq={pq} />
          ))}
          <CfNewRow existingKeys={realKeys} onSave={create} bulkActive={inScope}
            productId={productId} pq={pq} />
        </div>
      </div>

      {ctxMenu && (
        <RowContextMenu pos={ctxMenu}
          onSelect={() => toggleInBulk(ctxMenu.id)}
          onClose={() => setCtxMenu(null)} />
      )}
    </section>
  );
}

function SortableCfRow(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.field.field_key });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: isDragging ? 'var(--card)' : undefined,
    boxShadow: isDragging ? 'var(--shadow-card)' : undefined,
    zIndex: isDragging ? 5 : 'auto',
    opacity: isDragging ? 0.92 : 1,
  };
  return (
    <CfRow {...props}
      dragRef={setNodeRef}
      dragStyle={style}
      dragHandleProps={{ ...attributes, ...listeners }} />
  );
}

function CfRow({ field, onCreate, onUpdate, onDelete, registerUndo,
                  dragRef, dragStyle, dragHandleProps, onRowClick, onContextMenu,
                  bulkSelected, bulkActive, onBulkToggle, productId, pq }) {
  const isPlaceholder = !!field.is_placeholder;
  const originalKeyRef = useRef(field.field_key);
  const [key,    setKey]    = useState(field.field_key);
  const [value,  setValue]  = useState(field.field_value ?? '');
  const [type,   setType]   = useState(field.field_type || 'string');
  const [global, setGlobal] = useState(!!field.is_global);
  const skip = useRef(true);
  // True after this row exists server-side; placeholders flip on first save.
  const persisted = useRef(!isPlaceholder);
  // Last-confirmed server state for the row's Undo.
  const prevServer = useRef({
    field_key:   field.field_key,
    field_value: field.field_value ?? '',
    field_type:  field.field_type || 'string',
    is_global:   !!field.is_global,
  });

  useEffect(() => {
    skip.current = true;
    originalKeyRef.current = field.field_key;
    setKey(field.field_key);
    setValue(field.field_value ?? '');
    setType(field.field_type || 'string');
    setGlobal(!!field.is_global);
    persisted.current = !field.is_placeholder;
    prevServer.current = {
      field_key:   field.field_key,
      field_value: field.field_value ?? '',
      field_type:  field.field_type || 'string',
      is_global:   !!field.is_global,
    };
  }, [field.field_key, field.field_value, field.field_type, field.is_global, field.is_placeholder]);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const trimmed = key.trim();
    if (!trimmed) return;
    if (!persisted.current && value === '' && type === (field.field_type || 'string') && global === !!field.is_global) return;
    const t = setTimeout(async () => {
      const body = { field_key: trimmed, field_value: value, field_type: type, is_global: global };
      if (!persisted.current) {
        const ok = await onCreate(body);
        if (ok) {
          persisted.current = true;
          originalKeyRef.current = trimmed;
          prevServer.current = { ...body };
        }
      } else {
        const before = { ...prevServer.current };
        const ok = await onUpdate(originalKeyRef.current, body);
        if (ok) {
          originalKeyRef.current = trimmed;
          prevServer.current = { ...body };
          registerUndo?.({
            description: `Field "${before.field_key}" changed`,
            silent: true,
            undo: async () => { await onUpdate(trimmed, before); },
          });
        } else if (trimmed !== originalKeyRef.current) {
          skip.current = true;
          setKey(originalKeyRef.current);
        }
      }
    }, 500);
    return () => clearTimeout(t);
  }, [key, value, type, global]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeType = (t) => {
    setType(t);
    setValue(v => normalizeForType(v, t));
  };

  const keyEmpty = !key.trim();
  // Placeholders skip drag listeners (no real row server-side).
  const grabProps = isPlaceholder ? {} : (dragHandleProps || {});
  const showCheckbox = bulkActive && !isPlaceholder;

  return (
    <div ref={dragRef} style={dragStyle}
      onClick={(e) => onRowClick?.(e, field.field_key)}
      onContextMenu={isPlaceholder ? undefined : onContextMenu}
      className={`cfg-row cf-row${!isPlaceholder ? ' cfg-row--grabbable' : ''}${type === 'json' ? ' cf-row--json' : ''}${isPlaceholder ? ' cf-row--placeholder' : ''}${bulkSelected ? ' cfg-row--bulk' : ''}${bulkActive ? ' cfg-row--bulk-mode cf-row--bulk-mode' : ''}`}
      title={isPlaceholder ? undefined : 'Right-click for actions · hold 0.3s to drag'}
      {...grabProps}>
      {bulkActive && (showCheckbox ? (
        <input type="checkbox" className="cat-prod-checkbox cfg-bulk-check"
          checked={!!bulkSelected}
          onChange={() => onBulkToggle?.()}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          aria-label="Toggle selection" />
      ) : <span className="cfg-col cfg-col-bulk" />)}
      <input className={`crm-input cfg-cell${keyEmpty ? ' cfg-cell--invalid' : ''}`} value={key} readOnly={isPlaceholder}
        onChange={e => setKey(e.target.value)} placeholder="field_key *"
        title={keyEmpty ? 'Field key is required' : undefined} />
      <CfValueInput type={type} value={value} onChange={setValue} productId={productId} pq={pq} />
      <CfCombobox value={type} options={CF_TYPE_OPTIONS} onChange={changeType} />
      <CfCombobox value={global ? 'yes' : 'no'} options={CF_GLOBAL_OPTIONS}
        onChange={(v) => setGlobal(v === 'yes')} />
      {persisted.current ? (
        <button type="button" className="cfg-col-actions cfg-delete-btn"
          onClick={onDelete} title="Delete field">
          <Trash />
        </button>
      ) : <span className="cfg-col-actions" />}
    </div>
  );
}

// Coerce stored value to match the new type.
function normalizeForType(value, type) {
  const v = value ?? '';
  if (type === 'boolean')  return v === 'true' || v === 'false' ? v : 'false';
  if (type === 'number')   return /^-?\d*\.?\d*$/.test(v) ? v : '';
  if (type === 'datetime') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v : '';
  if (type === 'file')     return /^https?:\/\//.test(v) ? v : '';
  return v;
}

function CfNewRow({ existingKeys, onSave, bulkActive, productId, pq }) {
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [type, setType] = useState('string');
  const [global, setGlobal] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    const trimmed = key.trim();
    if (!trimmed || busyRef.current) return;
    if (existingKeys.includes(trimmed)) return;
    const t = setTimeout(async () => {
      busyRef.current = true;
      const ok = await onSave({
        field_key: trimmed, field_value: val, field_type: type, is_global: global,
      });
      busyRef.current = false;
      if (ok) {
        setKey(''); setVal(''); setType('string'); setGlobal(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [key, val, type, global]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeType = (t) => { setType(t); setVal(v => normalizeForType(v, t)); };

  return (
    <div className={`cfg-row cfg-row--new cf-row${type === 'json' ? ' cf-row--json' : ''}${bulkActive ? ' cfg-row--bulk-mode cf-row--bulk-mode' : ''}`}>
      {bulkActive && <span className="cfg-col cfg-col-bulk" />}
      <input className="crm-input cfg-cell" value={key}
        onChange={e => setKey(e.target.value)} placeholder="field_key" />
      <CfValueInput type={type} value={val} onChange={setVal} productId={productId} pq={pq} />
      <CfCombobox value={type} options={CF_TYPE_OPTIONS} onChange={changeType} />
      <CfCombobox value={global ? 'yes' : 'no'} options={CF_GLOBAL_OPTIONS}
        onChange={(v) => setGlobal(v === 'yes')} />
      <span className="cfg-col-actions" />
    </div>
  );
}

// Type-aware value editor.
function CfValueInput({ type, value, onChange, productId, pq }) {
  if (type === 'boolean') {
    const v = value === 'true' ? 'true' : value === 'false' ? 'false' : '';
    return (
      <CfCombobox
        value={v || 'false'}
        options={[
          { value: 'true',  label: 'Yes' },
          { value: 'false', label: 'No'  },
        ]}
        onChange={onChange} />
    );
  }
  if (type === 'number') {
    return (
      <input className="crm-input cfg-cell" value={value}
        inputMode="decimal"
        onChange={e => {
          const v = e.target.value;
          if (v === '' || /^-?\d*\.?\d*$/.test(v)) onChange(v);
        }}
        placeholder="0" />
    );
  }
  if (type === 'datetime') {
    return (
      <input className="crm-input cfg-cell" type="datetime-local" value={value}
        onChange={e => onChange(e.target.value)} />
    );
  }
  if (type === 'file') {
    return <CfFileInput value={value} onChange={onChange} productId={productId} pq={pq} />;
  }
  if (type === 'json') {
    return <CfJsonInput value={value} onChange={onChange} />;
  }
  return (
    <input className="crm-input cfg-cell" value={value}
      onChange={e => onChange(e.target.value)} placeholder="value" />
  );
}

// File-upload value editor: drop/click → POST /api/upload/file → store URL as field_value.
function CfFileInput({ value, onChange, productId, pq }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const fileName = value ? decodeURIComponent(value.split('/').pop().replace(/^[a-f0-9]{24}_/, '')) : '';

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/upload/file${pq}`, { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json();
      if (res.ok && data.url) onChange(data.url);
    } catch {}
    setBusy(false);
  };

  return (
    <div className="cf-file-input">
      <input ref={inputRef} type="file" className="hidden-input"
        onChange={e => upload(e.target.files?.[0])} />
      {value ? (
        <>
          <a href={value} target="_blank" rel="noreferrer" className="cf-file-link"
            title={value} onClick={e => e.stopPropagation()}>
            {fileName || 'Download'}
          </a>
          <button type="button" className="cf-file-replace"
            onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Uploading…' : 'Replace'}
          </button>
        </>
      ) : (
        <button type="button" className="cf-file-empty"
          onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Uploading…' : 'Upload file'}
        </button>
      )}
    </div>
  );
}

// CodeMirror 6 JSON editor with Format + Expand-to-modal toolbar.
const CF_JSON_EXTENSIONS = [cmJson()];

function CfJsonInput({ value, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const valid = useMemo(() => {
    if (!value || !value.trim()) return true;
    try { JSON.parse(value); return true; } catch { return false; }
  }, [value]);

  const format = useCallback(() => {
    if (!value || !value.trim()) return;
    try {
      const formatted = JSON.stringify(JSON.parse(value), null, 2);
      onChange(formatted);
    } catch {
      // Invalid JSON — no-op (red border already flags it).
    }
  }, [value, onChange]);

  return (
    <div className={`cf-json-wrap${valid ? '' : ' cf-json-wrap--invalid'}`}>
      <div className="cf-json-toolbar" onClick={e => e.stopPropagation()}>
        <span className={`cf-json-status${valid ? '' : ' cf-json-status--invalid'}`}>
          {value && value.trim() ? (valid ? 'Valid JSON' : 'Invalid JSON') : 'Empty'}
        </span>
        <div className="cf-json-toolbar-spacer" />
        <button type="button" className="cf-json-tool-btn"
          onClick={format}
          disabled={!valid || !value.trim()}
          title={valid ? 'Format / Prettify' : 'Cannot format invalid JSON'}>
          <MagicWand weight="bold" /> Format
        </button>
        <button type="button" className="cf-json-tool-btn"
          onClick={() => setExpanded(true)}
          title="Open in modal editor">
          <ArrowsOut weight="bold" /> Expand
        </button>
      </div>
      <CodeMirror
        value={value || ''}
        onChange={onChange}
        extensions={CF_JSON_EXTENSIONS}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          searchKeyMap: false,
        }}
        placeholder='{"key": "value"}'
        minHeight="60px"
        maxHeight="240px"
        className="cf-json-cm"
      />
      {expanded && createPortal(
        <CfJsonModal value={value || ''} onChange={onChange} onClose={() => setExpanded(false)} />,
        document.body
      )}
    </div>
  );
}

function CfJsonModal({ value, onChange, onClose }) {
  // Local draft so Cancel discards; Save commits via parent onChange.
  const [draft, setDraft] = useState(value);
  const valid = useMemo(() => {
    if (!draft || !draft.trim()) return true;
    try { JSON.parse(draft); return true; } catch { return false; }
  }, [draft]);

  const format = () => {
    if (!draft || !draft.trim()) return;
    try { setDraft(JSON.stringify(JSON.parse(draft), null, 2)); } catch {}
  };
  const save = () => { onChange(draft); onClose(); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="cf-json-modal-backdrop" onClick={onClose}>
      <div className="cf-json-modal" onClick={e => e.stopPropagation()}>
        <div className="cf-json-modal-head">
          <h3 className="cf-json-modal-title">Edit JSON</h3>
          <span className={`cf-json-status${valid ? '' : ' cf-json-status--invalid'}`}>
            {draft && draft.trim() ? (valid ? 'Valid JSON' : 'Invalid JSON') : 'Empty'}
          </span>
          <div className="cf-json-toolbar-spacer" />
          <button type="button" className="cf-json-tool-btn"
            onClick={format} disabled={!valid || !draft.trim()}>
            <MagicWand weight="bold" /> Format
          </button>
          <button type="button" className="cf-json-modal-close" onClick={onClose} aria-label="Close">
            <X weight="bold" />
          </button>
        </div>
        <div className="cf-json-modal-body">
          <CodeMirror
            value={draft}
            onChange={setDraft}
            extensions={CF_JSON_EXTENSIONS}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: true,
              autocompletion: false,
            }}
            placeholder='{"key": "value"}'
            height="100%"
            className="cf-json-cm cf-json-cm--modal"
          />
        </div>
        <div className="cf-json-modal-foot">
          <button type="button" className="crm-submit-btn auth-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="crm-submit-btn" onClick={save} disabled={!valid}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// In-row pill-trigger + portal panel combobox (Category-style).
// `size`: 'sm' (default, compact for cfg-row cells) | 'md' (full-width like CpmCategorySelect).
function CfCombobox({ value, options, onChange, size = 'sm' }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [hovered, setHovered] = useState(null);

  const activeKey = `v:${value}`;
  const current = hovered ?? activeKey;
  const { indRef, setItemRef } = DynamicBlock(current, open);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const margin = 12;
    const width = Math.max(r.width, 140);
    const maxLeft = window.innerWidth - width - margin;
    const left = Math.max(margin, Math.min(r.left, maxLeft));
    setPos({ top: r.bottom + 6, left, width });
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPd  = e => {
      if (!e.target.closest?.('.cpm-cat-dropdown') && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <>
      <button ref={btnRef} type="button"
        className={`cpm-cat-btn${size === 'sm' ? ' cf-cb-btn' : ''}${open ? ' cpm-cat-btn--open' : ''}`}
        onClick={() => setOpen(v => !v)}>
        <span>{selected?.label ?? value}</span>
        <CaretDown weight="bold" className={`cpm-cat-caret${open ? ' cpm-cat-caret--up' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div className="cat-filter-dropdown cpm-cat-dropdown"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onMouseLeave={() => setHovered(null)}>
          <div ref={indRef} className="cat-filter-indicator" />
          {options.map(o => {
            const k = `v:${o.value}`;
            return (
              <button key={o.value} ref={setItemRef(k)} type="button"
                className={`cat-filter-item${current === k ? ' cat-filter-item--current' : ''}`}
                onMouseEnter={() => setHovered(k)}
                onClick={() => { onChange(o.value); setOpen(false); }}>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}


// ─── Service details (type=service) ──────────────────────────────
// Inline editor that hits PUT /api/booking/services/{id} so service products
// can be fully managed from the Product page (no need to jump to Bookings).
function ServiceDetailsBlock({ product, pq, registerUndo, showToast }) {
  const [svc, setSvc] = useState(null);     // linked booking_services row
  const [staff, setStaff] = useState([]);   // all staff in project (for picker)
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  // Fetch the linked booking_service + project staff list.
  useEffect(() => {
    fetch(`${API_BASE}/api/booking/services${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(list => setSvc((list || []).find(s => s.product_id === product.id) || null))
      .catch(() => {});
    fetch(`${API_BASE}/api/booking/staff${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setStaff(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [product.id, pq]);

  // Local-state mirror so each field is responsive to typing.
  const [duration, setDuration] = useState('30');
  const [price,    setPrice]    = useState('0');
  const [capacity, setCapacity] = useState('1');
  const [reqStaff, setReqStaff] = useState(false);
  const [active,   setActive]   = useState(true);
  const [staffIds, setStaffIds] = useState([]);
  const [imageUrl, setImageUrl] = useState('');

  useEffect(() => {
    if (!svc) return;
    setDuration(String(svc.duration_minutes || 30));
    setPrice(String(svc.price ?? 0));
    setCapacity(String(svc.capacity || 1));
    setReqStaff(!!svc.requires_staff);
    setActive(svc.is_active !== false);
    setStaffIds(svc.staff_ids || []);
    setImageUrl(svc.image_url || '');
  }, [svc?.id]);

  // Single PUT helper (booking_services.PUT requires the full row).
  const save = useCallback(async (overrides = {}) => {
    if (!svc) return false;
    const body = {
      name: product.title || svc.name || '',
      description: product.description || '',
      duration_minutes: parseInt(duration, 10) || 30,
      price: parseFloat(price) || 0,
      image_url: imageUrl || null,
      is_active: active,
      requires_staff: reqStaff,
      capacity: parseInt(capacity, 10) || 1,
      staff_ids: staffIds,
      ...overrides,
    };
    const res = await fetch(`${API_BASE}/api/booking/services/${svc.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setSvc(s => s ? { ...s, ...body } : s);
      showToast?.('Service saved');
    } else {
      showToast?.('Save failed');
    }
    return res.ok;
  }, [svc, product, duration, price, capacity, active, reqStaff, staffIds, imageUrl, pq, showToast]);

  // Debounced save when local fields change (skip first render after svc loads).
  const skip = useRef(true);
  useEffect(() => {
    if (!svc) return;
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(() => save(), 500);
    return () => clearTimeout(t);
  }, [duration, price, capacity, active, reqStaff, staffIds, imageUrl]); // eslint-disable-line

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/upload/image${pq}`, {
        method: 'POST', credentials: 'include', body: fd,
      });
      const data = await res.json();
      if (res.ok && data.url) setImageUrl(data.url);
      else showToast?.('Upload failed');
    } finally { setUploading(false); }
  };

  const toggleStaff = (id) => {
    setStaffIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  if (!svc) return (
    <section className="po-block po-service-link">
      <div className="po-service-link-icon">⏱</div>
      <div className="po-service-link-body">
        <h2 className="po-block-title">Service details</h2>
        <p className="po-block-hint">Linking this product to a booking service…</p>
      </div>
    </section>
  );

  return (
    <section className="po-block">
      <h2 className="po-block-title">Service details</h2>
      <p className="po-block-hint">
        How customers book this service — duration, price, image, staff. Editing here mirrors Bookings → Services.
      </p>

      <div className="po-form">
        <div className="po-svc-grid">
          <Field label="Duration (minutes)">
            <input className="crm-input po-input" type="number" min="5" max="1440"
              value={duration} onChange={e => setDuration(e.target.value)} />
          </Field>
          <Field label="Price">
            <input className="crm-input po-input" type="number" min="0" step="0.01"
              value={price} onChange={e => setPrice(e.target.value)} />
          </Field>
        </div>

        <div className="po-field" style={{ marginTop: 12 }}>
          <label className="po-field-label1">Image (optional)</label>
          <input ref={fileRef} type="file" accept="image/*" className="hidden-input"
            onChange={e => upload(e.target.files?.[0])} />
          {imageUrl ? (
            <div className="bk-svc-img-preview">
              <img src={imageUrl} alt="" />
              <div className="bk-svc-img-actions">
                <button type="button" className="crm-submit-btn auth-btn-secondary"
                  onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Replace'}
                </button>
                <button type="button" className="auth-btn-danger"
                  onClick={() => setImageUrl('')}>Remove</button>
              </div>
            </div>
          ) : (
            <button type="button" className="bk-svc-img-drop"
              onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Click to upload an image'}
            </button>
          )}
        </div>

        <div className="auth-sep" />

        <div className="auth-toggle-row">
          <div>
            <span className="auth-toggle-label">Visible to customers</span>
            <p className="auth-field-hint">Hidden services don't appear in the storefront.</p>
          </div>
          <label className="auth-toggle">
            <input type="checkbox" checked={active}
              onChange={e => setActive(e.target.checked)} />
            <span className="auth-toggle-track" />
          </label>
        </div>

        <div className="auth-toggle-row">
          <div>
            <span className="auth-toggle-label">Requires staff selection</span>
            <p className="auth-field-hint">
              When ON, customers must pick a specific staff member (each slot = one person at a time).<br />
              When OFF, slots use the <b>capacity</b> below — useful for group classes / shared resources.
            </p>
          </div>
          <label className="auth-toggle">
            <input type="checkbox" checked={reqStaff}
              onChange={e => setReqStaff(e.target.checked)} />
            <span className="auth-toggle-track" />
          </label>
        </div>

        {!reqStaff && (
          <div className="po-field" style={{ marginTop: 12 }}>
            <label className="po-field-label1">Capacity per slot</label>
            <p className="po-block-hint" style={{ marginTop: 0, marginBottom: 8 }}>
              How many simultaneous bookings fit into one slot (1 = exclusive).
            </p>
            <input className="crm-input po-input" type="number" min="1"
              value={capacity} onChange={e => setCapacity(e.target.value)} />
          </div>
        )}
      </div>

      {staff.length > 0 && (
        <div className="po-svc-staff">
          <label className="po-field-label1">Staff that can deliver this service</label>
          <p className="po-block-hint" style={{ marginTop: 0, marginBottom: 8 }}>
            {reqStaff
              ? 'Customers will pick one of these.'
              : 'Optional reference list (informational when capacity-based).'}
          </p>
          <div className="po-svc-staff-row">
            {staff.map(s => {
              const on = staffIds.includes(s.id);
              return (
                <button key={s.id} type="button"
                  className={`po-svc-staff-chip${on ? ' po-svc-staff-chip--on' : ''}`}
                  onClick={() => toggleStaff(s.id)}>
                  {s.avatar_url
                    ? <img src={s.avatar_url} alt="" className="po-svc-staff-avatar" />
                    : <span className="po-svc-staff-avatar po-svc-staff-avatar--empty">
                        {(s.name || '?')[0]}
                      </span>}
                  <span>{s.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Event details (type=event) ──────────────────────────────────
// Stores values in product_custom_fields under reserved keys so they're
// part of the same data layer as everything else; the dedicated UI just
// surfaces them as first-class form fields with a date-picker etc.
const EVENT_RESERVED_KEYS = new Set(['event_start_at', 'event_end_at', 'venue', 'venue_address']);

function EventDetailsBlock({ product, productId, pq, setProduct, showToast }) {
  const fields = product.custom_fields || [];
  const findVal = (key) => (fields.find(f => f.field_key === key && !f.is_placeholder)?.field_value) || '';

  const [start, setStart] = useState(() => findVal('event_start_at'));
  const [end,   setEnd]   = useState(() => findVal('event_end_at'));
  const [venue,   setVenue]   = useState(() => findVal('venue'));
  const [address, setAddress] = useState(() => findVal('venue_address'));
  const skip = useRef(true);

  // Re-sync when the product reloads (Undo, etc.).
  useEffect(() => {
    skip.current = true;
    setStart(findVal('event_start_at'));
    setEnd(findVal('event_end_at'));
    setVenue(findVal('venue'));
    setAddress(findVal('venue_address'));
  }, [product.id, JSON.stringify(fields)]); // eslint-disable-line

  const upsert = useCallback(async (key, value, fieldType) => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/custom-fields${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_key: key, field_value: value, field_type: fieldType, is_global: false }),
    });
    if (!res.ok) { showToast?.('Save failed'); return false; }
    setProduct(p => {
      const next = [...(p.custom_fields || [])];
      const idx = next.findIndex(f => f.field_key === key && !f.is_placeholder);
      const row = { field_key: key, field_value: value, field_type: fieldType, is_global: false, is_placeholder: false };
      if (idx >= 0) next[idx] = { ...next[idx], ...row };
      else next.push(row);
      return { ...p, custom_fields: next };
    });
    return true;
  }, [productId, pq, setProduct, showToast]);

  // Debounced save per field.
  useEffect(() => { if (skip.current) return;
    const t = setTimeout(() => upsert('event_start_at', start, 'datetime'), 500);
    return () => clearTimeout(t);
  }, [start]); // eslint-disable-line
  useEffect(() => { if (skip.current) return;
    const t = setTimeout(() => upsert('event_end_at', end, 'datetime'), 500);
    return () => clearTimeout(t);
  }, [end]); // eslint-disable-line
  useEffect(() => { if (skip.current) return;
    const t = setTimeout(() => upsert('venue', venue, 'string'), 500);
    return () => clearTimeout(t);
  }, [venue]); // eslint-disable-line
  useEffect(() => { if (skip.current) return;
    const t = setTimeout(() => upsert('venue_address', address, 'string'), 500);
    return () => clearTimeout(t);
  }, [address]); // eslint-disable-line
  useEffect(() => { skip.current = false; }, []);

  return (
    <section className="po-block">
      <h2 className="po-block-title">Event details</h2>
      <p className="po-block-hint">
        When and where the event happens. Used by the storefront to render the event header
        and by the QR ticket sent in the order confirmation email.
      </p>
      <div className="po-form po-svc-grid">
        <Field label="Start" required={!start.trim()}>
          <input className="crm-input po-input" type="datetime-local" value={start}
            onChange={e => setStart(e.target.value)} />
        </Field>
        <Field label="End">
          <input className="crm-input po-input" type="datetime-local" value={end}
            onChange={e => setEnd(e.target.value)} />
        </Field>
        <Field label="Venue">
          <input className="crm-input po-input" value={venue} maxLength={200}
            onChange={e => setVenue(e.target.value)} placeholder="Almaty Arena" />
        </Field>
        <Field label="Address">
          <input className="crm-input po-input" value={address} maxLength={300}
            onChange={e => setAddress(e.target.value)} placeholder="Khusainova 1" />
        </Field>
      </div>
    </section>
  );
}

// ─── Digital files (type=digital) ────────────────────────────────
// Direct upload UI for digital products. Each file becomes a Custom Field of
// type=file with `field_key = file_<n>`. Customers see download links in
// their order confirmation email (via the digital_html block in External).
function DigitalFilesBlock({ product, productId, pq, setProduct, showToast }) {
  const inputRef = useRef(null);
  const fileFields = (product.custom_fields || [])
    .filter(f => !f.is_placeholder && f.field_type === 'file' && f.field_value);

  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const upRes = await fetch(`${API_BASE}/api/upload/file${pq}`, {
      method: 'POST', credentials: 'include', body: fd,
    });
    const upData = await upRes.json();
    if (!upRes.ok || !upData.url) { showToast?.('Upload failed'); return; }
    // Pick a unique file_<n> key.
    const taken = new Set(fileFields.map(f => f.field_key));
    let n = 1;
    while (taken.has(`file_${n}`)) n++;
    const key = `file_${n}`;
    const cfRes = await fetch(`${API_BASE}/api/products/${productId}/custom-fields${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_key: key, field_value: upData.url, field_type: 'file', is_global: false }),
    });
    if (!cfRes.ok) { showToast?.('Save failed'); return; }
    setProduct(p => ({ ...p,
      custom_fields: [...(p.custom_fields || []),
        { field_key: key, field_value: upData.url, field_type: 'file', is_global: false, is_placeholder: false }],
    }));
    showToast?.('File added');
  };

  const remove = async (key) => {
    if (!confirm(`Remove "${key}"?`)) return;
    const res = await fetch(`${API_BASE}/api/products/${productId}/custom-fields/${encodeURIComponent(key)}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) return;
    setProduct(p => ({ ...p, custom_fields: (p.custom_fields || []).filter(f => f.field_key !== key) }));
  };

  return (
    <section className="po-block">
      <h2 className="po-block-title">Files</h2>
      <p className="po-block-hint">
        Files customers receive after purchase. URLs are signed and emailed automatically when the order is paid.
      </p>
      <div className="po-files-list">
        {fileFields.length === 0 && (
          <p className="po-files-empty">No files yet. Add the digital product (PDF, image, archive…) below.</p>
        )}
        {fileFields.map(f => {
          const fname = decodeURIComponent(f.field_value.split('/').pop().replace(/^[a-f0-9]{24}_/, ''));
          return (
            <div key={f.field_key} className="po-files-row">
              <span className="po-files-icon">📄</span>
              <a className="po-files-link" href={f.field_value} target="_blank" rel="noreferrer" title={f.field_value}>
                {fname || f.field_key}
              </a>
              <button type="button" className="po-files-remove" onClick={() => remove(f.field_key)}>
                <Trash />
              </button>
            </div>
          );
        })}
      </div>
      <input ref={inputRef} type="file" className="hidden-input"
        onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
      <button type="button" className="po-add-pill po-files-add"
        onClick={() => inputRef.current?.click()}>
        <Plus weight="bold" /> Upload file
      </button>
    </section>
  );
}

// ─── Modifiers (type=physical) ────────────────────────────────────
// Two-level structure: groups (checkbox or radio) → items (name + price_delta).
// DnD: groups reorder vertically; items reorder within group AND cross-group via
// shared DndContext + per-group SortableContext (multi-container pattern).
function ModifiersBlock({ product, productId, pq, reloadProduct, registerUndo }) {
  const groups = product.modifier_groups || [];

  // ─── Group CRUD ───────────────────────────────────────────────────
  const createGroup = async () => {
    const r = await fetch(`${API_BASE}/api/products/${productId}/modifier-groups${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', control_type: 'checkbox' }),
    });
    if (r.ok) reloadProduct?.();
  };

  const updateGroup = async (gid, body) => {
    const r = await fetch(`${API_BASE}/api/products/${productId}/modifier-groups/${gid}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) reloadProduct?.();
    return r.ok;
  };

  const deleteGroup = async (gid) => {
    if (!confirm('Delete this group and all its items?')) return;
    const r = await fetch(`${API_BASE}/api/products/${productId}/modifier-groups/${gid}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (r.ok) reloadProduct?.();
  };

  const reorderGroups = async (newOrder) => {
    await fetch(`${API_BASE}/api/products/${productId}/modifier-groups/reorder${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: newOrder.map(g => g.id) }),
    });
    reloadProduct?.();
  };

  // ─── Item CRUD ────────────────────────────────────────────────────
  const createItem = async (gid) => {
    const r = await fetch(`${API_BASE}/api/products/${productId}/modifier-groups/${gid}/items${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', price_delta: 0 }),
    });
    if (r.ok) reloadProduct?.();
  };

  const updateItem = async (iid, body) => {
    const r = await fetch(`${API_BASE}/api/products/${productId}/modifier-items/${iid}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) reloadProduct?.();
    return r.ok;
  };

  const deleteItem = async (iid) => {
    const r = await fetch(`${API_BASE}/api/products/${productId}/modifier-items/${iid}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (r.ok) reloadProduct?.();
  };

  // ─── DnD: cross-group items + within-group sort + group sort ──────
  // Long-press (300 ms) activation — same pattern as Configuration Layers.
  // No visible drag handle: press-and-hold anywhere on the row starts drag,
  // tap-and-release goes through to the underlying input/button as normal.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 300, tolerance: 5 } }));

  const onDragEnd = async ({ active, over }) => {
    if (!over) return;
    const a = String(active.id); const o = String(over.id);
    if (a === o) return;

    // Group-level drag handles use prefix "group:".
    if (a.startsWith('group:') && o.startsWith('group:')) {
      const oldIdx = groups.findIndex(g => `group:${g.id}` === a);
      const newIdx = groups.findIndex(g => `group:${g.id}` === o);
      if (oldIdx < 0 || newIdx < 0) return;
      reorderGroups(arrayMove(groups, oldIdx, newIdx));
      return;
    }

    // Item drag — id is the item id (number-as-string).
    const findItem = (id) => {
      for (const g of groups) {
        const it = (g.items || []).find(x => String(x.id) === id);
        if (it) return { group: g, item: it };
      }
      return null;
    };
    const src = findItem(a);
    if (!src) return;

    // Drop target: either another item id, or a group's drop-zone id "drop:GROUP_ID"
    let targetGroupId, targetIndex;
    if (o.startsWith('drop:')) {
      targetGroupId = parseInt(o.slice(5), 10);
      const tg = groups.find(g => g.id === targetGroupId);
      targetIndex = (tg?.items || []).length; // append
    } else {
      const dst = findItem(o);
      if (!dst) return;
      targetGroupId = dst.group.id;
      targetIndex = (dst.group.items || []).findIndex(x => String(x.id) === o);
    }

    // Build the full update payload — all items of all groups, with their final positions.
    const next = groups.map(g => ({ ...g, items: [...(g.items || [])] }));
    const srcG = next.find(g => g.id === src.group.id);
    const dstG = next.find(g => g.id === targetGroupId);
    if (!srcG || !dstG) return;
    const srcIdx = srcG.items.findIndex(x => x.id === src.item.id);
    if (srcIdx < 0) return;
    const [moved] = srcG.items.splice(srcIdx, 1);
    // Adjust target index if dragging within the same group and removed from above.
    if (srcG.id === dstG.id && srcIdx < targetIndex) targetIndex -= 1;
    dstG.items.splice(targetIndex, 0, moved);

    const payload = [];
    for (const g of next) {
      g.items.forEach((it, i) => payload.push({ id: it.id, group_id: g.id, position: i }));
    }
    await fetch(`${API_BASE}/api/products/${productId}/modifier-items/reorder${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload }),
    });
    reloadProduct?.();
  };

  return (
    <section className="po-block">
      <h2 className="po-block-title">Modifiers</h2>
      <p className="po-block-hint">
        Group add-ons by category. Each group is either Checkbox (multi-select) or Radio (single-select),
        with optional min / max selection and required flag. Drag items between groups, drag whole groups to reorder.
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={groups.map(g => `group:${g.id}`)} strategy={verticalListSortingStrategy}>
          <div className="po-mod-groups">
            {groups.map(g => (
              <ModifierGroupCard key={g.id} group={g}
                onChange={updateGroup}
                onDelete={() => deleteGroup(g.id)}
                onAddItem={() => createItem(g.id)}
                onItemChange={updateItem}
                onItemDelete={deleteItem}
                registerUndo={registerUndo} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <button type="button" className="po-mod-add-group" onClick={createGroup}>
        <Plus weight="bold" /> Add group
      </button>
    </section>
  );
}

function ModifierGroupCard({ group, onChange, onDelete, onAddItem, onItemChange, onItemDelete, registerUndo }) {
  const sortable = useSortable({ id: `group:${group.id}` });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Local controlled state for the group header so typing feels native.
  const [name,       setName]       = useState(group.name || '');
  const [ctrl,       setCtrl]       = useState(group.control_type || 'checkbox');
  const [minSel,     setMinSel]     = useState(String(group.min_select ?? 0));
  const [maxSel,     setMaxSel]     = useState(group.max_select == null ? '' : String(group.max_select));
  const [required,   setRequired]   = useState(!!group.is_required);
  const [defItem,    setDefItem]    = useState(group.default_item_id ?? '');
  const skip = useRef(true);

  // Re-sync when the underlying group data changes from elsewhere (e.g. reorder reload).
  useEffect(() => {
    skip.current = true;
    setName(group.name || '');
    setCtrl(group.control_type || 'checkbox');
    setMinSel(String(group.min_select ?? 0));
    setMaxSel(group.max_select == null ? '' : String(group.max_select));
    setRequired(!!group.is_required);
    setDefItem(group.default_item_id ?? '');
  }, [group.id, group.name, group.control_type, group.min_select, group.max_select, group.is_required, group.default_item_id]);

  // Debounced save — same pattern as Layer1Card / SpecRow.
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(async () => {
      const body = {
        name,
        control_type: ctrl,
        min_select: parseInt(minSel, 10) || 0,
        max_select: maxSel === '' ? null : (parseInt(maxSel, 10) || 0),
        is_required: required,
        // default_item_id is sent only when control_type=radio, otherwise cleared.
        default_item_id: ctrl === 'radio' && defItem !== '' ? Number(defItem) : null,
      };
      await onChange(group.id, body);
    }, 500);
    return () => clearTimeout(t);
  }, [name, ctrl, minSel, maxSel, required, defItem]); // eslint-disable-line

  // Items live in their own SortableContext (per group) — but inside the same
  // DndContext (parent), so cross-group drag sees them.
  const items = group.items || [];
  const dropZoneId = `drop:${group.id}`;
  const dropSortable = useSortable({ id: dropZoneId });

  // Sliding indicator that follows the active control_type segment (Orders-toolbar pattern).
  const ctrlIndRef = useRef(null);
  const ctrlBtnRefs = useRef({});
  const [ctrlHovered, setCtrlHovered] = useState(null);
  const ctrlCurrent = ctrlHovered ?? ctrl;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = ctrlIndRef.current;
      const el  = ctrlBtnRefs.current[ctrlCurrent];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [ctrlCurrent, ctrl]);

  // Stop drag activation on interactive children — without this, holding down
  // on an input or button for 300 ms would start a group reorder drag instead
  // of focusing the input. Single-tap still works because PointerSensor needs
  // the press to last 300 ms before activating.
  const stopDrag = { onPointerDown: (e) => e.stopPropagation() };

  return (
    <div ref={setNodeRef} style={style} className="po-mod-group">
      {/* Whole head row is the drag handle — long-press anywhere starts drag. */}
      <div className="po-mod-group-head" {...attributes} {...listeners}>
        {/* Group name — search-style pill (mirrors org-search-wrap from Orders toolbar). */}
        <div className="po-mod-name-wrap">
          <input
            className="po-mod-name-input"
            value={name}
            placeholder="Group name (e.g. Sauces)"
            onChange={e => setName(e.target.value)}
            {...stopDrag}
          />
        </div>

        {/* Control type — segmented toggle pill (mirrors OrdSortToggle). */}
        <div className="po-mod-ctrl-toggle" onMouseLeave={() => setCtrlHovered(null)} {...stopDrag}>
          <div ref={ctrlIndRef} className="po-mod-ctrl-indicator" />
          {[
            { val: 'checkbox', label: 'Checkbox' },
            { val: 'radio',    label: 'Radio'    },
          ].map(({ val, label }) => (
            <button
              key={val}
              ref={el => (ctrlBtnRefs.current[val] = el)}
              type="button"
              className={`po-mod-ctrl-btn${ctrl === val ? ' po-mod-ctrl-btn--current' : ''}`}
              onClick={() => setCtrl(val)}
              onMouseEnter={() => setCtrlHovered(val)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Min / Max — single grouped pill with two number inputs. */}
        <div className="po-mod-num-group" {...stopDrag}>
          <span className="po-mod-num-label">Min</span>
          <input
            className="po-mod-num-input" type="number" min="0"
            value={minSel} onChange={e => setMinSel(e.target.value)}
          />
          <span className="po-mod-num-divider" />
          <span className="po-mod-num-label">Max</span>
          <input
            className="po-mod-num-input" type="number" min="0"
            value={maxSel} placeholder={ctrl === 'radio' ? '1' : '∞'}
            onChange={e => setMaxSel(e.target.value)}
          />
        </div>

        {/* Required — toggle pill (lights up with --accent when active). */}
        <button
          type="button"
          className={`po-mod-required-btn${required ? ' po-mod-required-btn--on' : ''}`}
          onClick={() => setRequired(!required)}
          {...stopDrag}
        >
          <span className="po-mod-required-dot" />
          Required
        </button>

        {/* Default-item — radio-only Combobox (same widget as CpmCategorySelect /
            BookingCreateModal). Wrapped in a stopDrag div so press-and-hold on
            the trigger doesn't fire group reorder. */}
        {ctrl === 'radio' && items.length > 0 && (
          <div className="po-mod-default-cb" {...stopDrag}>
            <Combobox
              value={defItem === '' ? '' : Number(defItem)}
              placeholder="No default"
              options={[
                { value: '', label: 'No default' },
                ...items.map(it => ({
                  value: it.id,
                  label: `Default: ${it.name || `#${it.id}`}`,
                })),
              ]}
              onChange={(v) => setDefItem(v === '' ? '' : v)}
            />
          </div>
        )}

        <button
          type="button" className="po-mod-group-del"
          onClick={onDelete} title="Delete group"
          {...stopDrag}
        >
          <Trash />
        </button>
      </div>

      <div ref={dropSortable.setNodeRef} className="po-mod-items">
        <SortableContext items={items.map(it => String(it.id))} strategy={verticalListSortingStrategy}>
          {items.map(it => (
            <ModifierItemRow key={it.id} item={it}
              onUpdate={onItemChange}
              onDelete={() => onItemDelete(it.id)}
              registerUndo={registerUndo} />
          ))}
        </SortableContext>
        {items.length === 0 && (
          <div className="po-mod-items-empty">No items yet — add one below.</div>
        )}
        <button type="button" className="po-mod-add-item" onClick={onAddItem}>
          <Plus weight="bold" /> Add item
        </button>
      </div>
    </div>
  );
}

function ModifierItemRow({ item, onUpdate, onDelete, registerUndo }) {
  const sortable = useSortable({ id: String(item.id) });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const [name,  setName]  = useState(item.name || '');
  const [price, setPrice] = useState(String(item.price_delta ?? 0));
  const skip = useRef(true);

  useEffect(() => {
    skip.current = true;
    setName(item.name || '');
    setPrice(String(item.price_delta ?? 0));
  }, [item.id, item.name, item.price_delta]);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(async () => {
      const before = { name: item.name, price_delta: item.price_delta };
      const ok = await onUpdate(item.id, { name: name || '', price_delta: parseFloat(price) || 0 });
      if (ok) registerUndo?.({
        description: `Modifier item "${item.name || '—'}" changed`,
        silent: true,
        undo: async () => { await onUpdate(item.id, before); },
      });
    }, 500);
    return () => clearTimeout(t);
  }, [name, price]); // eslint-disable-line

  // Long-press anywhere on the row starts drag; pointerdown on inputs/buttons
  // is stopped so taps focus the input as expected.
  const stopDrag = { onPointerDown: (e) => e.stopPropagation() };

  return (
    <div ref={setNodeRef} style={style} className="po-mod-item" {...attributes} {...listeners}>
      <input
        className="po-mod-item-name" value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Item name"
        {...stopDrag}
      />
      <input
        className="po-mod-item-price" type="number" step="0.01"
        value={price} onChange={e => setPrice(e.target.value)}
        placeholder="0.00"
        {...stopDrag}
      />
      <button type="button" className="po-mod-item-del" onClick={onDelete} title="Delete item" {...stopDrag}>
        <Trash />
      </button>
    </div>
  );
}


// ─── SEO ──────────────────────────────────────────────────────────
function SeoBlock({ product, pq, setProduct, showToast, registerUndo }) {
  const [seoTitle, setSeoTitle] = useState(product.seo_title || '');
  const [seoDesc,  setSeoDesc]  = useState(product.seo_description || '');
  const [seoKw,    setSeoKw]    = useState(product.seo_keywords || '');

  const patch = useCallback(async (body) => {
    const res = await fetch(`${API_BASE}/api/products/${product.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { showToast('Save failed'); return false; }
    setProduct(p => ({ ...p, ...body }));
    showToast('Saved');
    return true;
  }, [product.id, pq, setProduct, showToast]);

  useUndoableSave({
    value: seoTitle, setValue: setSeoTitle, serverValue: product.seo_title || '',
    save: (v) => patch({ seo_title: v }), registerUndo, label: 'SEO Title',
  });
  useUndoableSave({
    value: seoDesc, setValue: setSeoDesc, serverValue: product.seo_description || '',
    save: (v) => patch({ seo_description: v }), registerUndo, label: 'SEO Description',
  });
  useUndoableSave({
    value: seoKw, setValue: setSeoKw, serverValue: product.seo_keywords || '',
    save: (v) => patch({ seo_keywords: v }), registerUndo, label: 'SEO Keywords',
  });

  return (
    <section className="po-block">
      <h2 className="crm-page-title1">SEO</h2>
      <p className="po-block-hint">Used by the storefront for search-engine results.</p>
      <div className="po-form">
        <Field label="SEO Title">
          <input className="crm-input po-input" value={seoTitle}
            onChange={e => setSeoTitle(e.target.value)} placeholder="e.g. Buy Trousers Online" maxLength={200} />
        </Field>
        <Field label={<>SEO Description <span className="po-char-count">{seoDesc.length}/160</span></>}>
          <textarea className="crm-input po-textarea" rows={3} maxLength={160} value={seoDesc}
            onChange={e => setSeoDesc(e.target.value)}
            placeholder="Brief page description for search results…" />
        </Field>
        <Field label="Keywords">
          <input className="crm-input po-input" value={seoKw}
            onChange={e => setSeoKw(e.target.value)} placeholder="trousers, pants, fashion" maxLength={300} />
        </Field>
      </div>
    </section>
  );
}
