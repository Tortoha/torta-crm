import { useState, useEffect } from 'react';
import { Copy, Check, PencilSimple, X, Eye, EyeSlash } from '@phosphor-icons/react';
import { useOutletContext } from 'react-router-dom';
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

function KeyRow({ label, badge, value, masked, actions, hint }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        {badge && (
          <span style={{
            fontSize: 11, fontWeight: 500, padding: '2px 8px',
            borderRadius: 999, background: 'var(--bg)', color: 'var(--muted)',
          }}>{badge}</span>
        )}
      </div>
      <div className="api-row api-row--active" style={{ cursor: 'default' }}>
        <div className="api-row-key-col" style={{ flex: 1 }}>
          <span className="api-key-badge" style={{ fontFamily: 'monospace', fontSize: 13 }}>
            {masked ? '•'.repeat(16) + value.slice(-6) : value}
          </span>
        </div>
        <div className="api-row-actions" onClick={e => e.stopPropagation()}>
          {actions}
        </div>
      </div>
      {hint && <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)' }}>{hint}</p>}
    </div>
  );
}

function Api() {
  const { project: ctxProject } = useOutletContext();
  const [project, setProject]   = useState(ctxProject);
  const [renameOpen, setRenameOpen] = useState(false);
  const [showPk, setShowPk]     = useState(false);

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
            <h1 className="api-title" style={{ margin: 0 }}>API Keys</h1>
            <button className="crm-icon-btn" onClick={() => setRenameOpen(true)} title="Rename project">
              <PencilSimple className="crm-icon" />
            </button>
          </div>

          <div className="api-list-wrapper">
            <div className="api-list-card" style={{ padding: '20px 24px' }}>

              <KeyRow
                label="Public Key"
                badge="in URL"
                value={project.api_key}
                masked={false}
                hint="Appears in the storefront URL. Safe to expose — identifies your store."
                actions={<CopyButton text={project.api_key} />}
              />

              <div style={{ height: 1, background: 'var(--bg)', margin: '4px 0 20px' }} />

              <KeyRow
                label="Publishable Key"
                badge="header"
                value={project.publishable_key || '—'}
                masked={!showPk}
                hint="Sent as X-Publishable-Key header by torta-js on every request. Prevents direct URL access."
                actions={
                  <>
                    <button
                      className="crm-icon-btn"
                      onClick={() => setShowPk(v => !v)}
                      title={showPk ? 'Hide' : 'Reveal'}
                    >
                      {showPk ? <EyeSlash className="crm-icon" /> : <Eye className="crm-icon" />}
                    </button>
                    <CopyButton text={project.publishable_key || ''} />
                  </>
                }
              />

            </div>
          </div>

          <div style={{ marginTop: 24, background: 'var(--card)', borderRadius: 16, padding: '16px 20px' }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600 }}>Usage in api.js</p>
            <pre style={{ margin: 0, fontSize: 12, color: '#555', overflowX: 'auto', lineHeight: 1.6 }}>{
`import { createClient } from "torta-js";

const API_URL = "http://localhost:8000/${project.api_key}";
const API_PK  = "${project.publishable_key || 'pk_...'}";

export const client = createClient(API_URL, API_PK);`
            }</pre>
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
