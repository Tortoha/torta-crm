// Admin Feedback — user feedback (Issue / Idea) submitted from the CRM Header
// "Feedback" widget. Same shell as Users: crm-page-title + .org-toolbar (search
// + kind filter) + .po-set-table rows. Click a row → auth-modal with the full
// text + the submitter's name/email + a reply box that emails them officially
// via SES (from Torta <support@tortacrm.com>).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MagnifyingGlass, Warning, Lightbulb, X, Trash, PaperPlaneTilt } from '@phosphor-icons/react';
import { API_BASE, pickError } from '../api.js';
import { PoListRow } from '../Utils/PoListRow.jsx';
import '../Style/Authentication.css';
import '../Style/Organization.css';
import '../Style/Products.css';
import '../Style/Targets.css';
import '../Style/Users.css';
import '../Style/Feedback.css';

const KIND_FILTER = [
  { value: 'all',   label: 'All' },
  { value: 'issue', label: 'Issues' },
  { value: 'idea',  label: 'Ideas' },
];

const fmtDate = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
};

function KindBadge({ kind }) {
  return kind === 'idea'
    ? <span className="fb-kind fb-kind--idea"><Lightbulb weight="duotone" /> Idea</span>
    : <span className="fb-kind fb-kind--issue"><Warning weight="duotone" /> Issue</span>;
}

export default function Feedback() {
  const [q, setQ]       = useState('');
  const [kind, setKind] = useState('all');
  const [rows, setRows] = useState(null);
  const [err, setErr]   = useState('');
  const [open, setOpen] = useState(null);

  const load = () => {
    const params = new URLSearchParams();
    if (kind !== 'all') params.set('kind', kind);
    if (q) params.set('q', q);
    fetch(`${API_BASE}/api/admin/feedback?${params}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setRows(Array.isArray(d) ? d : []); setErr(''); })
      .catch(e => setErr(String(e)));
  };
  useEffect(load, [q, kind]);

  return (
    <>
      <h1 className="crm-page-title">Feedback</h1>

      <div className="org-toolbar">
        <div className="org-search-wrap" style={{ flex: 1, minWidth: 240 }}>
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search subject, message, name or email…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="org-status-pill">
          {KIND_FILTER.map(o => (
            <button key={o.value} type="button"
              className={`org-status-btn${kind === o.value ? ' org-status-btn--active' : ''}`}
              onClick={() => setKind(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>

      {err && <div className="crm-placeholder" style={{ color: 'var(--delete)' }}>Failed to load: {err}</div>}
      {!rows && !err && <div className="crm-placeholder">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="crm-placeholder">
          {q || kind !== 'all' ? 'No feedback matches these filters.' : 'No feedback yet.'}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head po-set-row--fb">
            <span>Type</span><span>Subject</span><span>From</span><span>Date</span><span>Status</span>
          </div>
          {rows.map(f => (
            <PoListRow key={f.id} className="po-set-row--fb fb-row" onClick={() => setOpen(f)}>
              <span><KindBadge kind={f.kind} /></span>
              <span className="po-set-strong fb-subj">{f.subject || '—'}</span>
              <span className="fb-from">
                <span className="fb-from-name">{f.name || '—'}</span>
                <span className="fb-from-mail">{f.email}</span>
              </span>
              <span className="fb-date">{fmtDate(f.created_at)}</span>
              <span>
                <span className={`fb-status fb-status--${f.status === 'replied' ? 'replied' : 'new'}`}>
                  {f.status === 'replied' ? 'Replied' : 'New'}
                </span>
              </span>
            </PoListRow>
          ))}
        </div>
      )}

      {open && <FeedbackModal fb={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load(); }} />}
    </>
  );
}

function FeedbackModal({ fb, onClose, onChanged }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const sendReply = async () => {
    const t = reply.trim();
    if (!t) { setErr('Write a reply first'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/admin/feedback/${fb.id}/reply`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: t }),
      });
      if (r.ok) onChanged();
      else { const j = await r.json().catch(() => ({})); setErr(pickError(j, 'Failed to send')); setBusy(false); }
    } catch { setErr('Network error'); setBusy(false); }
  };

  const del = async () => {
    if (!confirm('Delete this feedback permanently?')) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/admin/feedback/${fb.id}`, { method: 'DELETE', credentials: 'include' });
      onChanged();
    } catch { setErr('Network error'); setBusy(false); }
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{fb.subject || (fb.kind === 'idea' ? 'Idea' : 'Issue')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  <KindBadge kind={fb.kind} /> · {fb.name || '—'} · {fb.email || 'no email'} · {fmtDate(fb.created_at)}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <div className="fb-message">{fb.message}</div>

          {fb.status === 'replied' && fb.reply_text && (
            <div className="cpm-section">
              <label className="po-field-label">
                Already replied{fb.replied_at ? ` · ${fmtDate(fb.replied_at)}` : ''}
              </label>
              <div className="fb-prev-reply">{fb.reply_text}</div>
            </div>
          )}

          <div className="cpm-section">
            <label className="po-field-label">Reply via email — from Torta &lt;support@tortacrm.com&gt;</label>
            <textarea className="crm-input cpm-textarea" rows={5} maxLength={5000}
              placeholder={fb.email ? `Write your reply to ${fb.email}…` : 'This feedback has no email to reply to'}
              value={reply} onChange={(e) => setReply(e.target.value)} disabled={!fb.email} />
          </div>

          {err && <p className="auth-msg auth-msg--err">{err}</p>}

          <div className="auth-actions">
            <button type="button" className="crm-submit-btn" disabled={busy || !fb.email} onClick={sendReply}>
              <PaperPlaneTilt weight="fill" style={{ width: 15, height: 15, marginRight: 6 }} />
              {busy ? 'Sending…' : 'Send reply'}
            </button>
            <button type="button" className="crm-submit-btn auth-btn-danger" disabled={busy} onClick={del}>
              <Trash style={{ width: 15, height: 15, marginRight: 6 }} /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
