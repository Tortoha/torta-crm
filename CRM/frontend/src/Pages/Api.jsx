import { useEffect, useState, useRef } from 'react';
import { Copy, Trash, Plus, DotsThreeVertical, PencilSimple, X, MagnifyingGlass } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import '../Style/Api.css';

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="api-modal-backdrop" onClick={onClose}>
      <div className="api-modal" onClick={e => e.stopPropagation()}>
        <div className="api-modal-header">
          <span className="api-modal-title">{title}</span>
          <button className="crm-icon-btn" onClick={onClose}>
            <X className="crm-icon" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}


function CreateModal({ onClose, onCreated }) {
  const [name, setName]           = useState('');
  const [frontendUrl, setFrontendUrl] = useState('');
  const [creating, setCreating]   = useState(false);
  const [err, setErr]             = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    const n = name.trim();
    const u = frontendUrl.trim();
    if (!n) return setErr('Enter a project name');
    if (!u) return setErr('Enter the frontend URL');
    setCreating(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/api-keys`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, frontend_url: u }),
      });
      const data = await res.json();
      if (!res.ok) return setErr(data.detail || 'Error');
      onCreated();
    } catch { setErr('Network error'); }
    finally { setCreating(false); }
  };

  return (
    <Modal title="New API Key" onClose={onClose}>
      <form className="api-modal-form" onSubmit={handleCreate}>
        <div className="api-modal-col">
          <input
            className="api-modal-input"
            placeholder="Project name, e.g. My Store"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={100}
            autoFocus
          />
          <input
            className="api-modal-input"
            placeholder="Frontend URL, e.g. http://localhost:3001"
            value={frontendUrl}
            onChange={e => setFrontendUrl(e.target.value)}
            autoComplete="off"
          />
          {err && <span className="crm-form-error">{err}</span>}
          <button className="api-modal-btn api-modal-btn--full" type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RenameModal({ k, onClose, onRenamed }) {
  const [name, setName] = useState(k.name);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || n === k.name) { onClose(); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/api-keys/${k.id}/rename`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n }),
      });
      const data = await res.json();
      if (!res.ok) return setErr(data.detail || 'Error');
      onRenamed(k.id, data.name);
      onClose();
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Rename API Key" onClose={onClose}>
      <form className="api-modal-form" onSubmit={handleSave}>
        <div className="api-modal-row">
          <input className="api-modal-input" value={name}
            onChange={e => setName(e.target.value)} maxLength={100} autoFocus />
          <button className="api-modal-btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {err && <span className="crm-form-error" style={{ padding: '0 4px' }}>{err}</span>}
      </form>
    </Modal>
  );
}

function ApiRow({ k, onDelete, onRenameClick, onSwitch }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef();

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const fmt = (d) => d
    ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <div
      className={`api-row${k.is_selected ? ' api-row--active' : ''}`}
      onClick={() => !k.is_selected && onSwitch(k.id)}
    >
      <span className="api-row-name">{k.name}</span>
      <div className="api-row-key-col">
        <span className="api-key-badge">{k.api_key.slice(0, 16)}…</span>
      </div>
      <span className="api-row-date">{fmt(k.last_used_at)}</span>
      <span className="api-row-date">{fmt(k.created_at)}</span>

      <div className="api-row-actions" ref={menuRef} onClick={e => e.stopPropagation()}>
        <button className="crm-icon-btn" onClick={() => setMenuOpen(v => !v)}>
          <DotsThreeVertical className="crm-icon" />
        </button>
        {menuOpen && (
          <div className="api-drop-menu">
            <button className="api-drop-item" onClick={() => {
              navigator.clipboard.writeText(k.api_key); setMenuOpen(false);
            }}>
              <Copy className="api-drop-icon" /> Copy key
            </button>
            <button className="api-drop-item" onClick={() => {
              onRenameClick(k); setMenuOpen(false);
            }}>
              <PencilSimple className="api-drop-icon" /> Rename
            </button>
            <button className="api-drop-item api-drop-item--danger" onClick={() => {
              onDelete(k.id); setMenuOpen(false);
            }}>
              <Trash className="api-drop-icon" /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Api() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [renameKey, setRenameKey] = useState(null);

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

  const handleDelete = async (id) => {
    if (!confirm('Delete this API key?')) return;
    const res = await fetch(`${API_BASE}/api/api-keys/${id}`, { method: 'DELETE', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) return alert(data.detail || 'Error');
    load();
    window.dispatchEvent(new CustomEvent('api-keys-changed'));
  };

  const handleRename = (id, name) => {
    setKeys(prev => prev.map(k => k.id === id ? { ...k, name } : k));
    window.dispatchEvent(new CustomEvent('api-keys-changed'));
  };

  const handleSwitch = async (id) => {
    const res = await fetch(`${API_BASE}/api/api-keys/switch`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key_id: id }),
    });
    if (!res.ok) return;
    load();
    window.dispatchEvent(new CustomEvent('api-key-switched'));
    window.dispatchEvent(new CustomEvent('api-keys-changed'));
  };

  const filtered = keys.filter(k =>
    k.name.toLowerCase().includes(search.toLowerCase()) ||
    k.api_key.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); load(); window.dispatchEvent(new CustomEvent('api-keys-changed')); }}
        />
      )}
      {renameKey && (
        <RenameModal
          k={renameKey}
          onClose={() => setRenameKey(null)}
          onRenamed={handleRename}
        />
      )}

      <div className="api-page">
        <div className="api-center">
          <h1 className="api-title">Tokens</h1>

          <div className="api-topbar">
            <div className="api-search-wrap" onClick={() => document.getElementById('api-search').focus()}>
              <MagnifyingGlass className="api-search-icon" />
              <input
                id="api-search"
                className="api-search-input"
                placeholder="Search by name or token…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button className="api-new-btn" onClick={() => setCreateOpen(true)}>
              <Plus className="api-new-btn-icon" /> New API Key
            </button>
          </div>

          <div className="api-list-wrapper">
            <div className="api-list-head">
              <span>Name</span>
              <span>Token</span>
              <span>Last Used</span>
              <span>Created</span>
              <span />
            </div>
            <div className="api-list-card">
              <div className="api-list-scroll">
                {loading ? (
                  <div className="crm-placeholder">Loading…</div>
                ) : error ? (
                  <div className="crm-placeholder" style={{ color: '#e3342f' }}>{error}</div>
                ) : filtered.length === 0 ? (
                  <div className="crm-placeholder">No API keys found</div>
                ) : filtered.reduce((acc, k, i) => {
                    const prev = filtered[i - 1];
                    const showDivider = prev && !prev.is_selected && !k.is_selected;
                    return [
                      ...acc,
                      showDivider && <div key={`div-${k.id}`} className="api-row-divider" />,
                      <ApiRow key={k.id} k={k}
                        onDelete={handleDelete} onRenameClick={setRenameKey} onSwitch={handleSwitch} />
                    ];
                  }, [])
                }
              </div>
            </div>
          </div>
        </div>

        <div className="api-right">
          <div className="api-right-stub" />
        </div>
      </div>
    </>
  );
}

export default Api