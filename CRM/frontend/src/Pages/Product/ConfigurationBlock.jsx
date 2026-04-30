import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';

export default function ConfigurationBlock({ productId, variation, pq }) {
  const [configs, setConfigs] = useState(variation?.configurations || []);

  useEffect(() => {
    setConfigs(variation?.configurations || []);
  }, [variation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateConfig = useCallback((cfgId, patch) => {
    setConfigs(prev => prev.map(c => c.id === cfgId ? { ...c, ...patch } : c));
  }, []);

  if (!variation) return null;

  const removeConfig = async (cfgId) => {
    if (!confirm('Delete this configuration?')) return;
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/${variation.id}/configurations/${cfgId}${pq}`,
      { method: 'DELETE', credentials: 'include' });
    if (res.ok) setConfigs(prev => prev.filter(c => c.id !== cfgId));
  };

  return (
    <section className="po-block">
      <h2 className="po-block-title">Configuration</h2>
      <div className="cfg-block-body">
        <div className="cfg-list">
          <div className="cfg-list-head">
            <span className="cfg-col cfg-col-name">Configuration</span>
            <span className="cfg-col cfg-col-price">Price</span>
            <span className="cfg-col cfg-col-stock">Stock</span>
            <span className="cfg-col cfg-col-sold">Sold</span>
            <span className="cfg-col cfg-col-actions" />
          </div>

          {configs.length === 0 && (
            <div className="cfg-empty">
              No configurations yet. Add one below — e.g. <i>S / M / L</i>, <i>30 cm / 40 cm</i>, <i>0.5 L / 1 L</i>.
            </div>
          )}

          {configs.map(c => (
            <CfgRow key={c.id} cfg={c} productId={productId} variationId={variation.id} pq={pq}
              onChange={updateConfig} onDelete={() => removeConfig(c.id)} />
          ))}

          <CfgNewRow productId={productId} variationId={variation.id} pq={pq}
            onAdded={(created) => setConfigs(prev => [...prev, created])} />
        </div>
      </div>
    </section>
  );
}

function CfgRow({ cfg, productId, variationId, pq, onChange, onDelete }) {
  const [name,  setName]  = useState(cfg.configuration_name);
  const [price, setPrice] = useState(String(cfg.price));
  const [stock, setStock] = useState(String(cfg.stock_quantity));
  const skip = useRef(true);

  // Re-sync when the parent swaps in a fresh cfg row (e.g. after variation switch)
  useEffect(() => {
    skip.current = true;
    setName(cfg.configuration_name);
    setPrice(String(cfg.price));
    setStock(String(cfg.stock_quantity));
  }, [cfg.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = setTimeout(async () => {
      const body = {
        configuration_name: name.trim() || cfg.configuration_name,
        price: parseFloat(price) || 0,
        stock_quantity: parseInt(stock, 10) || 0,
      };
      await fetch(`${API_BASE}/api/products/${productId}/variations/${variationId}/configurations/${cfg.id}${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onChange(cfg.id, body);
    }, 400);
    return () => clearTimeout(t);
  }, [name, price, stock]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cfg-row">
      <input className="crm-input cfg-cell cfg-col-name" value={name}
        onChange={e => setName(e.target.value)} placeholder="S / 30cm / 1L" />
      <input className="crm-input cfg-cell cfg-col-price" type="number" min="0" step="0.01"
        value={price} onChange={e => setPrice(e.target.value)} />
      <input className="crm-input cfg-cell cfg-col-stock" type="number" min="0"
        value={stock} onChange={e => setStock(e.target.value)} />
      <span className="cfg-cell cfg-col-sold cfg-sold-num">{cfg.sold_quantity || 0}</span>
      <button type="button" className="cfg-cell cfg-col-actions cfg-delete-btn" onClick={onDelete} title="Delete">
        <Trash />
      </button>
    </div>
  );
}

function CfgNewRow({ productId, variationId, pq, onAdded }) {
  const [name,  setName]  = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [busy,  setBusy]  = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const res = await fetch(`${API_BASE}/api/products/${productId}/variations/${variationId}/configurations${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configuration_name: name.trim(),
        price: parseFloat(price) || 0,
        stock_quantity: parseInt(stock, 10) || 0,
      }),
    });
    setBusy(false);
    if (!res.ok) return;
    const data = await res.json();
    onAdded(data);
    setName(''); setPrice(''); setStock('');
  };

  return (
    <form className="cfg-row cfg-row--new" onSubmit={submit}>
      <input className="crm-input cfg-cell cfg-col-name" value={name}
        onChange={e => setName(e.target.value)} placeholder="New configuration" />
      <input className="crm-input cfg-cell cfg-col-price" type="number" min="0" step="0.01"
        value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
      <input className="crm-input cfg-cell cfg-col-stock" type="number" min="0"
        value={stock} onChange={e => setStock(e.target.value)} placeholder="0" />
      <span className="cfg-cell cfg-col-sold" />
      <button type="submit" className="cfg-cell cfg-col-actions cfg-add-btn" disabled={busy || !name.trim()}>
        <Plus weight="bold" />
      </button>
    </form>
  );
}
