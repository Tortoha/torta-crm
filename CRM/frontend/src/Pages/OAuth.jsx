import { useEffect, useState } from 'react';
import { Copy, CheckCircle, ArrowSquareOut, Trash, Eye, EyeSlash } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { useOutletContext } from 'react-router-dom';
import '../Style/OAuth.css';

const GoogleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 48 48">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.29-8.16 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

export default function OAuth() {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;

  const [data, setData]           = useState(null);
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [clientId, setClientId]   = useState('');
  const [clientSecret, setSecret] = useState('');
  const [enabled, setEnabled]     = useState(false);
  const [copied, setCopied]       = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [err, setErr]             = useState('');
  const [success, setSuccess]     = useState('');

  const load = async () => {
    const res  = await fetch(`${API_BASE}/api/oauth-settings${pq}`, { credentials: 'include' });
    const json = await res.json();
    setData(json);
    setClientId(json.google_client_id || '');
    setSecret(json.google_client_secret || '');
    setEnabled(json.google_enabled || false);
  };

  useEffect(() => { load(); }, [projectId]);

  const copyUri = () => {
    if (!data?.redirect_uri) return;
    navigator.clipboard.writeText(data.redirect_uri);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async () => {
    setSaving(true); setErr(''); setSuccess('');
    try {
      const res  = await fetch(`${API_BASE}/api/oauth-settings${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          google_client_id:     clientId.trim(),
          google_client_secret: clientSecret.trim(),
          google_enabled:       enabled,
        }),
      });
      const json = await res.json();
      if (res.ok) { setSuccess('Saved!'); await load(); }
      else        { setErr(json.detail || 'Error saving'); }
    } catch { setErr('Network error'); }
    setSaving(false);
  };

  const del = async () => {
    if (!confirm('Remove Google OAuth settings?')) return;
    setDeleting(true);
    await fetch(`${API_BASE}/api/oauth-settings${pq}`, { method: 'DELETE', credentials: 'include' });
    setDeleting(false);
    setSuccess('');
    await load();
  };

  if (!data) return <div className="oauth-page"><p className="crm-placeholder">Loading…</p></div>;

  return (
    <div className="oauth-page">
      <h1 className="crm-page-title">Auth Providers</h1>
      <p className="oauth-subtitle">
        Allow your store customers to sign in with third-party providers.
      </p>

      <div className="oauth-provider-card">
        {/* Header */}
        <div className="oauth-provider-header">
          <div className="oauth-provider-info">
            <GoogleIcon />
            <div>
              <div className="oauth-provider-name">Google</div>
              <div className="oauth-provider-desc">Sign in with Google account</div>
            </div>
          </div>
          <label className="oauth-toggle">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            <span className="oauth-toggle-track" />
          </label>
        </div>

        {/* Body */}
        <div className="oauth-provider-body">
          <div className="oauth-field-row">
            <label className="oauth-label">Client ID (for OAuth)</label>
            <input
              className="crm-input"
              placeholder="xxxxxxxxxx.apps.googleusercontent.com"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="oauth-field-row">
            <label className="oauth-label">Client Secret (for OAuth)</label>
            <div className="oauth-secret-wrap">
              <input
                className="crm-input"
                type={showSecret ? 'text' : 'password'}
                placeholder="GOCSPX-…"
                value={clientSecret}
                onChange={e => setSecret(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="dns-copy-btn oauth-eye-btn"
                onClick={() => setShowSecret(v => !v)}
                title={showSecret ? 'Hide' : 'Show'}
              >
                {showSecret ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="oauth-field-row">
            <label className="oauth-label">
              Redirect URL — add this to your Google Cloud Console
            </label>
            <div className="oauth-redirect-row">
              <code className="oauth-redirect-uri">{data.redirect_uri}</code>
              <button className="dns-copy-btn" onClick={copyUri} title="Copy">
                {copied
                  ? <CheckCircle size={16} weight="fill" color="#27ae60" />
                  : <Copy size={16} />}
              </button>
            </div>
          </div>

          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
            className="oauth-console-link"
          >
            <ArrowSquareOut size={14} />
            Open Google Cloud Console
          </a>

          {err     && <p className="email-msg email-msg--err">{err}</p>}
          {success && <p className="email-msg email-msg--ok">{success}</p>}

          <div className="email-form-actions">
            <button className="crm-submit-btn" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {data.configured && (
              <button
                className="crm-icon-btn crm-icon-btn--danger"
                onClick={del}
                disabled={deleting}
                title="Remove"
              >
                <Trash className="crm-icon--sm" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
