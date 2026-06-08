// FeedbackWidget — global "Feedback" button in the Header (Supabase-style).
//
// Click → a popover with two choices: Issue (something's broken / a bug) or
// Idea (a suggestion to improve the CRM). Picking one opens a small modal with
// a subject + description and a Send button → POST /api/feedback. The submitter's
// name + email are captured server-side from the session, so the operator can
// reply from the Admin panel. Success shows a bottom toast.
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Warning, Lightbulb, ChatCircleDots } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { InteractiveSection } from '../Utils/InteractiveSection.js';
import Modal from './Modal.jsx';
import '../Style/Feedback.css';

// 3D tilt for the choice rows — the same InteractiveSection feel as the
// notifications dropdown rows.
const FB_TILT = {
  maxAngleX: 10, maxAngleY: 4, lerp: 0.05, lerpOut: 0.07,
  scale: 1.086, perspective: 900,
  gloss: { opacity: 0.14, spread: 40 },
};

// Copied verbatim from NotificationsBell.NotifRow — the IS tilt wrapper.
function FbRow({ className = '', children, ...rest }) {
  const { ref, glossRef, handlers } = InteractiveSection(FB_TILT, false);
  return (
    <div ref={ref} className={`po-set-row ${className}`.trim()} {...handlers} {...rest}>
      <div ref={glossRef} className="po-set-row-gloss" />
      {children}
    </div>
  );
}

export default function FeedbackWidget() {
  const { t } = useTranslation();
  const btnRef = useRef(null);
  const toastTimer = useRef(null);

  const [open,    setOpen]    = useState(false);   // popover
  const [pos,     setPos]     = useState(null);
  const [kind,    setKind]    = useState(null);    // 'issue' | 'idea' → modal open
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const [toast,   setToast]   = useState('');

  // Position the popover under the trigger; close on Escape / outside click.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPd  = e => {
      if (!e.target.closest?.('.fb-popover') && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  const choose = (k) => { setOpen(false); setKind(k); setSubject(''); setMessage(''); setErr(''); };
  const closeModal = () => { setKind(null); setBusy(false); };

  const flashToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  const submit = async () => {
    if (busy) return;
    const s = subject.trim(), m = message.trim();
    if (!s) { setErr(t('feedback.errSubject')); return; }
    if (!m) { setErr(t('feedback.errMessage')); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, subject: s, message: m }),
      });
      if (r.ok) { closeModal(); flashToast(t('feedback.sent')); }
      else { const j = await r.json().catch(() => ({})); setErr(j.detail || t('feedback.failed')); setBusy(false); }
    } catch { setErr(t('feedback.failed')); setBusy(false); }
  };

  return (
    <>
      {/* Same shell as the Header Docs button (.hdr-docs-btn) so it reads as native chrome. */}
      <button ref={btnRef} type="button" className="hdr-docs-btn" onClick={() => setOpen(v => !v)}>
        <ChatCircleDots className="hdr-docs-icon" weight="bold" />
        <span className="hdr-docs-label">{t('feedback.button')}</span>
      </button>

      {open && pos && createPortal(
        <div className="notif-popover fb-popover" style={{ top: pos.top, right: pos.right }}
          onPointerDown={e => e.stopPropagation()}>
          <div className="notif-list">
            <div className="po-set-table notif-table">
              <FbRow className="notif-row notif-row--clickable" onClick={() => choose('issue')}>
                <span className="notif-row-body">
                  <span className="notif-row-icon"><Warning weight="bold" /></span>
                  <span className="notif-row-text">
                    <span className="po-set-strong notif-row-title">{t('feedback.issue')}</span>
                    <span className="notif-row-message">{t('feedback.issueSub')}</span>
                  </span>
                </span>
              </FbRow>
              <FbRow className="notif-row notif-row--clickable" onClick={() => choose('idea')}>
                <span className="notif-row-body">
                  <span className="notif-row-icon"><Lightbulb weight="bold" /></span>
                  <span className="notif-row-text">
                    <span className="po-set-strong notif-row-title">{t('feedback.idea')}</span>
                    <span className="notif-row-message">{t('feedback.ideaSub')}</span>
                  </span>
                </span>
              </FbRow>
            </div>
          </div>
        </div>,
        document.body)}

      {kind && (
        <Modal
          onClose={closeModal}
          title={kind === 'issue' ? t('feedback.issueTitle') : t('feedback.ideaTitle')}
          subtitle={kind === 'issue' ? t('feedback.issueSub') : t('feedback.ideaSub')}
          maxWidth={520}
        >
          <div className="fb-form">
            <input
              className="fb-input" maxLength={300} autoFocus
              placeholder={t('feedback.subjectPh')}
              value={subject} onChange={e => setSubject(e.target.value)}
            />
            <textarea
              className="fb-textarea" maxLength={5000} rows={5}
              placeholder={t('feedback.messagePh')}
              value={message} onChange={e => setMessage(e.target.value)}
            />
            {err && <div className="fb-err">{err}</div>}
            <div className="fb-actions">
              <button type="button" className="fb-cancel" onClick={closeModal}>{t('feedback.cancel')}</button>
              <button type="button" className="fb-submit" disabled={busy} onClick={submit}>
                {busy ? t('feedback.sending') : t('feedback.send')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {toast && createPortal(<div className="fb-toast">{toast}</div>, document.body)}
    </>
  );
}
