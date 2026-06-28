// Admin Feedback — user feedback (Issue / Idea) submitted from the CRM Header
// "Feedback" widget. Same shell as Users: crm-page-title + .org-toolbar (search
// + kind filter) + .po-set-table rows. Click a row → auth-modal with the full
// text + the submitter's name/email + a reply box that emails them officially
// via SES (from Torta <support@tortacrm.com>).
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, Warning, Lightbulb, X, Trash, PaperPlaneTilt } from '@phosphor-icons/react';
import { API_BASE, pickError } from '../api.js';
import { PoListRow } from '../Utils/PoListRow.jsx';
import { useRealtimePoll } from '../Utils/useRealtimePoll.js';
import '../Style/Authentication.css';
import '../Style/Organization.css';
import '../Style/Products.css';
import '../Style/Targets.css';
import '../Style/Users.css';
import '../Style/Feedback.css';

const KIND_FILTER = [
  { value: 'all',   labelKey: 'feedback.filter.all' },
  { value: 'issue', labelKey: 'feedback.filter.issues' },
  { value: 'idea',  labelKey: 'feedback.filter.ideas' },
];

const fmtDate = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
};

function KindBadge({ kind }) {
  const { t } = useTranslation();
  return kind === 'idea'
    ? <span className="fb-kind fb-kind--idea"><Lightbulb weight="duotone" /> {t('feedback.kind.idea')}</span>
    : <span className="fb-kind fb-kind--issue"><Warning weight="duotone" /> {t('feedback.kind.issue')}</span>;
}

export default function Feedback() {
  const { t } = useTranslation();
  const [q, setQ]       = useState('');
  const [kind, setKind] = useState('all');
  const [rows, setRows] = useState(null);
  const [err, setErr]   = useState('');
  const [open, setOpen] = useState(null);

  const kindFilter = useMemo(
    () => KIND_FILTER.map(o => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );

  // silent=true → background refresh: keep the current rows on a transient
  // error instead of flashing a "Failed to load" banner over good data.
  const load = (silent = false) => {
    const params = new URLSearchParams();
    if (kind !== 'all') params.set('kind', kind);
    if (q) params.set('q', q);
    fetch(`${API_BASE}/api/admin/feedback?${params}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setRows(Array.isArray(d) ? d : []); setErr(''); })
      .catch(e => { if (!silent) setErr(String(e)); });
  };
  useEffect(load, [q, kind]);
  useRealtimePoll(() => load(true));

  return (
    <>
      <h1 className="crm-page-title">{t('feedback.title')}</h1>

      <div className="org-toolbar">
        <div className="org-search-wrap" style={{ flex: 1, minWidth: 240 }}>
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder={t('feedback.searchPlaceholder')}
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="org-status-pill">
          {kindFilter.map(o => (
            <button key={o.value} type="button"
              className={`org-status-btn${kind === o.value ? ' org-status-btn--active' : ''}`}
              onClick={() => setKind(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>

      {err && <div className="crm-placeholder" style={{ color: 'var(--delete)' }}>{t('feedback.loadFailed', { error: err })}</div>}
      {!rows && !err && <div className="crm-placeholder">{t('common.loading')}</div>}
      {rows && rows.length === 0 && (
        <div className="crm-placeholder">
          {q || kind !== 'all' ? t('feedback.emptyFiltered') : t('feedback.empty')}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head po-set-row--fb">
            <span>{t('feedback.col.type')}</span><span>{t('feedback.col.subject')}</span><span>{t('feedback.col.from')}</span><span>{t('feedback.col.date')}</span><span>{t('feedback.col.status')}</span>
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
                  {f.status === 'replied' ? t('feedback.status.replied') : t('feedback.status.new')}
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
  const { t } = useTranslation();
  const [reply, setReply] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const sendReply = async () => {
    const text = reply.trim();
    if (!text) { setErr(t('feedback.modal.errWriteFirst')); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/admin/feedback/${fb.id}/reply`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: text }),
      });
      if (r.ok) onChanged();
      else { const j = await r.json().catch(() => ({})); setErr(pickError(j, t('feedback.modal.errSendFailed'))); setBusy(false); }
    } catch { setErr(t('feedback.modal.errNetwork')); setBusy(false); }
  };

  const del = async () => {
    if (!confirm(t('feedback.modal.deleteConfirm'))) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/admin/feedback/${fb.id}`, { method: 'DELETE', credentials: 'include' });
      onChanged();
    } catch { setErr(t('feedback.modal.errNetwork')); setBusy(false); }
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{fb.subject || (fb.kind === 'idea' ? t('feedback.kind.idea') : t('feedback.kind.issue'))}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  <KindBadge kind={fb.kind} /> · {fb.name || '—'} · {fb.email || t('feedback.modal.noEmail')} · {fmtDate(fb.created_at)}
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
                {t('feedback.modal.alreadyReplied')}{fb.replied_at ? ` · ${fmtDate(fb.replied_at)}` : ''}
              </label>
              <div className="fb-prev-reply">{fb.reply_text}</div>
            </div>
          )}

          <div className="cpm-section">
            <label className="po-field-label">{t('feedback.modal.replyLabel', { email: 'support@tortacrm.com' })}</label>
            <textarea className="crm-input cpm-textarea" rows={5} maxLength={5000}
              placeholder={fb.email ? t('feedback.modal.replyPlaceholder', { email: fb.email }) : t('feedback.modal.replyPlaceholderNone')}
              value={reply} onChange={(e) => setReply(e.target.value)} disabled={!fb.email} />
          </div>

          {err && <p className="auth-msg auth-msg--err">{err}</p>}

          <div className="auth-actions">
            <button type="button" className="crm-submit-btn" disabled={busy || !fb.email} onClick={sendReply}>
              <PaperPlaneTilt weight="fill" style={{ width: 15, height: 15, marginRight: 6 }} />
              {busy ? t('feedback.modal.sending') : t('feedback.modal.sendReply')}
            </button>
            <button type="button" className="crm-submit-btn auth-btn-danger" disabled={busy} onClick={del}>
              <Trash style={{ width: 15, height: 15, marginRight: 6 }} /> {t('common.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
