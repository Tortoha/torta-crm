import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Bell, PaperPlaneTilt } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import ConnectorIcon from './ConnectorIcon.jsx';

// Lightweight modal for Coming-soon connectors. Captures the merchant's
// interest plus an optional notify-me email + free-form note. We use it to
// prioritise which integrations to ship next (logged to crm_integration_requests
// on the backend).

export default function RequestIntegrationModal({ projectId, connector, onClose, onSent }) {
  const { t } = useTranslation();
  const pq = `?project_id=${projectId}`;
  const [email, setEmail] = useState('');
  const [note,  setNote]  = useState('');
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');
  const [sent,  setSent]  = useState(false);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/integrations/request${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector: connector.type,
          notify_email: email.trim(),
          notes: note.trim(),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.detail || t('integrations.request.requestFailed'));
      } else {
        setSent(true);
        onSent?.();
      }
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal acc-modal acc-modal--narrow">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div className="auth-modal-icon-wrap"><ConnectorIcon icon={connector.icon} /></div>
            <div>
              <div className="auth-modal-title">{connector.name}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">{connector.description}</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body acc-body">
          {!sent && (
            <>
              <div className="acc-soon-banner">
                <Bell weight="fill" size={16} />
                <div>
                  <div className="acc-soon-title">{t('integrations.request.comingSoon')}</div>
                  <div className="acc-soon-sub">
                    {t('integrations.request.comingSoonSub')}
                  </div>
                </div>
              </div>

              {connector.features?.length > 0 && (
                <section className="acc-section">
                  <div className="acc-section-title">{t('integrations.request.plannedFeatures')}</div>
                  <ul className="acc-feature-list">
                    {connector.features.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </section>
              )}

              <section className="acc-section">
                <div className="acc-section-title">{t('integrations.request.notifyMe')}</div>
                <div className="acc-field acc-field--grow">
                  <span className="acc-field-label">{t('integrations.request.yourEmail')}</span>
                  <input className="crm-input" type="email" value={email}
                    onChange={e => setEmail(e.target.value)} maxLength={200}
                    placeholder={t('integrations.request.emailPlaceholder')} />
                </div>
                <div className="acc-field acc-field--grow">
                  <span className="acc-field-label">{t('integrations.request.anythingSpecific')}</span>
                  <textarea className="crm-input acc-textarea" rows={3}
                    value={note} maxLength={2000}
                    onChange={e => setNote(e.target.value)}
                    placeholder={t('integrations.request.notePlaceholder')} />
                </div>
              </section>

              {err && <p className="auth-msg auth-msg--err">{err}</p>}

              <div className="auth-actions acc-actions">
                <button type="button" className="crm-submit-btn"
                  onClick={submit} disabled={busy}>
                  <PaperPlaneTilt size={14} weight="bold" />
                  {busy ? t('integrations.request.sending') : t('integrations.request.sendRequest')}
                </button>
                <button type="button" className="auth-btn-check"
                  onClick={onClose} style={{ marginLeft: 'auto' }}>
                  {t('integrations.request.close')}
                </button>
              </div>
            </>
          )}

          {sent && (
            <div className="acc-soon-thanks">
              <div className="acc-soon-thanks-icon">✓</div>
              <h3>{t('integrations.request.thanksTitle')}</h3>
              <p>{t('integrations.request.thanksBody', { name: connector.name })}</p>
              <button type="button" className="crm-submit-btn" onClick={onClose}>{t('integrations.request.done')}</button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
