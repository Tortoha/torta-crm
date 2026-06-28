// Admin Inbox — inbound mail to legal@ / support@tortacrm.com, modelled on the
// CRM "Chat with Customers" 2-pane layout: thread list (left) + conversation
// (right) + reply composer. Replies go out via SES from the same mailbox.
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, PaperPlaneTilt, Trash, EnvelopeSimple, Scales, Lifebuoy } from '@phosphor-icons/react';
import { API_BASE, pickError } from '../api.js';
import { useRealtimePoll } from '../Utils/useRealtimePoll.js';
import '../Style/Organization.css';
import '../Style/Products.css';
import '../Style/Authentication.css';
import '../Style/Inbox.css';

// Mailbox filter values stay stable (sent as ?mailbox= and used for CSS classes);
// labels resolve through i18n inside the component (see MAILBOXES useMemo below).
const MAILBOXES = [
  { value: 'all',     labelKey: 'inbox.mailbox.all' },
  { value: 'support', labelKey: 'inbox.mailbox.support' },
  { value: 'legal',   labelKey: 'inbox.mailbox.legal' },
];

const fmtTime = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch { return ''; }
};
const fmtFull = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
};

function MailboxIcon({ mailbox, className }) {
  return mailbox === 'legal'
    ? <Scales className={className} weight="bold" />
    : <Lifebuoy className={className} weight="bold" />;
}

export default function Inbox() {
  const { t } = useTranslation();
  const mailboxes = useMemo(
    () => MAILBOXES.map(m => ({ value: m.value, label: t(m.labelKey) })),
    [t]
  );
  const [mailbox, setMailbox] = useState('all');
  const [q, setQ]             = useState('');
  const [threads, setThreads] = useState(null);
  const [sel, setSel]         = useState(null);     // selected thread id
  const [detail, setDetail]   = useState(null);     // { thread, messages }
  const [reply, setReply]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const scrollRef = useRef(null);
  // Mirror `sel` into a ref so async fetches can tell whether the user has
  // since switched threads (drop the stale result instead of flashing it in).
  const selRef = useRef(null);
  useEffect(() => { selRef.current = sel; }, [sel]);
  // Controls the auto-scroll effect below. Explicit opens/sends pin to the
  // newest message; a background poll only re-pins if the reader was already
  // at the bottom — so polling never yanks scroll while reading older mail.
  const pinBottomRef = useRef(true);

  const loadThreads = useCallback(() => {
    const params = new URLSearchParams();
    if (mailbox !== 'all') params.set('mailbox', mailbox);
    if (q) params.set('q', q);
    fetch(`${API_BASE}/api/admin/inbox/threads?${params}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setThreads(Array.isArray(d) ? d : []))
      // Keep the current list on a transient error; only fall to empty if we
      // never had data (so the initial "Loading…" doesn't hang forever).
      .catch(() => setThreads(prev => prev ?? []));
  }, [mailbox, q]);
  useEffect(loadThreads, [loadThreads]);

  const openThread = (id) => {
    setSel(id); setReply(''); setErr('');
    pinBottomRef.current = true;   // jump to the newest message on explicit open
    fetch(`${API_BASE}/api/admin/inbox/threads/${id}/messages`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (selRef.current === id) { setDetail(d); loadThreads(); } })  // reload clears the unread badge
      .catch(() => setDetail(null));
  };

  // Realtime: refresh the thread list, and (if a conversation is open) its
  // messages too — so an inbound reply appears live without re-clicking. Never
  // touches the `reply` draft. Scroll only snaps down when already at bottom.
  const refresh = useCallback(() => {
    loadThreads();
    const id = selRef.current;
    if (!id) return;
    const el = scrollRef.current;
    pinBottomRef.current = el ? (el.scrollHeight - el.scrollTop - el.clientHeight < 80) : true;
    fetch(`${API_BASE}/api/admin/inbox/threads/${id}/messages`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && selRef.current === id) setDetail(d); })
      .catch(() => {});
  }, [loadThreads]);
  useRealtimePoll(refresh);

  // Auto-scroll the conversation to the newest message — but only when pinned
  // to the bottom, so a background refresh can't interrupt reading history.
  useEffect(() => {
    if (pinBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [detail]);

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || busy || !sel) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/admin/inbox/threads/${sel}/reply`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (r.ok) { setReply(''); openThread(sel); loadThreads(); }
      else { const j = await r.json().catch(() => ({})); setErr(pickError(j, t('inbox.sendFailed'))); }
    } catch { setErr(t('inbox.networkError')); }
    finally { setBusy(false); }
  };

  const del = async () => {
    if (!sel || !confirm(t('inbox.deleteConfirm'))) return;
    await fetch(`${API_BASE}/api/admin/inbox/threads/${sel}`, { method: 'DELETE', credentials: 'include' });
    setSel(null); setDetail(null); loadThreads();
  };

  return (
    <>
      <h1 className="crm-page-title">{t('inbox.title')}</h1>

      <div className="inbox-shell">
        {/* ── Threads (left) ── */}
        <aside className="inbox-aside">
          <div className="inbox-filter">
            {mailboxes.map(m => (
              <button key={m.value} type="button"
                className={`inbox-filter-btn${mailbox === m.value ? ' inbox-filter-btn--on' : ''}`}
                onClick={() => setMailbox(m.value)}>{m.label}</button>
            ))}
          </div>
          <div className="inbox-search">
            <MagnifyingGlass className="inbox-search-icon" />
            <input className="inbox-search-input" placeholder={t('inbox.searchPlaceholder')}
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="inbox-list">
            {threads === null && <div className="inbox-empty-note">{t('common.loading')}</div>}
            {threads && threads.length === 0 && <div className="inbox-empty-note">{t('inbox.noConversations')}</div>}
            {threads && threads.map(t => (
              <button key={t.id} type="button"
                className={`inbox-conv${sel === t.id ? ' inbox-conv--current' : ''}`}
                onClick={() => openThread(t.id)}>
                <span className={`inbox-conv-ava inbox-conv-ava--${t.mailbox}`}>
                  <MailboxIcon mailbox={t.mailbox} className="inbox-conv-ava-ico" />
                </span>
                <span className="inbox-conv-main">
                  <span className="inbox-conv-top">
                    <span className="inbox-conv-name">{t.sender_name || t.sender_email}</span>
                    <span className="inbox-conv-time">{fmtTime(t.last_message_at)}</span>
                  </span>
                  <span className="inbox-conv-sub">{t.subject || t.sender_email}</span>
                  <span className="inbox-conv-preview">{t.last_preview || ''}</span>
                </span>
                {t.unread_count > 0 && <span className="inbox-conv-unread">{t.unread_count}</span>}
              </button>
            ))}
          </div>
        </aside>

        {/* ── Conversation (right) ── */}
        <section className="inbox-thread">
          {!detail ? (
            <div className="inbox-thread-empty">
              <EnvelopeSimple weight="thin" />
              <p>{t('inbox.selectConversation')}</p>
            </div>
          ) : (
            <>
              <header className="inbox-thread-head">
                <span className={`inbox-conv-ava inbox-conv-ava--${detail.thread.mailbox}`}>
                  <MailboxIcon mailbox={detail.thread.mailbox} className="inbox-conv-ava-ico" />
                </span>
                <div className="inbox-thread-head-text">
                  <div className="inbox-thread-name">{detail.thread.sender_name || detail.thread.sender_email}</div>
                  <div className="inbox-thread-meta">
                    {detail.thread.sender_email} · {detail.thread.mailbox}@tortacrm.com
                  </div>
                </div>
                <button type="button" className="inbox-thread-del" onClick={del} title={t('inbox.deleteConversation')}>
                  <Trash />
                </button>
              </header>

              <div className="inbox-msgs" ref={scrollRef}>
                {detail.messages.map(m => (
                  <div key={m.id} className={`inbox-msg inbox-msg--${m.direction === 'out' ? 'out' : 'in'}`}>
                    <div className="inbox-bubble">
                      {m.subject && <div className="inbox-bubble-subj">{m.subject}</div>}
                      <div className="inbox-bubble-text">{m.body_text || t('inbox.emptyMessage')}</div>
                      <div className="inbox-bubble-time">
                        {m.direction === 'out' && m.admin_email ? `${m.admin_email} · ` : ''}{fmtFull(m.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {err && <div className="inbox-err">{err}</div>}

              <div className="inbox-composer">
                <textarea className="inbox-composer-input" rows={2}
                  placeholder={t('inbox.replyPlaceholder', { mailbox: detail.thread.mailbox })}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } }} />
                <button type="button" className="inbox-composer-send" disabled={busy || !reply.trim()} onClick={sendReply}>
                  <PaperPlaneTilt weight="fill" />
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
