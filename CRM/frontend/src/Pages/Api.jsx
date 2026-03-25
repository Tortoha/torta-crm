import { useEffect, useState } from 'react';
import { ClipboardDocumentIcon, ClipboardDocumentCheckIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/outline';
import { KeyIcon } from '@heroicons/react/24/solid';
import { API_BASE } from '../api.js';
import '../Style/Api.css';

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  return (
    <button className="crm-icon-btn" onClick={copy} title="Copy">
      {copied
        ? <ClipboardDocumentCheckIcon className="crm-icon crm-icon--success" />
        : <ClipboardDocumentIcon className="crm-icon" />}
    </button>
  );
}

function ApiKeyCard({ k, onDelete }) {
  return (
    <div className={`crm-card api-key-card${k.is_selected ? ' api-key-card--active' : ''}`}>
      <div className="api-key-top">
        <KeyIcon className="crm-icon crm-icon--sm" />
        <span className="api-key-name">{k.name}</span>
        {k.is_selected && <span className="crm-badge crm-badge--dark">Active</span>}
        {k.user_role && !k.is_selected && <span className="crm-badge crm-badge--light">{k.user_role}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <CopyBtn text={k.api_key} />
          <button className="crm-icon-btn crm-icon-btn--danger" onClick={() => onDelete(k.id)} title="Delete">
            <TrashIcon className="crm-icon" />
          </button>
        </div>
      </div>

      <code className="api-key-value">{k.api_key}</code>

      <div className="api-key-meta-row">
        {k.created_at && <span className="api-key-meta">Created: {new Date(k.created_at).toLocaleDateString()}</span>}
        {k.last_used_at && (
          <span className="api-key-meta">
            Last used: {new Date(k.last_used_at).toLocaleDateString()}
            {k.last_used_ip && ` · ${k.last_used_ip}`}
          </span>
        )}
      </div>
    </div>
  );
}

function Api() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [formErr, setFormErr] = useState('');

  const load = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/api-keys`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => Array.isArray(data) ? (setKeys(data), setError('')) : setError(data?.detail || 'Failed to load'))
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    window.addEventListener('api-key-switched', load);
    return () => window.removeEventListener('api-key-switched', load);
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return setFormErr('Enter a name');
    setCreating(true); setFormErr('');
    try {
      const res = await fetch(`${API_BASE}/api/api-keys`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) return setFormErr(data.detail || 'Error');
      setNewName(''); setShowForm(false);
      load();
      window.dispatchEvent(new CustomEvent('api-keys-changed'));
    } catch { setFormErr('Network error'); }
    finally { setCreating(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this API key?')) return;
    const res = await fetch(`${API_BASE}/api/api-keys/${id}`, { method: 'DELETE', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) return alert(data.detail || 'Error');
    load();
    window.dispatchEvent(new CustomEvent('api-keys-changed'));
  };

  return (
    <>
      <h1 className="crm-page-title">API Keys</h1>
      <div className="crm-section">

        <div className="crm-section-row" style={{ justifyContent: 'flex-end' }}>
          <button className="crm-add-btn" onClick={() => { setShowForm(v => !v); setFormErr(''); setNewName(''); }}>
            <PlusIcon className="crm-add-btn-icon" />
            {showForm ? 'Cancel' : 'New API Key'}
          </button>
        </div>

        <div className={`crm-form-wrap${showForm ? ' crm-form-wrap--open' : ''}`}>
          <form className="crm-card crm-form" onSubmit={handleCreate}>
            <input className="crm-input" placeholder="Key name, e.g. My Store"
              value={newName} onChange={e => setNewName(e.target.value)} maxLength={100} autoFocus />
            {formErr && <span className="crm-form-error">{formErr}</span>}
            <button className="crm-submit-btn" type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
        </div>

        {loading ? <div className="crm-placeholder">Loading…</div>
          : error ? <div className="crm-placeholder" style={{ color: '#e3342f' }}>{error}</div>
            : keys.length === 0 ? <div className="crm-placeholder">No API keys yet</div>
              : <div className="crm-cards-list">{keys.map(k => <ApiKeyCard key={k.id} k={k} onDelete={handleDelete} />)}</div>}

      </div>
    </>
  );
}

export default Api