import { useEffect, useState } from 'react';
import { Globe, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { useOutletContext } from 'react-router-dom';
import '../Style/UrlConfig.css';

export default function UrlConfig() {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;

  // ── Site URL ──
  const [siteUrl, setSiteUrl]       = useState('');
  const [original, setOriginal]     = useState('');
  const [saving, setSaving]         = useState(false);
  const [siteErr, setSiteErr]       = useState('');
  const [siteOk, setSiteOk]         = useState('');

  // ── Redirect URLs ──
  const [redirectUrls, setRedirectUrls] = useState([]);
  const [newUrl, setNewUrl]             = useState('');
  const [addErr, setAddErr]             = useState('');
  const [adding, setAdding]             = useState(false);
  const [deletingId, setDeletingId]     = useState(null);

  const loadSite = async () => {
    const res  = await fetch(`${API_BASE}/api/url-config${pq}`, { credentials: 'include' });
    const json = await res.json();
    setSiteUrl(json.frontend_url || '');
    setOriginal(json.frontend_url || '');
  };

  const loadRedirects = async () => {
    const res  = await fetch(`${API_BASE}/api/redirect-urls${pq}`, { credentials: 'include' });
    const json = await res.json();
    setRedirectUrls(json.urls || []);
  };

  useEffect(() => {
    loadSite(); loadRedirects();
  }, [projectId]);

  // ── Save Site URL ──
  const saveSite = async () => {
    setSaving(true); setSiteErr(''); setSiteOk('');
    try {
      const res  = await fetch(`${API_BASE}/api/url-config${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontend_url: siteUrl.trim() }),
      });
      const json = await res.json();
      if (res.ok) { setSiteOk('Saved!'); setOriginal(siteUrl.trim()); }
      else        { setSiteErr(json.detail || 'Error saving'); }
    } catch { setSiteErr('Network error'); }
    setSaving(false);
  };

  // ── Add Redirect URL ──
  const addUrl = async () => {
    const url = newUrl.trim();
    if (!url) return;
    setAdding(true); setAddErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/redirect-urls${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (res.ok) { setNewUrl(''); await loadRedirects(); }
      else        { setAddErr(json.detail || 'Error adding URL'); }
    } catch { setAddErr('Network error'); }
    setAdding(false);
  };

  // ── Delete Redirect URL ──
  const deleteUrl = async (id) => {
    setDeletingId(id);
    try {
      await fetch(`${API_BASE}/api/redirect-urls/${id}${pq}`, {
        method: 'DELETE', credentials: 'include',
      });
      await loadRedirects();
    } catch {}
    setDeletingId(null);
  };

  const siteChanged = siteUrl.trim() !== original;

  return (
    <div className="urlcfg-page">
      <h1 className="crm-page-title">URL Configuration</h1>
      <p className="urlcfg-subtitle">
        Configure site URL and redirect URLs for authentication.
      </p>

      {/* ── Site URL ── */}
      <h2 className="urlcfg-section-title">Site URL</h2>
      <div className="urlcfg-card">
        <div className="urlcfg-card-row">
          <div className="urlcfg-card-desc">
            <div className="urlcfg-label">Site URL</div>
            <p className="urlcfg-hint">
              The main URL of your storefront. Used as the default redirect after login,
              sign-up, and password reset. Also used in email templates.
            </p>
          </div>
          <div className="urlcfg-card-input">
            <input
              className="crm-input"
              placeholder="https://mystore.com"
              value={siteUrl}
              onChange={e => { setSiteUrl(e.target.value); setSiteErr(''); setSiteOk(''); }}
              autoComplete="off"
            />
          </div>
        </div>
        {siteErr && <p className="urlcfg-msg urlcfg-msg--err">{siteErr}</p>}
        {siteOk  && <p className="urlcfg-msg urlcfg-msg--ok">{siteOk}</p>}
        <div className="urlcfg-card-footer">
          <button
            className="crm-submit-btn"
            onClick={saveSite}
            disabled={saving || !siteChanged}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* ── Redirect URLs ── */}
      <h2 className="urlcfg-section-title">Redirect URLs</h2>
      <p className="urlcfg-subtitle">
        URLs that auth providers are permitted to redirect to after authentication.
        Wildcards are allowed, for example, <code>https://*.domain.com</code>
      </p>

      <div className="urlcfg-card">
        {/* Add URL row */}
        <div className="urlcfg-add-row">
          <input
            className="crm-input"
            placeholder="https://mystore.com/auth/callback"
            value={newUrl}
            onChange={e => { setNewUrl(e.target.value); setAddErr(''); }}
            onKeyDown={e => e.key === 'Enter' && addUrl()}
            autoComplete="off"
          />
          <button
            className="urlcfg-add-btn"
            onClick={addUrl}
            disabled={adding || !newUrl.trim()}
          >
            {adding ? 'Adding…' : 'Add URL'}
          </button>
        </div>
        {addErr && <p className="urlcfg-msg urlcfg-msg--err" style={{ padding: '0 16px 12px' }}>{addErr}</p>}

        {/* List */}
        {redirectUrls.length > 0 && (
          <div className="urlcfg-list">
            {redirectUrls.map(row => (
              <div key={row.id} className="urlcfg-list-row">
                <Globe size={16} className="urlcfg-list-icon" />
                <span className="urlcfg-list-url">{row.url}</span>
                <button
                  className="crm-icon-btn crm-icon-btn--danger"
                  onClick={() => deleteUrl(row.id)}
                  disabled={deletingId === row.id}
                  title="Remove"
                >
                  <Trash className="crm-icon--sm" />
                </button>
              </div>
            ))}
            <div className="urlcfg-total">Total URLs: {redirectUrls.length}</div>
          </div>
        )}
      </div>
    </div>
  );
}
