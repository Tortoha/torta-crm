import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Copy, Eye, EyeSlash, ArrowSquareOut, Trash, Warning } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';

// Apple Sign-In has a different shape from every other generic OAuth
// provider — its `client_secret` is a freshly-signed ES256 JWT, not a static
// string. To keep the per-project credentials table generic, we serialise
// the three Apple-specific inputs (Team ID + Key ID + .p8 private key) as
// JSON into the same `client_secret` column. The backend parses + signs the
// JWT on every token exchange (cached 50 min).
//
// UI mirrors OAuthProviderPanel layout (toggle / fields / redirect URI /
// actions) so the modal feels consistent.

const APPLE_CONSOLE = 'https://developer.apple.com/account/resources/identifiers/list/serviceId';

function isPEM(s) {
  return typeof s === 'string' && s.includes('PRIVATE KEY');
}

export default function ApplePanel({ provider, projectId, onSaved }) {
  const pq = `?project_id=${projectId}`;

  const [data,       setData]       = useState(null);
  const [serviceId,  setServiceId]  = useState('');     // = client_id (e.g. com.tortacrm.signin)
  const [teamId,     setTeamId]     = useState('');     // 10-char from Apple Developer → Membership
  const [keyId,      setKeyId]      = useState('');     // 10-char from Apple Developer → Keys
  const [privateKey, setPrivateKey] = useState('');     // PEM content of the .p8 file
  const [enabled,    setEnabled]    = useState(false);
  const [showKey,    setShowKey]    = useState(false);

  const [copied,   setCopied]   = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err,      setErr]      = useState('');
  const [toast,    setToast]    = useState('');
  const toastTimer = useRef(null);

  const showToast = msg => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  const load = async () => {
    const res  = await fetch(`${API_BASE}/api/auth-providers/apple${pq}`, { credentials: 'include' });
    const json = await res.json();
    setData(json);
    setServiceId(json.client_id || '');
    setEnabled(json.is_enabled || false);
    // client_secret here is the JSON blob (or empty); split it back into 3 fields
    try {
      const blob = JSON.parse(json.client_secret || '{}');
      setTeamId(blob.team_id || '');
      setKeyId(blob.key_id || '');
      setPrivateKey(blob.private_key || '');
    } catch {
      // Legacy or malformed — leave blank, merchant must re-enter
      setTeamId(''); setKeyId(''); setPrivateKey('');
    }
  };

  useEffect(() => { load(); }, [projectId]);

  const copyUri = () => {
    navigator.clipboard.writeText(data?.redirect_uri || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onP8Upload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024) { setErr('.p8 file too large (>8KB)'); return; }
    const text = await f.text();
    if (!isPEM(text)) {
      setErr('That file doesn\'t look like a .p8 (missing -----BEGIN PRIVATE KEY----- header)');
      return;
    }
    setErr('');
    setPrivateKey(text.trim());
    e.target.value = '';   // allow re-upload of the same file
  };

  const save = async () => {
    setSaving(true); setErr('');
    const sid = serviceId.trim();
    const tid = teamId.trim();
    const kid = keyId.trim();
    const pem = privateKey.trim();
    if (!sid)               { setErr('Service ID is required'); setSaving(false); return; }
    if (tid.length !== 10)  { setErr('Team ID must be exactly 10 characters'); setSaving(false); return; }
    if (kid.length !== 10)  { setErr('Key ID must be exactly 10 characters'); setSaving(false); return; }
    if (!isPEM(pem))        { setErr('Private Key must be the PEM contents of the .p8 file'); setSaving(false); return; }

    try {
      const res  = await fetch(`${API_BASE}/api/auth-providers/apple${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:     sid,
          client_secret: JSON.stringify({ team_id: tid, key_id: kid, private_key: pem }),
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
    if (!confirm('Remove Apple Sign-In configuration?')) return;
    setDeleting(true);
    await fetch(`${API_BASE}/api/auth-providers/apple${pq}`, { method: 'DELETE', credentials: 'include' });
    setDeleting(false);
    onSaved?.(false);
    await load();
  };

  if (!data) return <p className="crm-placeholder">Loading…</p>;

  return (
    <>
      <div className="auth-toggle-row">
        <div>
          <span className="auth-toggle-label">Enable Apple Sign-In</span>
          <p className="auth-field-hint">Allow store users to sign in with their Apple ID.</p>
        </div>
        <label className="auth-toggle">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span className="auth-toggle-track" />
        </label>
      </div>

      <div className="auth-sep" />

      <div className="auth-field">
        <label className="auth-label">Service ID</label>
        <p className="auth-field-hint">
          Reverse-DNS identifier of the "Services ID" you created in Apple Developer
          (e.g. <code>com.tortacrm.signin</code>). This is the OAuth client_id.
        </p>
        <input className="crm-input" placeholder="com.tortacrm.signin"
          value={serviceId} onChange={e => setServiceId(e.target.value)} autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">Team ID</label>
        <p className="auth-field-hint">
          10-character ID at top-right of <a href="https://developer.apple.com/account" target="_blank" rel="noopener noreferrer">developer.apple.com → Membership</a>.
        </p>
        <input className="crm-input" placeholder="ABCDE12345" maxLength={10}
          value={teamId} onChange={e => setTeamId(e.target.value)} autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">Key ID</label>
        <p className="auth-field-hint">
          10-character ID of the Sign-In key you created under
          <strong> Apple Developer → Certificates, Identifiers & Profiles → Keys</strong> (with Sign-In with Apple enabled).
        </p>
        <input className="crm-input" placeholder="ABCDE12345" maxLength={10}
          value={keyId} onChange={e => setKeyId(e.target.value)} autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">Private Key (.p8 file contents)</label>
        <p className="auth-field-hint">
          Paste the full PEM contents of the <code>AuthKey_*.p8</code> file you downloaded from Apple
          (you can only download it ONCE) or upload the file directly.
          We use this to sign Apple's ES256 client_secret JWT on every token exchange.
        </p>
        <div className="auth-secret-wrap">
          <textarea className="crm-input apple-p8-textarea"
            rows={6} value={privateKey}
            onChange={e => setPrivateKey(e.target.value)}
            placeholder={`-----BEGIN PRIVATE KEY-----\nMIGT...\n-----END PRIVATE KEY-----`}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12,
                     filter: showKey ? 'none' : 'blur(4px)' }} />
          <button type="button" className="auth-eye-btn" onClick={() => setShowKey(v => !v)}>
            {showKey ? <EyeSlash size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <label className="auth-btn-check apple-p8-upload">
          Upload .p8 file
          <input type="file" accept=".p8,.pem,.txt"
            onChange={onP8Upload} style={{ display: 'none' }} />
        </label>
      </div>

      <div className="auth-field">
        <label className="auth-label">Redirect URI / Return URL</label>
        <p className="auth-field-hint">
          Add this exact URL to your Service ID configuration under
          <strong> Sign In with Apple → Configure → Return URLs</strong>. Apple
          requires HTTPS for this URL — local <code>http://</code> won't be
          accepted by Apple even for testing.
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

      {/* HTTPS warning when redirect URI is HTTP — Apple will reject it. */}
      {data.redirect_uri?.startsWith('http://') && (
        <div className="auth-msg auth-msg--warn apple-https-warn">
          <Warning size={14} weight="fill" />
          Apple rejects <code>http://</code> Return URLs. For local testing, expose
          your dev server via ngrok / Cloudflare Tunnel and update the project's
          Site URL to that HTTPS address.
        </div>
      )}

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
        <a href={APPLE_CONSOLE} target="_blank" rel="noopener noreferrer"
          className="auth-btn-link" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
          <ArrowSquareOut size={14} /> Open Apple Developer
        </a>
      </div>

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </>
  );
}
