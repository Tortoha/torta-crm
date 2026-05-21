import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
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
  const { t } = useTranslation();
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
    if (f.size > 8 * 1024) { setErr(t('authConfig.apple.errFileTooLarge')); return; }
    const text = await f.text();
    if (!isPEM(text)) {
      setErr(t('authConfig.apple.errNotP8'));
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
    if (!sid)               { setErr(t('authConfig.apple.errServiceId')); setSaving(false); return; }
    if (tid.length !== 10)  { setErr(t('authConfig.apple.errTeamId')); setSaving(false); return; }
    if (kid.length !== 10)  { setErr(t('authConfig.apple.errKeyId')); setSaving(false); return; }
    if (!isPEM(pem))        { setErr(t('authConfig.apple.errPrivateKey')); setSaving(false); return; }

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
      if (res.ok) { showToast(t('common.saved')); onSaved?.(enabled); await load(); }
      else        { setErr(json.detail || t('authConfig.errorSaving')); }
    } catch { setErr(t('common.networkError')); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!confirm(t('authConfig.apple.removeConfirm'))) return;
    setDeleting(true);
    await fetch(`${API_BASE}/api/auth-providers/apple${pq}`, { method: 'DELETE', credentials: 'include' });
    setDeleting(false);
    onSaved?.(false);
    await load();
  };

  if (!data) return <p className="crm-placeholder">{t('common.loading')}</p>;

  return (
    <>
      <div className="auth-toggle-row">
        <div>
          <span className="auth-toggle-label">{t('authConfig.apple.enableLabel')}</span>
          <p className="auth-field-hint">{t('authConfig.apple.enableHint')}</p>
        </div>
        <label className="auth-toggle">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span className="auth-toggle-track" />
        </label>
      </div>

      <div className="auth-sep" />

      <div className="auth-field">
        <label className="auth-label">{t('authConfig.apple.serviceId')}</label>
        <p className="auth-field-hint">
          <Trans i18nKey="authConfig.apple.serviceIdHint"><code>com.tortacrm.signin</code></Trans>
        </p>
        <input className="crm-input" placeholder="com.tortacrm.signin"
          value={serviceId} onChange={e => setServiceId(e.target.value)} autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">{t('authConfig.apple.teamId')}</label>
        <p className="auth-field-hint">
          <Trans i18nKey="authConfig.apple.teamIdHint">
            <a href="https://developer.apple.com/account" target="_blank" rel="noopener noreferrer">developer.apple.com → Membership</a>
          </Trans>
        </p>
        <input className="crm-input" placeholder="ABCDE12345" maxLength={10}
          value={teamId} onChange={e => setTeamId(e.target.value)} autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">{t('authConfig.apple.keyId')}</label>
        <p className="auth-field-hint">
          <Trans i18nKey="authConfig.apple.keyIdHint"><strong>x</strong></Trans>
        </p>
        <input className="crm-input" placeholder="ABCDE12345" maxLength={10}
          value={keyId} onChange={e => setKeyId(e.target.value)} autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">{t('authConfig.apple.privateKey')}</label>
        <p className="auth-field-hint">
          <Trans i18nKey="authConfig.apple.privateKeyHint"><code>AuthKey_*.p8</code></Trans>
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
          {t('authConfig.apple.uploadP8')}
          <input type="file" accept=".p8,.pem,.txt"
            onChange={onP8Upload} style={{ display: 'none' }} />
        </label>
      </div>

      <div className="auth-field">
        <label className="auth-label">{t('authConfig.apple.redirectLabel')}</label>
        <p className="auth-field-hint">
          <Trans i18nKey="authConfig.apple.redirectHint">
            <strong>x</strong><code>http://</code>
          </Trans>
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
          <Trans i18nKey="authConfig.apple.httpsWarn"><code>http://</code></Trans>
        </div>
      )}

      {err && <p className="auth-msg auth-msg--err">{err}</p>}

      <div className="auth-actions">
        <button className="crm-submit-btn" onClick={save} disabled={saving} type="button">
          {saving ? t('authConfig.saving') : t('common.save')}
        </button>
        {data.configured && (
          <button className="auth-btn-danger" onClick={del} disabled={deleting} type="button">
            <Trash size={15} />
            {deleting ? t('authConfig.deleting') : t('common.delete')}
          </button>
        )}
        <a href={APPLE_CONSOLE} target="_blank" rel="noopener noreferrer"
          className="auth-btn-link" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
          <ArrowSquareOut size={14} /> {t('authConfig.apple.openConsole')}
        </a>
      </div>

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </>
  );
}
