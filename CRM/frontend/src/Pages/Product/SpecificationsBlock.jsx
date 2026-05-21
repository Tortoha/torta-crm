import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash, CaretDown, Plus } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { DynamicBlock } from '../../Utils/DynamicBlock.js';
import { useUndoableSave } from '../../Utils/useUndoableSave.js';

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

export default function SpecificationsBlock({ product, productId, pq, chain, shownLayers, reloadProduct, registerUndo }) {
  const { t } = useTranslation();
  const [layer, setLayer] = useState(1);

  // Clamp `layer` if shownLayers shrinks (user deleted last layer).
  useEffect(() => {
    if (layer > shownLayers) setLayer(shownLayers);
  }, [shownLayers, layer]);

  const selectedNode = useMemo(() => findNodeAt(product, chain, layer), [product, chain, layer]);
  const parentId   = selectedNode?.id;
  const allSpecs   = selectedNode?.specifications || [];
  const groups     = selectedNode?.spec_groups || [];
  const ungrouped  = useMemo(() => allSpecs.filter(s => !s.group_id), [allSpecs]);

  // Brand-new node with nothing yet → still offer a loose row so the merchant
  // can quick-add without first creating a group. Once groups exist and there
  // are no loose specs, the ungrouped area disappears (everything is grouped).
  const showUngrouped = ungrouped.length > 0 || groups.length === 0;

  // ─── Spec CRUD ────────────────────────────────────────────────────
  const createSpec = useCallback(async (body) => {
    const r = await fetch(`${API_BASE}/api/products/${productId}/specifications${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer, parent_id: parentId, ...body }),
    });
    if (r.ok) reloadProduct?.();
    return r.ok;
  }, [productId, pq, layer, parentId, reloadProduct]);

  const removeSpec = useCallback(async (id) => {
    if (!confirm(t('productDetail.specs.deleteSpecConfirm'))) return;
    const target = allSpecs.find(s => s.id === id);
    const snapshot = target ? {
      layer, parent_id: parentId, group_id: target.group_id || null,
      spec_key: target.spec_key, spec_value: target.spec_value,
    } : null;
    const res = await fetch(`${API_BASE}/api/products/${productId}/specifications/${id}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) return;
    reloadProduct?.();
    if (snapshot && registerUndo) {
      registerUndo({
        description: t('productDetail.specs.specDeleted', { key: snapshot.spec_key }),
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
  }, [allSpecs, layer, parentId, productId, pq, reloadProduct, registerUndo]);

  // ─── Group CRUD ───────────────────────────────────────────────────
  const createGroup = async () => {
    const r = await fetch(`${API_BASE}/api/products/${productId}/spec-groups${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer, parent_id: parentId, name: '' }),
    });
    if (r.ok) reloadProduct?.();
  };

  const renameGroup = async (gid, name) => {
    await fetch(`${API_BASE}/api/products/${productId}/spec-groups/${gid}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    reloadProduct?.();
  };

  const deleteGroup = async (gid) => {
    const g = groups.find(x => x.id === gid);
    const count = g?.specs?.length || 0;
    const msg = count
      ? t('productDetail.specs.deleteSectionConfirm', { count })
      : t('productDetail.specs.deleteSectionConfirmEmpty');
    if (!confirm(msg)) return;
    await fetch(`${API_BASE}/api/products/${productId}/spec-groups/${gid}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    reloadProduct?.();
  };

  return (
    <section className="po-block">
      <h2 className="po-block-title">{t('productDetail.specs.title')}</h2>
      <p className="po-block-hint">
        {t('productDetail.specs.hint')}
      </p>
      <div className="cfg-block-body">
        <div className="spec-attach-field">
          <label className="po-field-label1">{t('productDetail.specs.linkLabel')}</label>
          <LayerSelect layer={layer} setLayer={setLayer} shownLayers={shownLayers} />
        </div>

        {!selectedNode ? (
          <div className="cfg-empty">{t('productDetail.specs.selectRow', { n: layer })}</div>
        ) : (
          <>
            {/* Ungrouped specs — legacy rows + a quick-add row (borderless, like Modifier items). */}
            {showUngrouped && (
              <div className="po-mod-items spec-ungrouped">
                {ungrouped.map(s => (
                  <SpecRow key={s.id} spec={s} productId={productId} pq={pq}
                    reloadProduct={reloadProduct} registerUndo={registerUndo}
                    onDelete={() => removeSpec(s.id)} />
                ))}
                <SpecNewRow resetKey={`u:${parentId}`} onCreate={createSpec} />
              </div>
            )}

            {/* Section cards (mirror Modifier groups). */}
            <div className="spec-groups">
              {groups.map(g => (
                <SpecGroupCard key={g.id} group={g}
                  productId={productId} pq={pq}
                  reloadProduct={reloadProduct} registerUndo={registerUndo}
                  onRename={renameGroup}
                  onDelete={() => deleteGroup(g.id)}
                  onCreateSpec={createSpec}
                  onRemoveSpec={removeSpec} />
              ))}
            </div>

            <button type="button" className="po-mod-add-group" onClick={createGroup}>
              <Plus weight="bold" /> {t('productDetail.specs.addSection')}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

// ── One section card: name header + Name/Value rows + quick-add ──────
function SpecGroupCard({ group, productId, pq, reloadProduct, registerUndo, onRename, onDelete, onCreateSpec, onRemoveSpec }) {
  const { t } = useTranslation();
  const [name, setName] = useState(group.name || '');
  const skip = useRef(true);

  useEffect(() => { skip.current = true; setName(group.name || ''); }, [group.id, group.name]);

  // Debounced rename — same pattern as ModifierGroupCard.
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(() => { onRename(group.id, name); }, 500);
    return () => clearTimeout(t);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  const specs = group.specs || [];

  return (
    <div className="po-mod-group spec-group">
      <div className="po-mod-group-head spec-group-head">
        <div className="po-mod-name-wrap">
          <input className="po-mod-name-input" value={name}
            placeholder={t('productDetail.specs.sectionNamePlaceholder')}
            onChange={e => setName(e.target.value)} />
        </div>
        <button type="button" className="po-mod-group-del" onClick={onDelete} title={t('productDetail.specs.deleteSection')}>
          <Trash />
        </button>
      </div>

      <div className="po-mod-items spec-group-body">
        {specs.map(s => (
          <SpecRow key={s.id} spec={s} productId={productId} pq={pq}
            reloadProduct={reloadProduct} registerUndo={registerUndo}
            onDelete={() => onRemoveSpec(s.id)} />
        ))}
        <SpecNewRow resetKey={`g:${group.id}`}
          onCreate={(body) => onCreateSpec({ ...body, group_id: group.id })} />
      </div>
    </div>
  );
}

// ── Editable Name/Value row (inline autosave, undoable) ──────────────
function SpecRow({ spec, productId, pq, reloadProduct, registerUndo, onDelete }) {
  const { t } = useTranslation();
  const [key,   setKey]   = useState(spec.spec_key   || '');
  const [value, setValue] = useState(spec.spec_value || '');

  const save = useCallback(async (body) => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/specifications/${spec.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) reloadProduct?.();
    return res.ok;
  }, [productId, spec.id, pq, reloadProduct]);

  useUndoableSave({
    value: key, setValue: setKey,
    serverValue: spec.spec_key || '',
    save: (val) => save({ spec_key: (val || '').trim(), spec_value: value.trim() }),
    registerUndo, label: t('productDetail.specs.undoKey'), debounceMs: 400,
  });
  useUndoableSave({
    value: value, setValue: setValue,
    serverValue: spec.spec_value || '',
    save: (val) => save({ spec_key: key.trim(), spec_value: (val || '').trim() }),
    registerUndo, label: t('productDetail.specs.undoValue'), debounceMs: 400,
  });

  return (
    <div className="cfg-row spec-row">
      <input className="crm-input cfg-cell" value={key}
        onChange={e => setKey(e.target.value)} placeholder={t('productDetail.specs.keyPlaceholder')} />
      <input className="crm-input cfg-cell" value={value}
        onChange={e => setValue(e.target.value)} placeholder={t('productDetail.specs.valuePlaceholder')} />
      <button type="button" className="cfg-col-actions cfg-delete-btn"
        onClick={onDelete} title={t('productDetail.specs.delete')}>
        <Trash />
      </button>
    </div>
  );
}

// ── Quick-add row: auto-creates when a name is typed ─────────────────
function SpecNewRow({ onCreate, resetKey }) {
  const { t } = useTranslation();
  const [key,   setKey]   = useState('');
  const [value, setValue] = useState('');
  const busyRef = useRef(false);

  // Reset draft when the owning node/group changes.
  useEffect(() => { setKey(''); setValue(''); }, [resetKey]);

  useEffect(() => {
    if (!key.trim() || busyRef.current) return;
    const t = setTimeout(async () => {
      busyRef.current = true;
      const ok = await onCreate({ spec_key: key.trim(), spec_value: value.trim() });
      busyRef.current = false;
      if (ok) { setKey(''); setValue(''); }
    }, 600);
    return () => clearTimeout(t);
  }, [key, value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cfg-row cfg-row--new spec-row">
      <input className="crm-input cfg-cell" value={key}
        onChange={e => setKey(e.target.value)} placeholder={t('productDetail.specs.newSpecPlaceholder')} />
      <input className="crm-input cfg-cell" value={value}
        onChange={e => setValue(e.target.value)} placeholder={t('productDetail.specs.newValuePlaceholder')} />
      <span className="cfg-col-actions" />
    </div>
  );
}

// Layer dropdown (Category-style: pill trigger + portal panel + sliding indicator).
function LayerSelect({ layer, setLayer, shownLayers }) {
  const { t } = useTranslation();
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
        <span>{t('productDetail.specs.layer', { n: layer })}</span>
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
                <span>{t('productDetail.specs.layer', { n })}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
