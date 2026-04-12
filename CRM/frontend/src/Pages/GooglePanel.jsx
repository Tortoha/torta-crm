import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Copy, Eye, EyeSlash, ArrowSquareOut, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';

function GooglePanel({ projectId, onSaved }) {
  const pq = `?project_id=${projectId}`;
  const [data,      setData]     = useState(null);
  const [clientId,  setClientId] = useState('');
  const [clientSec, setClientSec]= useState('');
  const [enabled,   setEnabled]  = useState(false);
  const [showSec,   setShowSec]  = useState(false);
  const [copied,    setCopied]   = useState(false);
  const [saving,    setSaving]   = useState(false);
  const [deleting,  setDeleting] = useState(false);
  const [err,       setErr]      = useState('');
  const [toast,     setToast]    = useState('');
  const toastTimer = useRef(null);

  const showToast = msg => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  const load = async () => {
    const res  = await fetch(`${API_BASE}/api/oauth-settings${pq}`, { credentials: 'include' });
    const json = await res.json();
    setData(json);
    setClientId(json.google_client_id      || '');
    setClientSec(json.google_client_secret || '');
    setEnabled(json.google_enabled         || false);
  };

  useEffect(() => { load(); }, [projectId]);

  const copyUri = () => {
    navigator.clipboard.writeText(data?.redirect_uri || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/oauth-settings${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          google_client_id:     clientId.trim(),
          google_client_secret: clientSec.trim(),
          google_enabled:       enabled,
        }),
      });
      const json = await res.json();
      if (res.ok) { showToast('Saved'); onSaved?.(enabled); await load(); }
      else        { setErr(json.detail || 'Error saving'); }
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!confirm('Remove Google OAuth settings?')) return;
    setDeleting(true);
    await fetch(`${API_BASE}/api/oauth-settings${pq}`, { method: 'DELETE', credentials: 'include' });
    setDeleting(false);
    onSaved?.(false);
    await load();
  };

  if (!data) return <p className="crm-placeholder">Loading…</p>;

  return (
    <>
      <div className="auth-toggle-row">
        <div>
          <span className="auth-toggle-label">Enable Google OAuth</span>
          <p className="auth-field-hint">Allow store users to sign in with their Google account.</p>
        </div>
        <label className="auth-toggle">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span className="auth-toggle-track" />
        </label>
      </div>

      <div className="auth-sep" />

      <div className="auth-field">
        <label className="auth-label">Client ID</label>
        <p className="auth-field-hint">Found in Google Cloud Console under APIs &amp; Services → Credentials.</p>
        <input className="crm-input" placeholder="xxxxxxxxxx.apps.googleusercontent.com"
          value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">Client Secret</label>
        <p className="auth-field-hint">Keep this private — never expose it in client-side code.</p>
        <div className="auth-secret-wrap">
          <input className="crm-input" type={showSec ? 'text' : 'password'}
            placeholder="GOCSPX-…" value={clientSec}
            onChange={e => setClientSec(e.target.value)} autoComplete="new-password" />
          <button type="button" className="auth-eye-btn" onClick={() => setShowSec(v => !v)}>
            {showSec ? <EyeSlash size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="auth-field">
        <label className="auth-label">Redirect URI</label>
        <p className="auth-field-hint">Add this URL to the Authorised redirect URIs list in Google Cloud Console.</p>
        <div className="auth-uri-row">
          <code className="auth-uri-code">{data.redirect_uri}</code>
          <button className="auth-dns-copy" onClick={copyUri} type="button">
            {copied
              ? <CheckCircle size={14} weight="fill" color="var(--accent)" />
              : <Copy size={14} />}
          </button>
        </div>
      </div>

      {err && <p className="auth-msg auth-msg--err">{err}</p>}

      <div className="auth-actions">
        <button className="crm-submit-btn" onClick={save} disabled={saving} type="button">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {data.configured && (
          <button className="auth-btn-danger" onClick={del} disabled={deleting} type="button">
            <Trash size={15} />
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
        <a href="https://console.cloud.google.com/apis/credentials"
          target="_blank" rel="noopener noreferrer"
          className="auth-btn-link" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
          <ArrowSquareOut size={14} /> Open Google Cloud Console
        </a>
      </div>

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </>
  );
}

export default GooglePanel;
