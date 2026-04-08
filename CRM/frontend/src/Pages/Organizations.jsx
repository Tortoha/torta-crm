import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Plus, FolderSimple, X } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';

const isValidUrl = url => {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
};

function CreateProjectModal({ orgId, onClose, onCreated }) {
  const [newName, setNewName] = useState('');
  const [newUrl,  setNewUrl]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');

  const canSubmit = !!newName.trim() && isValidUrl(newUrl.trim());

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async e => {
    e.preventDefault();
    const name = newName.trim();
    const url  = newUrl.trim();
    if (!name) return setErr('Name is required');
    if (!isValidUrl(url)) return setErr('Enter a valid URL: http://... or https://...');
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/orgs/${orgId}/projects`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, frontend_url: url }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || 'Error'); return; }
      onCreated(data);
      onClose();
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div className="hdr-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hdr-modal">
        <div className="hdr-modal-head">
          <span className="hdr-modal-title">New project</span>
          <button className="hdr-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X className="hdr-modal-close-icon" />
          </button>
        </div>
        <form className="hdr-modal-body" onSubmit={handleSubmit}>
          <div className="hdr-modal-field">
            <h4 className="hdr-modal-label">Name</h4>
            <input
              className="hdr-modal-input"
              placeholder="Project name"
              value={newName}
              onChange={e => { setNewName(e.target.value); setErr(''); }}
              autoFocus
              maxLength={100}
            />
          </div>
          <div className="hdr-modal-field">
            <h4 className="hdr-modal-label">URL</h4>
            <input
              className="hdr-modal-input"
              placeholder="The URL of your website, e.g. https://shop.com"
              value={newUrl}
              onChange={e => { setNewUrl(e.target.value); setErr(''); }}
              autoComplete="off"
            />
          </div>
          {err && <span className="hdr-modal-err">{err}</span>}
          <button className="hdr-modal-submit" type="submit" disabled={saving || !canSubmit}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}

function Organizations() {
  const { org }    = useOutletContext();
  const navigate   = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(false);

  useEffect(() => {
    if (!org) return;
    fetch(`${API_BASE}/api/orgs/${org.id}/projects`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setProjects(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [org]);

  if (loading) return (
    <div id="mask" className="mask">
      <svg><circle cx="50" cy="50" r="40" /></svg>
    </div>
  );

  return (
    <>
      <div className="crm-section-row" style={{ marginBottom: 8 }}>
        <h1 className="crm-page-title" style={{ marginBottom: 0 }}>Projects</h1>
        <button className="crm-add-btn" onClick={() => setModal(true)}>
          <Plus className="crm-add-btn-icon" />
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="crm-placeholder">No projects yet. Create one to get started.</div>
      ) : (
        <div className="crm-cards-list">
          {projects.map(p => (
            <div
              key={p.id}
              className="crm-section-row"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/project/${p.api_key}`)}
            >
              <FolderSimple size={20} style={{ color: '#555', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', marginTop: 2 }}>
                  {p.api_key.slice(0, 16)}…
                </div>
              </div>
              <span style={{ fontSize: 12, color: p.is_active ? '#16a34a' : '#aaa' }}>
                {p.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <CreateProjectModal
          orgId={org.id}
          onClose={() => setModal(false)}
          onCreated={data => setProjects(prev => [data, ...prev])}
        />
      )}
    </>
  );
}

export default Organizations;
