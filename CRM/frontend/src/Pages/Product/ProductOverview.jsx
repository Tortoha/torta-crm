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
import '../../Style/Authentication.css';
import '../../Style/Organization.css';
import '../../Style/Products.css';


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

  // Bulk-select state — single source of truth across all blocks. When a
  // block changes scope (user clicks in another section), the previous
  // selection is wiped automatically since each block only shows selection
  // when bulk.scope matches its own.
  const [bulk, setBulk] = useState({ scope: null, ids: [], actions: null });
  const clearBulk = useCallback(() => setBulk({ scope: null, ids: [], actions: null }), []);

  useEffect(() => {
    const onKey = (e) => {
      // Esc clears selection. Delete/Backspace fires the bulk-delete action
      // — but only when focus isn't in a text input so we don't eat keystrokes.
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

  // Reset chain + shownLayers when navigating to a different product so
  // expansion state from product A doesn't leak into product B.
  useEffect(() => {
    setShownLayers(1);
    setChain([null, null, null, null, null]);
  }, [productId]);

  const reloadProduct = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/products/${productId}${pq}`, { credentials: 'include' });
    if (res.ok) setProduct(await res.json());
  }, [productId, pq]);

  // Walk the tree and fill chain greedily — keep current id if still valid,
  // otherwise auto-pick the first row at that layer. Used both on product
  // reload and when user clicks a row at any layer.
  const fillChain = useCallback((startChain, productData) => {
    const next = [...startChain];
    if (!productData) return next;
    let level = productData.variations || [];
    for (let i = 0; i < 5; i++) {
      if (!level || level.length === 0) {
        // No more rows below — clear the rest of the chain
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
      // Reset deeper levels — fillChain will then auto-pick first row at each
      for (let i = level + 1; i < 5; i++) next[i] = null;
      return fillChain(next, product);
    });
  };

  const createNewLayer = () => {
    // fillChain (run on every product/chain change) already keeps the chain
    // greedily filled with first-available rows at each layer that has data.
    // So we just bump shownLayers; the next render will reveal Layer N+1.
    setShownLayers(n => Math.min(n + 1, 5));
  };

  const deleteLastLayer = async () => {
    if (shownLayers <= 1) return;
    if (!confirm(`Delete entire Layer ${shownLayers}?\nAll rows at this layer will be lost. Carts/orders referencing them will break.`)) return;
    // Build a {parent_id, data} snapshot for every row at the target layer
    // by walking down the product tree. Used by Undo to recreate the whole
    // layer (with deep subtrees + specs) under the original parents.
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

  // Button visible when the last visible layer has any rows (selection optional —
  // createNewLayer auto-picks first row at each unselected layer).
  const lastLayerItems = layers?.[shownLayers - 1]?.items || [];
  const canCreateNewLayer = shownLayers < 5 && lastLayerItems.length > 0;

  return (
    <Shell>
      <h1 className="crm-page-title">{product.title || 'Untitled'}</h1>

      <GeneralBlock product={product} pq={pq} setProduct={setProduct}
        setProductContext={setProductContext} productHash={productHash}
        showToast={showToast} registerUndo={registerUndo} />

      {layers && [1, 2, 3, 4, 5].map(n => {
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
            bulk={bulk} setBulk={setBulk} clearBulk={clearBulk} />
        );
      })}

      {canCreateNewLayer && (
        <button className="po-add-layer-btn" type="button" onClick={createNewLayer}>
          <Plus weight="bold" /> Create Configuration Layer {shownLayers + 1}
        </button>
      )}

      <SpecificationsBlock
        product={product}
        productId={productId} pq={pq}
        chain={chain}
        shownLayers={shownLayers}
        reloadProduct={reloadProduct}
        registerUndo={registerUndo}
        bulk={bulk} setBulk={setBulk} clearBulk={clearBulk} />

      <CustomFieldsBlock product={product} productId={productId} pq={pq}
        setProduct={setProduct} showToast={showToast} registerUndo={registerUndo}
        bulk={bulk} setBulk={setBulk} clearBulk={clearBulk} />

      <SeoBlock product={product} pq={pq} setProduct={setProduct} showToast={showToast} registerUndo={registerUndo} />

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

// Figma-style floating toolbar for multi-selection. Appears when any block
// has at least one selected row/card; hidden otherwise. Click "Delete" to
// fire the active block's bulk-delete action (one Undo entry covers all).
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

function GeneralBlock({ product, pq, setProduct, setProductContext, productHash, showToast, registerUndo }) {
  const [title,    setTitle]    = useState(product.title || '');
  const [subtitle, setSubtitle] = useState(product.subtitle || '');
  const [desc,     setDesc]     = useState(product.description || '');
  const [catId,    setCatId]    = useState(product.category_id ?? '');
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
    silent: false,  // category change is a discrete click — show toast
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
        <Field label="Category">
          <CpmCategorySelect
            value={catId == null ? '' : String(catId)}
            categories={categories}
            onChange={setCatId} />
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
  { value: 'string',  label: 'string'  },
  { value: 'number',  label: 'number'  },
  { value: 'boolean', label: 'boolean' },
  { value: 'json',    label: 'json'    },
];
const CF_GLOBAL_OPTIONS = [
  { value: 'no',  label: 'No'  },
  { value: 'yes', label: 'Yes' },
];

function CustomFieldsBlock({ product, productId, pq, setProduct, showToast, registerUndo, bulk, setBulk, clearBulk }) {
  const fields = product.custom_fields || [];
  const realKeys = fields.filter(f => !f.is_placeholder).map(f => f.field_key);

  // POST — create new row (also used when filling in a placeholder for the first time).
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
        // Re-add the row on the current product visually; other products
        // will see their rows again on their next page load.
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

  // Reorder only persists for real (non-placeholder) rows; placeholders are
  // sorted to the end on each render anyway since they aren't owned here.
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
    // Optimistically reorder local state so the UI doesn't snap back.
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
    // Capture snapshots from server response (so cascade rows are included for global keys).
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
                  onBulkToggle={() => toggleInBulk(f.field_key)} />
              ))}
            </SortableContext>
          </DndContext>
          {placeholders.map(f => (
            <CfRow key={f.field_key} field={f}
              onCreate={create} onUpdate={update} registerUndo={registerUndo}
              onDelete={() => remove(f.field_key)}
              bulkActive={inScope} />
          ))}
          <CfNewRow existingKeys={realKeys} onSave={create} bulkActive={inScope} />
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
                  bulkSelected, bulkActive, onBulkToggle }) {
  const isPlaceholder = !!field.is_placeholder;
  const originalKeyRef = useRef(field.field_key);
  const [key,    setKey]    = useState(field.field_key);
  const [value,  setValue]  = useState(field.field_value ?? '');
  const [type,   setType]   = useState(field.field_type || 'string');
  const [global, setGlobal] = useState(!!field.is_global);
  const skip = useRef(true);
  // True after this row exists server-side. Placeholders flip on first save.
  const persisted = useRef(!isPlaceholder);
  // Snapshot of last-confirmed server state, used to register an undo entry
  // that rolls back any field-level edit (key/value/type/global) on this row.
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
  // Placeholders aren't sortable (no real row server-side); skip drag listeners.
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
      <CfValueInput type={type} value={value} onChange={setValue} />
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

// Normalize a value when the user switches type so the displayed editor never
// drifts from the stored value (boolean shouldn't keep "asd"; number shouldn't keep letters).
function normalizeForType(value, type) {
  const v = value ?? '';
  if (type === 'boolean') return v === 'true' || v === 'false' ? v : 'false';
  if (type === 'number')  return /^-?\d*\.?\d*$/.test(v) ? v : '';
  return v;
}

function CfNewRow({ existingKeys, onSave, bulkActive }) {
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
      <CfValueInput type={type} value={val} onChange={setVal} />
      <CfCombobox value={type} options={CF_TYPE_OPTIONS} onChange={changeType} />
      <CfCombobox value={global ? 'yes' : 'no'} options={CF_GLOBAL_OPTIONS}
        onChange={(v) => setGlobal(v === 'yes')} />
      <span className="cfg-col-actions" />
    </div>
  );
}

// Type-aware value editor: number filters non-numeric, boolean is a Yes/No combobox,
// json gets a textarea with auto-close brackets, tab indent, and live validation.
function CfValueInput({ type, value, onChange }) {
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
  if (type === 'json') {
    return <CfJsonInput value={value} onChange={onChange} />;
  }
  return (
    <input className="crm-input cfg-cell" value={value}
      onChange={e => onChange(e.target.value)} placeholder="value" />
  );
}

// CodeMirror 6 JSON editor: syntax highlighting, auto-bracket close, smart
// indent. Wraps the inline editor with a tiny toolbar that exposes Format
// (prettify via JSON.stringify) and Expand (open in a full-screen modal).
// The inline + modal share the same value/onChange so debounced auto-save
// keeps firing regardless of which UI the user typed in.
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
      // Invalid JSON — silently no-op; the red border already flags it.
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
  // Local state so user can review before discarding via Cancel; Save commits
  // back through the same onChange the inline editor uses.
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

// In-row Category-style combobox. Mirrors LayerSelect (SpecificationsBlock):
// pill trigger + portal panel with sliding DynamicBlock indicator.
function CfCombobox({ value, options, onChange }) {
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
        className={`cpm-cat-btn cf-cb-btn${open ? ' cpm-cat-btn--open' : ''}`}
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
