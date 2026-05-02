import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Trash, CaretDown, DotsSixVertical } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { DynamicBlock } from '../../Utils/DynamicBlock.js';
import { useUndoableSave } from '../../Utils/useUndoableSave.js';
import { RowContextMenu } from '../../Utils/RowContextMenu.jsx';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Walk the product tree using `chain` to find the selected node at `layer` (1-based).
function findNodeAt(product, chain, layer) {
  if (!product || layer < 1 || layer > 5) return null;
  let level = product.variations || [];
  for (let i = 0; i < layer; i++) {
    const node = level.find(x => x.id === chain[i]);
    if (!node) return null;
    if (i === layer - 1) return node;
    level = i === 0 ? (node.configurations || []) : (node.children || []);
  }
  return null;
}

export default function SpecificationsBlock({ product, productId, pq, chain, shownLayers, reloadProduct, registerUndo, bulk, setBulk, clearBulk }) {
  const [layer, setLayer] = useState(1);

  // Clamp `layer` if shownLayers shrinks (user deleted last layer).
  useEffect(() => {
    if (layer > shownLayers) setLayer(shownLayers);
  }, [shownLayers, layer]);

  const selectedNode = useMemo(() => findNodeAt(product, chain, layer), [product, chain, layer]);
  const specs = selectedNode?.specifications || [];

  const updateLocal = useCallback((id, patch) => {
    // Server-side reload will refresh — but we keep a quick local mutation
    // so debounced saves don't flicker. Just trigger a reload after timeout.
    // Simpler: rely on reloadProduct after save.
    void id; void patch;
  }, []);

  const removeSpec = async (id) => {
    if (!confirm('Delete this specification?')) return;
    const target = specs.find(s => s.id === id);
    const snapshot = target ? {
      layer, parent_id: selectedNode?.id,
      spec_key: target.spec_key, spec_value: target.spec_value,
    } : null;
    const res = await fetch(`${API_BASE}/api/products/${productId}/specifications/${id}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) return;
    reloadProduct?.();
    if (snapshot && registerUndo) {
      registerUndo({
        description: `Specification "${snapshot.spec_key}" deleted`,
        undo: async () => {
          const r = await fetch(`${API_BASE}/api/products/${productId}/specifications${pq}`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot),
          });
          if (r.ok) reloadProduct?.();
        },
      });
    }
  };

  return (
    <section className="po-block">
      <h2 className="po-block-title">Specifications</h2>
      <div className="cfg-block-body">
        <div className="spec-attach-field">
          <label className="po-field-label1">Linking specifications to a layer</label>
          <LayerSelect layer={layer} setLayer={setLayer} shownLayers={shownLayers} />
        </div>

        {!selectedNode ? (
          <div className="cfg-empty">Select a row in Layer {layer} above to add specifications.</div>
        ) : (
          <div className="cfg-list">
            <div className={`cfg-list-head spec-list-head${bulk?.scope === 'specs' && bulk.ids.length ? ' cfg-list-head--bulk-mode spec-list-head--bulk-mode' : ''}`}>
              {bulk?.scope === 'specs' && bulk.ids.length > 0 && <span className="cfg-col cfg-col-bulk" />}
              <span className="cfg-col">Name</span>
              <span className="cfg-col">Value</span>
              <span className="cfg-col cfg-col-actions" />
            </div>

            <SpecsSortable
              specs={specs}
              productId={productId} pq={pq}
              layer={layer} parentId={selectedNode.id}
              registerUndo={registerUndo} reloadProduct={reloadProduct}
              onChange={updateLocal}
              removeSpec={removeSpec}
              bulk={bulk} setBulk={setBulk} clearBulk={clearBulk} />

            <SpecNewRow
              productId={productId} pq={pq}
              layer={layer} parentId={selectedNode.id}
              onAdded={() => reloadProduct?.()} />
          </div>
        )}
      </div>
    </section>
  );
}

function SpecsSortable({ specs, productId, pq, layer, parentId, registerUndo, reloadProduct, onChange, removeSpec,
                          bulk, setBulk, clearBulk }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 300, tolerance: 5 } }));
  const ids = useMemo(() => specs.map(s => s.id), [specs]);

  const SCOPE = 'specs';
  const inScope = bulk?.scope === SCOPE;
  const bulkIds = inScope ? bulk.ids : [];
  const [ctxMenu, setCtxMenu] = useState(null);

  const bulkDelete = useCallback(async (deleteIds) => {
    if (!deleteIds.length) return;
    const targets = specs.filter(s => deleteIds.includes(s.id));
    const snapshots = targets.map(t => ({
      layer, parent_id: parentId,
      spec_key: t.spec_key, spec_value: t.spec_value,
    }));
    for (const id of deleteIds) {
      await fetch(`${API_BASE}/api/products/${productId}/specifications/${id}${pq}`, {
        method: 'DELETE', credentials: 'include',
      });
    }
    clearBulk?.();
    await reloadProduct?.();
    if (snapshots.length && registerUndo) {
      registerUndo({
        description: `${deleteIds.length} spec${deleteIds.length === 1 ? '' : 's'} deleted`,
        undo: async () => {
          for (const snap of snapshots) {
            await fetch(`${API_BASE}/api/products/${productId}/specifications${pq}`, {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(snap),
            });
          }
          await reloadProduct?.();
        },
      });
    }
  }, [specs, layer, parentId, productId, pq, clearBulk, reloadProduct, registerUndo]);

  const toggleInBulk = useCallback((id) => {
    setBulk(prev => {
      const list = prev.scope === SCOPE ? [...prev.ids] : [];
      const idx = list.indexOf(id);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(id);
      return list.length ? {
        scope: SCOPE, ids: list,
        actions: { delete: () => bulkDelete(list) },
      } : { scope: null, ids: [], actions: null };
    });
  }, [setBulk, bulkDelete]);

  const onRowClick = useCallback((e, id) => {
    if (!(e.shiftKey || e.metaKey || e.ctrlKey || inScope)) return false;
    e.stopPropagation();
    e.preventDefault();
    toggleInBulk(id);
    return true;
  }, [inScope, toggleInBulk]);

  const openCtxMenu = useCallback((e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, id });
  }, []);

  const persistOrder = async (newIds) => {
    await fetch(`${API_BASE}/api/products/${productId}/specifications/reorder${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: newIds, layer, parent_id: parentId }),
    });
  };

  const onDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldOrder = ids;
    const oldIdx = oldOrder.indexOf(active.id);
    const newIdx = oldOrder.indexOf(over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const newOrder = arrayMove(oldOrder, oldIdx, newIdx);
    await persistOrder(newOrder);
    await reloadProduct?.();
    registerUndo?.({
      description: 'Specifications reordered',
      undo: async () => { await persistOrder(oldOrder); await reloadProduct?.(); },
    });
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {specs.map(s => (
            <SortableSpecRow key={s.id} spec={s}
              productId={productId} pq={pq}
              registerUndo={registerUndo}
              onChange={onChange}
              onDelete={() => removeSpec(s.id)}
              reloadProduct={reloadProduct}
              onRowClick={onRowClick}
              onContextMenu={(e) => openCtxMenu(e, s.id)}
              bulkSelected={bulkIds.includes(s.id)}
              bulkActive={inScope}
              onBulkToggle={() => toggleInBulk(s.id)} />
          ))}
        </SortableContext>
      </DndContext>
      {ctxMenu && (
        <RowContextMenu pos={ctxMenu}
          onSelect={() => toggleInBulk(ctxMenu.id)}
          onClose={() => setCtxMenu(null)} />
      )}
    </>
  );
}

function SortableSpecRow(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.spec.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: isDragging ? 'var(--card)' : undefined,
    boxShadow: isDragging ? 'var(--shadow-card)' : undefined,
    zIndex: isDragging ? 5 : 'auto',
    opacity: isDragging ? 0.92 : 1,
  };
  return (
    <SpecRow
      {...props}
      dragRef={setNodeRef}
      dragStyle={style}
      dragHandleProps={{ ...attributes, ...listeners }}
    />
  );
}

function SpecRow({ spec, productId, pq, onChange, onDelete, reloadProduct, registerUndo,
                    dragRef, dragStyle, dragHandleProps, onRowClick, onContextMenu,
                    bulkSelected, bulkActive, onBulkToggle }) {
  const [key,   setKey]   = useState(spec.spec_key   || '');
  const [value, setValue] = useState(spec.spec_value || '');

  const save = useCallback(async (body) => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/specifications/${spec.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      onChange?.(spec.id, body);
      reloadProduct?.();
    }
    return res.ok;
  }, [productId, spec.id, pq, onChange, reloadProduct]);

  useUndoableSave({
    value: key, setValue: setKey,
    serverValue: spec.spec_key || '',
    save: (val) => save({ spec_key: (val || '').trim(), spec_value: value.trim() }),
    registerUndo, label: 'Specification key', debounceMs: 400,
  });
  useUndoableSave({
    value: value, setValue: setValue,
    serverValue: spec.spec_value || '',
    save: (val) => save({ spec_key: key.trim(), spec_value: (val || '').trim() }),
    registerUndo, label: 'Specification value', debounceMs: 400,
  });

  return (
    <div ref={dragRef} style={dragStyle}
      onClick={(e) => onRowClick?.(e, spec.id)}
      onContextMenu={onContextMenu}
      className={`cfg-row spec-row cfg-row--grabbable${bulkSelected ? ' cfg-row--bulk' : ''}${bulkActive ? ' cfg-row--bulk-mode spec-row--bulk-mode' : ''}`}
      title="Right-click for actions · hold 0.3s to drag"
      {...(dragHandleProps || {})}>
      {bulkActive && (
        <input type="checkbox" className="cat-prod-checkbox cfg-bulk-check"
          checked={!!bulkSelected}
          onChange={() => onBulkToggle?.()}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          aria-label="Toggle selection" />
      )}
      <input className="crm-input cfg-cell" value={key}
        onChange={e => setKey(e.target.value)} placeholder="Material" />
      <input className="crm-input cfg-cell" value={value}
        onChange={e => setValue(e.target.value)} placeholder="Cotton" />
      <button type="button" className="cfg-col-actions cfg-delete-btn"
        onClick={onDelete} title="Delete">
        <Trash />
      </button>
    </div>
  );
}

// Custom layer dropdown — same visual language as CpmCategorySelect:
// pill trigger + portal panel with sliding hover indicator.
function LayerSelect({ layer, setLayer, shownLayers }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [hovered, setHovered] = useState(null);

  const activeKey = `l:${layer}`;
  const current = hovered ?? activeKey;
  const { indRef, setItemRef } = DynamicBlock(current, open);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(r.width, window.innerWidth - margin * 2);
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

  const layers = [1, 2, 3, 4, 5].slice(0, shownLayers);

  return (
    <>
      <button ref={btnRef} type="button"
        className={`cpm-cat-btn${open ? ' cpm-cat-btn--open' : ''}`}
        onClick={() => setOpen(v => !v)}>
        <span>Layer {layer}</span>
        <CaretDown weight="bold" className={`cpm-cat-caret${open ? ' cpm-cat-caret--up' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div className="cat-filter-dropdown cpm-cat-dropdown"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onMouseLeave={() => setHovered(null)}>
          <div ref={indRef} className="cat-filter-indicator" />
          {layers.map(n => {
            const k = `l:${n}`;
            return (
              <button key={n} ref={setItemRef(k)} type="button"
                className={`cat-filter-item${current === k ? ' cat-filter-item--current' : ''}`}
                onMouseEnter={() => setHovered(k)}
                onClick={() => { setLayer(n); setOpen(false); }}>
                <span>Layer {n}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

function SpecNewRow({ productId, pq, layer, parentId, onAdded }) {
  const [key,   setKey]   = useState('');
  const [value, setValue] = useState('');
  const busyRef = useRef(false);

  // Reset draft if user navigates to a different parent
  useEffect(() => { setKey(''); setValue(''); }, [layer, parentId]);

  useEffect(() => {
    if (!key.trim() || busyRef.current) return;
    const t = setTimeout(async () => {
      busyRef.current = true;
      const res = await fetch(`${API_BASE}/api/products/${productId}/specifications${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer, parent_id: parentId,
          spec_key: key.trim(), spec_value: value.trim(),
        }),
      });
      busyRef.current = false;
      if (!res.ok) return;
      onAdded?.();
      setKey(''); setValue('');
    }, 600);
    return () => clearTimeout(t);
  }, [key, value, layer, parentId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cfg-row cfg-row--new spec-row">
      <input className="crm-input cfg-cell" value={key}
        onChange={e => setKey(e.target.value)} placeholder="New specification" />
      <input className="crm-input cfg-cell" value={value}
        onChange={e => setValue(e.target.value)} placeholder="Value" />
      <span className="cfg-col-actions" />
    </div>
  );
}
