import { useState, useRef, useEffect } from 'react';
import { Copy, Check, PencilSimple, X } from '@phosphor-icons/react';
import { useProject } from '../context/ProjectContext.jsx';
import { API_BASE } from '../api.js';
import '../Style/Api.css';

function RenameModal({ project, onClose, onRenamed }) {
  const [name, setName]     = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || n === project.name) { onClose(); return; }
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/projects/${project.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || 'Error'); return; }
      onRenamed(data.name);
      onClose();
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="api-modal-backdrop" onClick={onClose}>
      <div className="api-modal" onClick={e => e.stopPropagation()}>
        <div className="api-modal-header">
          <span className="api-modal-title">Rename Project</span>
          <button className="crm-icon-btn" onClick={onClose}><X className="crm-icon" /></button>
        </div>
        <form className="api-modal-form" onSubmit={handleSave}>
          <div className="api-modal-row">
            <input
              className="api-modal-input"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
              autoFocus
            />
            <button className="api-modal-btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {err && <span className="crm-form-error" style={{ padding: '0 4px' }}>{err}</span>}
        </form>
      </div>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button className="crm-icon-btn" onClick={copy} title="Copy">
      {copied ? <Check className="crm-icon crm-icon--success" /> : <Copy className="crm-icon" />}
    </button>
  );
}

function Api() {
  const { projectId, project: ctxProject } = useProject();
  const [project, setProject] = useState(ctxProject);
  const [renameOpen, setRenameOpen] = useState(false);

  return (
    <>
      {renameOpen && (
        <RenameModal
          project={project}
          onClose={() => setRenameOpen(false)}
          onRenamed={(name) => setProject(p => ({ ...p, name }))}
        />
      )}

      <div className="api-page">
        <div className="api-center">
          <h1 className="api-title">API Key</h1>

          <div className="api-list-wrapper">
            <div className="api-list-card">
              <div className="api-list-scroll">
                <div className="api-row api-row--active">
                  <span className="api-row-name">{project.name}</span>
                  <div className="api-row-key-col">
                    <span className="api-key-badge">{project.api_key}</span>
                  </div>
                  <div className="api-row-actions" onClick={e => e.stopPropagation()}>
                    <CopyButton text={project.api_key} />
                    <button className="crm-icon-btn" onClick={() => setRenameOpen(true)} title="Rename project">
                      <PencilSimple className="crm-icon" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p style={{ marginTop: 16, fontSize: 13, color: '#888' }}>
            Use this key in your storefront with the <code>torta-js</code> SDK.
          </p>
        </div>

        <div className="api-right">
          <div className="api-right-stub" />
        </div>
      </div>
    </>
  );
}

export default Api
