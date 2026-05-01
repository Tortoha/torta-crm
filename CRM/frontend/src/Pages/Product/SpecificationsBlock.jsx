import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Trash } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';

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

function nodeLabel(product, chain, layer) {
  const node = findNodeAt(product, chain, layer);
  if (!node) return `Layer ${layer}`;
  const name = node.variation_name || node.name || `Row ${node.id}`;
  return `Layer ${layer}: ${name}`;
}

export default function SpecificationsBlock({ product, productId, pq, chain, shownLayers, reloadProduct }) {
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
    const res = await fetch(`${API_BASE}/api/products/${productId}/specifications/${id}${pq}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) reloadProduct?.();
  };

  return (
    <section className="po-block">
      <h2 className="po-block-title">Specifications</h2>
      <div className="cfg-block-body">
        <div className="spec-attach-row">
          <label className="po-field-label spec-attach-label">Attached to</label>
          <select className="crm-input crm-input-select spec-attach-select"
            value={layer}
            onChange={e => setLayer(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].slice(0, shownLayers).map(n => (
              <option key={n} value={n}>{nodeLabel(product, chain, n)}</option>
            ))}
          </select>
        </div>

        {!selectedNode ? (
          <div className="cfg-empty">Select a row in Layer {layer} above to add specifications.</div>
        ) : (
          <div className="cfg-list">
            <div className="cfg-list-head spec-list-head">
              <span className="cfg-col">Name</span>
              <span className="cfg-col">Value</span>
              <span className="cfg-col cfg-col-actions" />
            </div>

            {specs.map(s => (
              <SpecRow key={s.id} spec={s}
                productId={productId} pq={pq}
                onChange={updateLocal}
                onDelete={() => removeSpec(s.id)}
                reloadProduct={reloadProduct} />
            ))}

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

function SpecRow({ spec, productId, pq, onChange, onDelete, reloadProduct }) {
  const [key,   setKey]   = useState(spec.spec_key   || '');
  const [value, setValue] = useState(spec.spec_value || '');
  const skip = useRef(true);

  useEffect(() => {
    skip.current = true;
    setKey(spec.spec_key   || '');
    setValue(spec.spec_value || '');
  }, [spec.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(async () => {
      const body = { spec_key: key.trim(), spec_value: value.trim() };
      const res = await fetch(`${API_BASE}/api/products/${productId}/specifications/${spec.id}${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onChange?.(spec.id, body);
        reloadProduct?.();
      }
    }, 400);
    return () => clearTimeout(t);
  }, [key, value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cfg-row spec-row">
      <input className="crm-input cfg-cell" value={key}
        onChange={e => setKey(e.target.value)} placeholder="Material" />
      <input className="crm-input cfg-cell" value={value}
        onChange={e => setValue(e.target.value)} placeholder="Cotton" />
      <button type="button" className="cfg-col-actions cfg-delete-btn" onClick={onDelete} title="Delete">
        <Trash />
      </button>
    </div>
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
