import { useState } from 'react';
import { Check, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';

export default function SizeRow({ size, productId, varId, pq, onDeleted, onUpdated }) {
  const [name,   setName]   = useState(size.size_name);
  const [price,  setPrice]  = useState(String(size.price));
  const [stock,  setStock]  = useState(String(size.stock_quantity));
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch(`${API_BASE}/api/products/${productId}/variations/${varId}/sizes/${size.id}${pq}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size_name: name, price: parseFloat(price) || 0, stock_quantity: parseInt(stock) || 0 }),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1500);
    onUpdated({ ...size, size_name: name, price: parseFloat(price), stock_quantity: parseInt(stock) });
  };

  const del = async () => {
    if (!confirm('Delete this size?')) return;
    await fetch(`${API_BASE}/api/products/${productId}/variations/${varId}/sizes/${size.id}${pq}`,
      { method: 'DELETE', credentials: 'include' });
    onDeleted(size.id);
  };

  return (
    <tr className="prod-size-row">
      <td><input className="prod-cell-input" value={name} onChange={e => setName(e.target.value)} /></td>
      <td><input className="prod-cell-input prod-cell-input--num" type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></td>
      <td><input className="prod-cell-input prod-cell-input--num" type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} /></td>
      <td className="prod-size-sold">{size.sold_quantity || 0}</td>
      <td>
        <div className="prod-size-actions">
          {saved
            ? <Check className="prod-check-icon" />
            : <button className="crm-icon-btn" title="Save" onClick={save} disabled={saving}>
                <Check className="crm-icon crm-icon--sm" style={{ color: saving ? '#ccc' : '#16a34a' }} />
              </button>}
          <button className="crm-icon-btn crm-icon-btn--danger" title="Delete" onClick={del}>
            <Trash className="crm-icon crm-icon--sm" />
          </button>
        </div>
      </td>
    </tr>
  );
}
