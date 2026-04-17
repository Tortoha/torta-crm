import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Copy, CheckCircle, Warning, ArrowClockwise, Trash } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';

const DOMAIN_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

const DNS_TILT = {
  maxAngleX: 12, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07,
  scale: 1.05, perspective: 900, gloss: { opacity: 0.07, spread: 50 },
};
const PREVIEW_TILT = {
  maxAngle: 14, lerp: 0.06, lerpOut: 0.08,
  scale: 1.052, perspective: 700, gloss: { opacity: 0.06, spread: 70 },
};

// ─── DNS Row ──────────────────────────────────────────────────────────────────

function AuthDnsRow({ type, host, value, status, first, last }) {
  const [copied, setCopied] = useState(null);
  const { ref, glossRef, handlers } = InteractiveSection(DNS_TILT, false);

  const copy = (field, text, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 1500);
  };

  const cls = [
    'auth-dns-row',
    first && 'auth-dns-row--first',
    last  && 'auth-dns-row--last',
  ].filter(Boolean).join(' ');

  return (
    <div ref={ref} className={cls} {...handlers}>
      <div ref={glossRef} className="auth-dns-gloss" />
      <span className="auth-dns-type">{type}</span>
      <div className="auth-dns-cell">
        <button className="auth-dns-copy" onClick={e => copy('host', host, e)} type="button">
          {copied === 'host'
            ? <CheckCircle size={12} weight="fill" color="var(--accent)" />
            : <Copy size={12} />}
        </button>
        <code className="auth-dns-code" title={host}>{host}</code>
      </div>
      <div className="auth-dns-cell">
        <button className="auth-dns-copy" onClick={e => copy('value', value, e)} type="button">
          {copied === 'value'
            ? <CheckCircle size={12} weight="fill" color="var(--accent)" />
            : <Copy size={12} />}
        </button>
        <span className="auth-dns-value" title={value}>{value}</span>
      </div>
      <div className={`auth-dns-status auth-dns-status--${status}`}>
        {status === 'ok'      && <><span className="auth-dns-dot auth-dns-dot--ok" /> OK</>}
        {status === 'pending' && <><Warning size={11} weight="fill" /> Pending</>}
        {status === 'unknown' && <span className="auth-dns-dot auth-dns-dot--unknown" />}
      </div>
    </div>
  );
}

// ─── Email Panel ──────────────────────────────────────────────────────────────

function EmailPanel({ projectId, onVerifiedChange, onConfiguredChange }) {
  const pq = `?project_id=${projectId}`;
  const [data,            setData]            = useState(null);
  const [domain,          setDomain]          = useState('');
  const [fromName,        setFromName]        = useState('');
  const [fromEmailPrefix, setFromEmailPrefix] = useState('');
  const [saving,          setSaving]          = useState(false);
  const [verifying,       setVerifying]       = useState(false);
  const [deleting,        setDeleting]        = useState(false);
  const [verifyRes,       setVerifyRes]       = useState(null);
  const [err,             setErr]             = useState('');
  const [toast,           setToast]           = useState('');
  const [showAll,         setShowAll]         = useState(false);
  const initialRef  = useRef({ domain: '', fromName: '', fromEmailPrefix: '' });
  const toastTimer  = useRef(null);

  const { ref: prevRef, glossRef: prevGlossRef, handlers: prevHandlers } =
    InteractiveSection(PREVIEW_TILT, false);

  const fullFromEmail = fromEmailPrefix && domain ? `${fromEmailPrefix}@${domain}` : '';

  const isDirty       = domain          !== initialRef.current.domain ||
                        fromName        !== initialRef.current.fromName ||
                        fromEmailPrefix !== initialRef.current.fromEmailPrefix;
  const isDomainValid = DOMAIN_RE.test(domain.trim());
  const canSave       = isDirty && isDomainValid && !!fromName.trim() && !!fromEmailPrefix.trim();

  const showToast = msg => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  const load = async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/email-domain${pq}`, { credentials: 'include' });
      const json = await res.json();
      setData(json);
      if (json.configured) {
        const d = json.domain;
        const n = json.from_name;
        const p = json.from_email?.includes('@') ? json.from_email.split('@')[0] : (json.from_email || '');
        setDomain(d); setFromName(n); setFromEmailPrefix(p);
        initialRef.current = { domain: d, fromName: n, fromEmailPrefix: p };
        onVerifiedChange?.(json.dkim_ok && json.spf_ok);
      } else {
        initialRef.current = { domain: '', fromName: '', fromEmailPrefix: '' };
        onVerifiedChange?.(false);
      }
    } catch { setData({ configured: false }); }
  };

  useEffect(() => { load(); }, [projectId]);

  const handleSave = async e => {
    e.preventDefault(); setErr(''); setSaving(true);
    try {
      const res  = await fetch(`${API_BASE}/api/email-domain${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, from_name: fromName, from_email: fullFromEmail }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.detail || 'Error'); return; }
      setData(json); setVerifyRes(null);
      initialRef.current = { domain, fromName, fromEmailPrefix };
      onConfiguredChange?.(!!json.configured);
      showToast('Saved. Add the DNS records below to your domain registrar.');
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  const handleVerify = async () => {
    setVerifying(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/email-domain/verify${pq}`, {
        method: 'POST', credentials: 'include',
      });
      const json = await res.json();
      setVerifyRes({ dkim: json.dkim_ok, spf: json.spf_ok, dmarc: json.dmarc_ok });
      onVerifiedChange?.(json.all_ok);
      if (json.all_ok) {
        showToast('Domain fully verified — DKIM and SPF are active.');
        load();
      } else {
        const parts = [];
        if (!json.dkim_ok) parts.push('DKIM not found');
        if (!json.spf_ok)  parts.push('SPF not found');
        setErr(parts.join(' · ') + '. DNS may take up to 24h to propagate.');
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
      setDomain(''); setFromName(''); setFromEmailPrefix('');
      initialRef.current = { domain: '', fromName: '', fromEmailPrefix: '' };
      onVerifiedChange?.(false);
      onConfiguredChange?.(false);
      setVerifyRes(null); setErr(''); setToast('');
    } catch { setErr('Network error'); }
    finally { setDeleting(false); }
  };

  const recStatus = label => {
    if (!verifyRes) {
      if (label === 'DKIM')  return data?.dkim_ok  ? 'ok' : 'unknown';
      if (label === 'SPF')   return data?.spf_ok   ? 'ok' : 'unknown';
      if (label === 'DMARC') return data?.dmarc_ok ? 'ok' : 'unknown';
      return 'unknown';
    }
    if (label === 'DKIM')  return verifyRes.dkim  ? 'ok' : 'pending';
    if (label === 'SPF')   return verifyRes.spf   ? 'ok' : 'pending';
    if (label === 'DMARC') return verifyRes.dmarc ? 'ok' : 'pending';
    return 'unknown';
  };

  const initials = fromName.trim()
    ? fromName.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join('')
    : '?';

  if (!data) return <p className="crm-placeholder">Loading…</p>;

  const isVerified  = data.dkim_ok && data.spf_ok;
  const previewAddr = fullFromEmail || `support@${domain || 'yourdomain.com'}`;
  const records     = data.dns_records || [];
  const visibleRecs = showAll ? records : records.slice(0, 3);

  return (
    <>
      {/* ── Two columns: form 60% | preview 40% ── */}
      <div className="auth-email-layout">

        {/* LEFT — form */}
        <form onSubmit={handleSave} className="auth-form">

          <div className="auth-field">
            <label className="auth-label">Domain</label>
            <p className="auth-field-hint">Domain name for sending and receiving emails.</p>
            <input className="crm-input" placeholder="yourdomain.com"
              value={domain} onChange={e => setDomain(e.target.value)} required />
          </div>

          <div className="auth-field">
            <label className="auth-label">From name</label>
            <p className="auth-field-hint">Displayed as the sender name in inboxes.</p>
            <input className="crm-input" placeholder="My Store"
              value={fromName} onChange={e => setFromName(e.target.value)} required maxLength={100} />
          </div>

          <div className="auth-field">
            <label className="auth-label">From email</label>
            <p className="auth-field-hint">The address emails will be sent from.</p>
            <div className="auth-email-split">
              <input className="crm-input auth-email-prefix" placeholder="support"
                value={fromEmailPrefix}
                onChange={e => setFromEmailPrefix(e.target.value.replace(/@.*/, ''))}
                required />
              <span className="auth-email-suffix">@{domain || 'yourdomain.com'}</span>
            </div>
          </div>

          {err && <p className="auth-msg auth-msg--err">{err}</p>}

          <div className="auth-actions">
            <button className="crm-submit-btn" type="submit" disabled={saving || !canSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {data.configured && (
              <button type="button" className="auth-btn-danger"
                onClick={handleDelete} disabled={deleting}>
                <Trash size={14} />
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </form>

        {/* RIGHT — email preview */}
        <div className="auth-preview-wrap">
          <div ref={prevRef} className="auth-preview-card" {...prevHandlers}>
            <div ref={prevGlossRef} className="auth-preview-gloss" />
            <div className="auth-preview-inner">
              <div className="auth-preview-header">
                <div className="auth-preview-avatar-wrap">
                  <div className="auth-preview-avatar--initials">{initials}</div>
                </div>
                <div className="auth-preview-meta">
                  <div className="auth-preview-from">
                    <span className="auth-preview-name">{fromName || 'Your Name'}</span>
                    <span className="auth-preview-addr">&lt;{previewAddr}&gt;</span>
                  </div>
                  <span className="auth-preview-to">to me</span>
                </div>
                <span className="auth-preview-time">now</span>
              </div>
              <div className="auth-preview-divider" />
              <div className="auth-preview-subject-line">Your subject line</div>
              <div className="auth-preview-body">
                <div className="auth-preview-line" style={{ width: '82%' }} />
                <div className="auth-preview-line" style={{ width: '65%' }} />
                <div className="auth-preview-line" style={{ width: '74%' }} />
                <div className="auth-preview-line" style={{ width: '50%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── DNS section ── */}
      {data.configured && (
        <>
          <div className="auth-dns-header-block">
            <div>
              <h3 className="auth-dns-card-title">DNS Records</h3>
              <p className="auth-dns-card-desc">
                Add these records to your domain registrar. Propagation can take up to 24 hours.
              </p>
            </div>
            <div className="auth-dns-header-right">
              {isVerified
                ? <span className="auth-dns-verified"><CheckCircle weight="fill" size={11} /> Verified</span>
                : <span className="auth-dns-pending"><Warning weight="fill" size={11} /> Not verified</span>}
              <button type="button" className="auth-btn-check"
                onClick={handleVerify} disabled={verifying}>
                <ArrowClockwise size={14} />
                {verifying ? 'Checking…' : 'Check DNS'}
              </button>
            </div>
          </div>

          <div className="auth-dns-thead-block">
            <div className="auth-dns-thead">
              <span>Type</span><span>Host</span><span>Value</span><span>Status</span>
            </div>
          </div>

          <div className="auth-dns-rows-block">
            <div className="auth-dns-rows">
              {visibleRecs.map((rec, i) => (
                <AuthDnsRow key={i}
                  type={rec.type} host={rec.host} value={rec.value}
                  status={recStatus(rec.label)}
                  first={i === 0}
                  last={i === visibleRecs.length - 1} />
              ))}
            </div>
            {records.length > 3 && (
              <button className="auth-dns-show-all" type="button"
                onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Show less' : `Show all ${records.length} records`}
              </button>
            )}
          </div>
        </>
      )}

      {toast && createPortal(
        <div className="auth-toast">{toast}</div>,
        document.body,
      )}
    </>
  );
}

export default EmailPanel;
