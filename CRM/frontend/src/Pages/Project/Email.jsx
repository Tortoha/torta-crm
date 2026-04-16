import { useEffect, useState } from 'react';
import { Copy, CheckCircle, Warning, ArrowClockwise, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { useOutletContext } from 'react-router-dom';
import '../../Style/Email.css';

// ── DNS record row ────────────────────────────────────────────────────────────
function DnsRow({ type, host, value, status }) {
  const [copied, setCopied] = useState(null);
  const copy = (field, text) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className={`dns-row dns-row--${status}`}>
      <div className="dns-cell">
        <span className="dns-badge">{type}</span>
      </div>
      <div className="dns-cell">
        <code>{host}</code>
        <button className="dns-copy-btn" onClick={() => copy('host', host)} title="Copy">
          {copied === 'host' ? <CheckCircle className="crm-icon--sm" /> : <Copy className="crm-icon--sm" />}
        </button>
      </div>
      <div className="dns-cell">
        <span className="dns-value-text">{value}</span>
        <button className="dns-copy-btn" onClick={() => copy('value', value)} title="Copy">
          {copied === 'value' ? <CheckCircle className="crm-icon--sm" /> : <Copy className="crm-icon--sm" />}
        </button>
      </div>
      <div className="dns-cell">
        {status === 'ok'      && <span className="dns-status dns-status--ok"><CheckCircle /> Verified</span>}
        {status === 'pending' && <span className="dns-status dns-status--pending"><Warning /> Pending</span>}
        {status === 'unknown' && <span className="dns-status dns-status--unknown">—</span>}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function Email() {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;

  const [data, setData]           = useState(null);
  const [saving, setSaving]       = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [err, setErr]             = useState('');
  const [success, setSuccess]     = useState('');

  const [domain,    setDomain]    = useState('');
  const [fromName,  setFromName]  = useState('');
  const [fromEmail, setFromEmail] = useState('');

  const load = async () => {
    setData(null);
    try {
      const res  = await fetch(`${API_BASE}/api/email-domain${pq}`, { credentials: 'include' });
      const json = await res.json();
      setData(json);
      if (json.configured) {
        setDomain(json.domain);
        setFromName(json.from_name);
        setFromEmail(json.from_email);
      }
    } catch { setData({ configured: false }); }
  };

  useEffect(() => { load(); }, [projectId]);

  const handleSave = async (e) => {
    e.preventDefault();
    setErr(''); setSuccess('');
    setSaving(true);
    try {
      const res  = await fetch(`${API_BASE}/api/email-domain${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, from_name: fromName, from_email: fromEmail }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.detail || 'Error'); return; }
      setData(json);
      setVerifyResult(null);
      setSuccess('Saved. Add the DNS records below to your domain registrar, then click Check.');
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  const handleVerify = async () => {
    setVerifying(true); setErr(''); setSuccess('');
    try {
      const res  = await fetch(`${API_BASE}/api/email-domain/verify${pq}`, {
        method: 'POST', credentials: 'include',
      });
      const json = await res.json();
      setVerifyResult({ dkim: json.dkim_ok, spf: json.spf_ok, dmarc: json.dmarc_ok });
      if (json.all_ok) { setSuccess('Domain fully verified — DKIM and SPF are active.'); load(); }
      else {
        const parts = [];
        if (!json.dkim_ok) parts.push('DKIM not found');
        if (!json.spf_ok)  parts.push('SPF not found');
        setErr(parts.join(' · ') + '. Add the records and try again (DNS may take up to 24h).');
      }
    } catch { setErr('Network error'); }
    finally { setVerifying(false); }
  };

  const handleDelete = async () => {
    if (!confirm('Remove this email domain? DKIM keys will be deleted.')) return;
    setDeleting(true);
    try {
      await fetch(`${API_BASE}/api/email-domain${pq}`, { method: 'DELETE', credentials: 'include' });
      setData({ configured: false });
      setDomain(''); setFromName(''); setFromEmail('');
      setVerifyResult(null); setSuccess(''); setErr('');
    } catch { setErr('Network error'); }
    finally { setDeleting(false); }
  };

  // Map label → verification status
  const recordStatus = (label) => {
    if (!verifyResult) {
      if (label === 'DKIM')  return data?.dkim_ok  ? 'ok' : 'unknown';
      if (label === 'SPF')   return data?.spf_ok   ? 'ok' : 'unknown';
      if (label === 'DMARC') return data?.dmarc_ok ? 'ok' : 'unknown';
      return 'unknown';
    }
    if (label === 'DKIM')  return verifyResult.dkim  ? 'ok' : 'pending';
    if (label === 'SPF')   return verifyResult.spf   ? 'ok' : 'pending';
    if (label === 'DMARC') return verifyResult.dmarc ? 'ok' : 'pending';
    return 'unknown';
  };

  if (data === null) return <div className="crm-page-title">Loading…</div>;

  const isVerified = data.dkim_ok && data.spf_ok;

  return (
    <div className="email-page">
      <h1 className="crm-page-title">Email Domain</h1>

      <section className="crm-section">
        <h2 className="crm-section-title">Sending settings</h2>
        <p className="email-hint">
          Configure your own domain so your store sends emails from your address instead of support@tortacrm.com.
        </p>
        <form className="email-form" onSubmit={handleSave}>
          <div className="email-form-row">
            <label className="email-label">Domain</label>
            <input
              className="crm-input"
              placeholder="yourdomain.com"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              required
            />
          </div>
          <div className="email-form-row">
            <label className="email-label">From name</label>
            <input
              className="crm-input"
              placeholder="My Store"
              value={fromName}
              onChange={e => setFromName(e.target.value)}
              required
              maxLength={100}
            />
          </div>
          <div className="email-form-row">
            <label className="email-label">From email</label>
            <input
              className="crm-input"
              placeholder="noreply@yourdomain.com"
              value={fromEmail}
              onChange={e => setFromEmail(e.target.value)}
              required
              type="email"
            />
          </div>

          {err     && <p className="email-msg email-msg--err">{err}</p>}
          {success && <p className="email-msg email-msg--ok">{success}</p>}

          <div className="email-form-actions">
            <button className="crm-submit-btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {data.configured && (
              <button
                type="button"
                className="crm-icon-btn crm-icon-btn--danger"
                onClick={handleDelete}
                disabled={deleting}
                title="Remove domain"
              >
                <Trash className="crm-icon" />
              </button>
            )}
          </div>
        </form>
      </section>

      {data.configured && (
        <section className="crm-section2">
          <div className="crm-section-row">
            <h2 className="crm-section-title">
              DNS records
              {isVerified
                ? <span className="email-verified-badge"><CheckCircle /> Verified</span>
                : <span className="email-pending-badge"><Warning /> Not verified</span>
              }
            </h2>
            <button className="crm-add-btn" onClick={handleVerify} disabled={verifying}>
              <ArrowClockwise className="crm-icon--sm" />
              {verifying ? 'Checking…' : 'Check DNS'}
            </button>
          </div>

          <p className="email-hint">
            Add these records to your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.).
            DNS propagation can take up to 24 hours.
          </p>

          <div className="dns-table">
            <div className="dns-header">
              <span>Type</span><span>Host</span><span>Value</span><span>Status</span>
            </div>
            {(data.dns_records || []).map((rec, i) => (
              <DnsRow
                key={i}
                type={rec.type}
                host={rec.host}
                value={rec.value}
                status={recordStatus(rec.label)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default Email;
