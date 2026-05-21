import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Copy, Eye, EyeSlash, ArrowSquareOut, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';

function GooglePanel({ projectId, onSaved }) {
  const { t } = useTranslation();
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
      if (res.ok) { showToast(t('common.saved')); onSaved?.(enabled); await load(); }
      else        { setErr(json.detail || t('authConfig.errorSaving')); }
    } catch { setErr(t('common.networkError')); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!confirm(t('authConfig.google.removeConfirm'))) return;
    setDeleting(true);
    await fetch(`${API_BASE}/api/oauth-settings${pq}`, { method: 'DELETE', credentials: 'include' });
    setDeleting(false);
    onSaved?.(false);
    await load();
  };

  if (!data) return <p className="crm-placeholder">{t('common.loading')}</p>;

  return (
    <>
      <div className="auth-toggle-row">
        <div>
          <span className="auth-toggle-label">{t('authConfig.google.enableLabel')}</span>
          <p className="auth-field-hint">{t('authConfig.google.enableHint')}</p>
        </div>
        <label className="auth-toggle">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span className="auth-toggle-track" />
        </label>
      </div>

      <div className="auth-sep" />

      <div className="auth-field">
        <label className="auth-label">{t('authConfig.clientId')}</label>
        <p className="auth-field-hint">{t('authConfig.google.clientIdHint')}</p>
        <input className="crm-input" placeholder="xxxxxxxxxx.apps.googleusercontent.com"
          value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off" />
      </div>

      <div className="auth-field">
        <label className="auth-label">{t('authConfig.clientSecret')}</label>
        <p className="auth-field-hint">{t('authConfig.clientSecretHint')}</p>
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
        <label className="auth-label">{t('authConfig.redirectUri')}</label>
        <p className="auth-field-hint">{t('authConfig.google.redirectHint')}</p>
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
          {saving ? t('authConfig.saving') : t('common.save')}
        </button>
        {data.configured && (
          <button className="auth-btn-danger" onClick={del} disabled={deleting} type="button">
            <Trash size={15} />
            {deleting ? t('authConfig.deleting') : t('common.delete')}
          </button>
        )}
        <a href="https://console.cloud.google.com/apis/credentials"
          target="_blank" rel="noopener noreferrer"
          className="auth-btn-link" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
          <ArrowSquareOut size={14} /> {t('authConfig.google.openConsole')}
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
