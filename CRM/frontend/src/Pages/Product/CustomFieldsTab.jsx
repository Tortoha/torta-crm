import { useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';

export default function CustomFieldsTab({ product, productId, pq }) {
  const [fields,    setFields]    = useState(product.custom_fields || []);
  const [showForm,  setShowForm]  = useState(false);
  const [newKey,    setNewKey]    = useState('');
  const [newVal,    setNewVal]    = useState('');
  const [newType,   setNewType]   = useState('string');
  const [newGlobal, setNewGlobal] = useState(false);
  const [adding,    setAdding]    = useState(false);
  const [err,       setErr]       = useState('');

  const saveField = async e => {
    e.preventDefault();
    if (!newKey.trim()) return setErr('Key is required');
    setAdding(true); setErr('');
    const res = await fetch(`${API_BASE}/api/products/${productId}/custom-fields${pq}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_key: newKey.trim(), field_value: newVal, field_type: newType, is_global: newGlobal }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.detail || 'Error'); setAdding(false); return; }
    const entry = { field_key: data.field_key, field_value: newVal, field_type: newType, is_global: newGlobal };
    setFields(prev => {
      const idx = prev.findIndex(f => f.field_key === data.field_key);
      return idx >= 0 ? prev.map((f, i) => i === idx ? entry : f) : [...prev, entry];
    });
    setNewKey(''); setNewVal(''); setNewType('string'); setNewGlobal(false); setShowForm(false); setAdding(false);
  };

  const deleteField = async key => {
    if (!confirm(`Delete field "${key}"?`)) return;
    await fetch(`${API_BASE}/api/products/${productId}/custom-fields/${encodeURIComponent(key)}${pq}`,
      { method: 'DELETE', credentials: 'include' });
    setFields(prev => prev.filter(f => f.field_key !== key));
  };

  const toggleGlobal = async key => {
    const res = await fetch(`${API_BASE}/api/products/${productId}/custom-fields/${encodeURIComponent(key)}/global${pq}`,
      { method: 'PATCH', credentials: 'include' });
    const data = await res.json();
    if (res.ok) setFields(prev => prev.map(f => f.field_key === key ? { ...f, is_global: data.is_global } : f));
  };

  return (
    <div className="prod-tab-content">
      <p className="prod-tab-hint">Custom fields appear in the storefront API. Toggle <strong>Global</strong> to share across all products.</p>

      {fields.length > 0 && (
        <div className="prod-cf-table-wrap">
          <table className="prod-cf-table">
            <thead><tr><th>Key</th><th>Value</th><th>Type</th><th>Global</th><th></th></tr></thead>
            <tbody>
              {fields.map(f => (
                <tr key={f.field_key} className="prod-cf-row">
                  <td><code className="prod-cf-key">{f.field_key}</code></td>
                  <td className="prod-cf-val">{f.field_value ?? '—'}</td>
                  <td><span className="prod-type-badge">{f.field_type}</span></td>
                  <td>
                    <button className={`prod-cf-toggle${f.is_global ? ' prod-cf-toggle--on' : ''}`}
                      onClick={() => toggleGlobal(f.field_key)} />
                  </td>
                  <td>
                    <button className="crm-icon-btn crm-icon-btn--danger" onClick={() => deleteField(f.field_key)}>
                      <Trash className="crm-icon crm-icon--sm" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fields.length === 0 && !showForm && <div className="prod-empty-state">No custom fields yet.</div>}

      <div className={`prod-form-wrap${showForm ? ' prod-form-wrap--open' : ''}`}>
        <form className="prod-cf-form" onSubmit={saveField}>
          <input className="prod-field-input prod-field-input--mono" placeholder="field_key"
            value={newKey} onChange={e => setNewKey(e.target.value)} />
          <input className="prod-field-input" placeholder="value"
            value={newVal} onChange={e => setNewVal(e.target.value)} />
          <select className="prod-field-input crm-input-select" value={newType} onChange={e => setNewType(e.target.value)}>
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="json">json</option>
          </select>
          <label className="prod-cf-global-label">
            <button type="button" className={`prod-cf-toggle${newGlobal ? ' prod-cf-toggle--on' : ''}`}
              onClick={() => setNewGlobal(v => !v)} />
            Global field
          </label>
          {err && <span className="crm-form-error">{err}</span>}
          <button className="prod-save-btn" type="submit" disabled={adding}>
            {adding ? 'Adding…' : 'Add field'}
          </button>
        </form>
      </div>

      <button className="crm-add-btn crm-add-btn--mt" onClick={() => { setShowForm(v => !v); setErr(''); }}>
        <Plus className="crm-add-btn-icon" />
        {showForm ? 'Cancel' : 'New Field'}
      </button>
    </div>
  );
}
