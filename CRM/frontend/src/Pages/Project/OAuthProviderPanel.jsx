import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Copy, Eye, EyeSlash, ArrowSquareOut, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';

// Per-provider docs link & sample placeholders. Keep keys in sync with PROVIDERS in
// Authentication.jsx and the OAUTH_PROVIDERS dict in External/main.py.
const PROVIDER_INFO = {
  github:    { console: 'https://github.com/settings/developers',                                               id_ph: 'Iv1.…',          sec_ph: 'Client secret', console_label: 'Open GitHub Developer Settings' },
  discord:   { console: 'https://discord.com/developers/applications',                                          id_ph: '123456789012345678', sec_ph: 'Client secret', console_label: 'Open Discord Developer Portal' },
  facebook:  { console: 'https://developers.facebook.com/apps/',                                                id_ph: 'App ID',         sec_ph: 'App secret',    console_label: 'Open Facebook for Developers' },
  gitlab:    { console: 'https://gitlab.com/-/user_settings/applications',                                      id_ph: 'Application ID', sec_ph: 'Secret',        console_label: 'Open GitLab Applications' },
  bitbucket: { console: 'https://bitbucket.org/account/settings/app-passwords/',                                id_ph: 'Key',            sec_ph: 'Secret',        console_label: 'Open Bitbucket Settings' },
  linkedin:  { console: 'https://www.linkedin.com/developers/apps',                                             id_ph: 'Client ID',      sec_ph: 'Primary Client Secret', console_label: 'Open LinkedIn Developers' },
  twitch:    { console: 'https://dev.twitch.tv/console/apps',                                                   id_ph: 'Client ID',      sec_ph: 'Client Secret', console_label: 'Open Twitch Developer Console' },
  spotify:   { console: 'https://developer.spotify.com/dashboard',                                              id_ph: 'Client ID',      sec_ph: 'Client secret', console_label: 'Open Spotify Developer Dashboard' },
  slack:     { console: 'https://api.slack.com/apps',                                                           id_ph: 'Client ID',      sec_ph: 'Client Secret', console_label: 'Open Slack API' },
  notion:    { console: 'https://www.notion.so/my-integrations',                                                id_ph: 'OAuth Client ID',sec_ph: 'OAuth Client Secret', console_label: 'Open Notion Integrations' },
  figma:     { console: 'https://www.figma.com/developers/apps',                                                id_ph: 'Client ID',      sec_ph: 'Client secret', console_label: 'Open Figma Developer Apps' },
  zoom:      { console: 'https://marketplace.zoom.us/develop/create',                                           id_ph: 'Client ID',      sec_ph: 'Client Secret', console_label: 'Open Zoom Marketplace' },
  azure:     { console: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',    id_ph: 'Application (client) ID', sec_ph: 'Client secret value', console_label: 'Open Azure Portal' },
  apple:     { console: 'https://developer.apple.com/account/resources/identifiers/list/serviceId',             id_ph: 'Service ID',     sec_ph: 'Client Secret JWT',  console_label: 'Open Apple Developer' },
  x:         { console: 'https://developer.twitter.com/en/portal/projects-and-apps',                            id_ph: 'OAuth 2.0 Client ID', sec_ph: 'OAuth 2.0 Client Secret', console_label: 'Open X Developer Portal' },
  kakao:     { console: 'https://developers.kakao.com/console/app',                                             id_ph: 'REST API key',   sec_ph: 'Client secret', console_label: 'Open Kakao Developers' },
  keycloak:  { console: '',                                                                                     id_ph: 'Client ID',      sec_ph: 'Client Secret', console_label: '' },
};

function OAuthProviderPanel({ provider, projectId, onSaved }) {
  const pq = `?project_id=${projectId}`;
  const info = PROVIDER_INFO[provider.id] || {};

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
    const res  = await fetch(`${API_BASE}/api/auth-providers/${provider.id}${pq}`, { credentials: 'include' });
    const json = await res.json();
    setData(json);
    setClientId(json.client_id     || '');
    setClientSec(json.client_secret|| '');
    setEnabled(json.is_enabled     || false);
  };

  useEffect(() => { load(); }, [projectId, provider.id]);

  const copyUri = () => {
    navigator.clipboard.writeText(data?.redirect_uri || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/auth-providers/${provider.id}${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:     clientId.trim(),
          client_secret: clientSec.trim(),
          is_enabled:    enabled,
        }),
      });
      const json = await res.json();
      if (res.ok) { showToast('Saved'); onSaved?.(enabled); await load(); }
      else        { setErr(json.detail || 'Error saving'); }
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!confirm(`Remove ${provider.label} OAuth settings?`)) return;
    setDeleting(true);
    await fetch(`${API_BASE}/api/auth-providers/${provider.id}${pq}`, { method: 'DELETE', credentials: 'include' });
    setDeleting(false);
    onSaved?.(false);
    await load();
  };

  if (!data) return <p className="crm-placeholder">Loading…</p>;

  return (
    <>
      <div className="auth-toggle-row">
        <div>
          <span className="auth-toggle-label">Enable {provider.label} OAuth</span>
          <p className="auth-field-hint">Allow store users to sign in with their {provider.label} account.</p>
        </div>
        <label className="auth-toggle">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span className="auth-toggle-track" />
        </label>
      </div>

      <div className="auth-sep" />

      <div className="auth-field">
        <label className="auth-label">Client ID</label>
        <p className="auth-field-hint">From the {provider.label} developer console for your registered OAuth app.</p>
        <input className="crm-input" placeholder={info.id_ph || 'Client ID'}
          value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">Client Secret</label>
        <p className="auth-field-hint">Keep this private — never expose it in client-side code.</p>
        <div className="auth-secret-wrap">
          <input className="crm-input" type={showSec ? 'text' : 'password'}
            placeholder={info.sec_ph || 'Client Secret'} value={clientSec}
            onChange={e => setClientSec(e.target.value)} autoComplete="new-password" />
          <button type="button" className="auth-eye-btn" onClick={() => setShowSec(v => !v)}>
            {showSec ? <EyeSlash size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="auth-field">
        <label className="auth-label">Redirect URI / Callback URL</label>
        <p className="auth-field-hint">
          Add this exact URL to the list of authorised redirect URIs in the {provider.label} developer console.
        </p>
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
        {info.console && (
          <a href={info.console} target="_blank" rel="noopener noreferrer"
            className="auth-btn-link" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
            <ArrowSquareOut size={14} /> {info.console_label || `Open ${provider.label} Console`}
          </a>
        )}
      </div>

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </>
  );
}

export default OAuthProviderPanel