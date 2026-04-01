import { useEffect, useState } from 'react';
import { Copy, CheckCircle, Warning, ArrowClockwise, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import '../Style/Email.css';

// ── DNS record row ────────────────────────────────────────────────────────────
function DnsRow({ type, host, value, status }) {
  const [copied, setCopied] = useState(false);
  const copy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`dns-row dns-row--${status}`}>
      <div className="dns-cell dns-cell--type">
        <span className="dns-badge">{type}</span>
      </div>
      <div className="dns-cell dns-cell--host">
        <code>{host}</code>
        <button className="dns-copy-btn" onClick={() => copy(host)} title="Copy">
          <Copy className="crm-icon--sm" />
        </button>
      </div>
      <div className="dns-cell dns-cell--value">
        <code className="dns-value-text">{value}</code>
        <button className="dns-copy-btn" onClick={() => copy(value)} title="Copy">
          {copied ? <CheckCircle className="crm-icon--sm" /> : <Copy className="crm-icon--sm" />}
        </button>
      </div>
      <div className="dns-cell dns-cell--status">
        {status === 'ok'      && <span className="dns-status dns-status--ok"><CheckCircle /> Verified</span>}
        {status === 'pending' && <span className="dns-status dns-status--pending"><Warning /> Pending</span>}
        {status === 'unknown' && <span className="dns-status dns-status--unknown">—</span>}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function Email() {
  const [data, setData]         = useState(null);   // null = loading
  const [saving, setSaving]     = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [err, setErr]           = useState('');
  const [success, setSuccess]   = useState('');

  // form state
  const [domain,    setDomain]    = useState('');
  const [fromName,  setFromName]  = useState('');
  const [fromEmail, setFromEmail] = useState('');

  const load = async () => {
    setData(null);
    try {
      const res  = await fetch(`${API_BASE}/api/email-domain`, { credentials: 'include' });
      const json = await res.json();
      setData(json);
      if (json.configured) {
        setDomain(json.domain);
        setFromName(json.from_name);
        setFromEmail(json.from_email);
      }
    } catch { setData({ configured: false }); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    window.addEventListener('api-key-switched', load);
    return () => window.removeEventListener('api-key-switched', load);
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setErr(''); setSuccess('');
    setSaving(true);
    try {
      const res  = await fetch(`${API_BASE}/api/email-domain`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, from_name: fromName, from_email: fromEmail }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.detail || 'Error'); return; }
      setData(json);
      setVerifyResult(null);
      setSuccess('Saved. Now add the DNS records below.');
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  const handleVerify = async () => {
    setVerifying(true); setErr(''); setSuccess('');
    try {
      const res  = await fetch(`${API_BASE}/api/email-domain/verify`, {
        method: 'POST', credentials: 'include',
      });
      const json = await res.json();
      setVerifyResult(json.results);
      if (json.all_ok) { setSuccess('Domain verified!'); load(); }
      else setErr('Some records are missing. Add them and try again.');
    } catch { setErr('Network error'); }
    finally { setVerifying(false); }
  };

  const handleDelete = async () => {
    if (!confirm('Remove this domain configuration?')) return;
    setDeleting(true);
    try {
      await fetch(`${API_BASE}/api/email-domain`, { method: 'DELETE', credentials: 'include' });
      setData({ configured: false });
      setDomain(''); setFromName(''); setFromEmail('');
      setVerifyResult(null); setSuccess(''); setErr('');
    } catch { setErr('Network error'); }
    finally { setDeleting(false); }
  };

  const dnsStatus = (key) => {
    if (!verifyResult) return 'unknown';
    return verifyResult[key] ? 'ok' : 'pending';
  };

  if (data === null) return (
    <div className="crm-page-title">Loading…</div>
  );

  return (
    <div className="email-page">
      <h1 className="crm-page-title">Email Domain</h1>

      {/* ── Settings form ── */}
      <section className="crm-section">
        <h2 className="crm-section-title">Sending settings</h2>
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

      {/* ── DNS records ── */}
      {data.configured && (
        <section className="crm-section">
          <div className="crm-section-row">
            <h2 className="crm-section-title">
              DNS records
              {data.is_verified
                ? <span className="email-verified-badge"><CheckCircle /> Verified</span>
                : <span className="email-pending-badge"><Warning /> Not verified</span>
              }
            </h2>
            <button
              className="crm-add-btn"
              onClick={handleVerify}
              disabled={verifying}
            >
              <ArrowClockwise className="crm-icon--sm" />
              {verifying ? 'Checking…' : 'Check DNS'}
            </button>
          </div>

          <p className="email-hint">
            Add these records to your DNS provider, then click <strong>Check DNS</strong>.<br />
            <strong>Important:</strong> in the <em>Host</em> field enter only the part shown in <strong>Enter in DNS</strong> — your provider adds the domain automatically.
          </p>

          <div className="dns-table">
            <div className="dns-header">
              <span>Type</span><span>Enter in DNS</span><span>Value</span><span>Status</span>
            </div>

            <DnsRow
              type="TXT"
              host={`_torta-verify`}
              value={`torta-verify=${data.verify_token}`}
              status={dnsStatus('verification')}
            />
            <DnsRow
              type="TXT"
              host={`${data.dkim_selector}._domainkey`}
              value={data.dkim_public}
              status={dnsStatus('dkim')}
            />
            <DnsRow
              type="TXT"
              host="@"
              value="v=spf1 include:amazonses.com ~all"
              status={dnsStatus('spf')}
            />
          </div>
        </section>
      )}
    </div>
  );
}

export default Email