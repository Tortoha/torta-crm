// Email media library — upload images / PDFs to R2 and copy their links to drop
// into the email HTML (e.g. <img src> or a download <a href>). Modal shell
// mirrors the New-promo-code modal (auth-modal cpm-modal).

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, UploadSimple, Copy, CheckCircle, Trash, FilePdf } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { presignedUpload } from '../../Utils/upload.js';
import '../../Style/Authentication.css';

export default function MediaLibraryModal({ projectId, onClose }) {
  const { t } = useTranslation();
  const pq = `?project_id=${projectId}`;
  const [items, setItems] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(null);
  const fileRef = useRef(null);

  const load = () => fetch(`${API_BASE}/api/email-media${pq}`, { credentials: 'include' })
    .then(r => r.json()).then(d => setItems(d.items || [])).catch(() => setItems([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      try {
        // Images: kind=image → inline URL (works in <img>). PDFs: kind=file →
        // attachment URL (a download link).
        const { url, size } = await presignedUpload(file, { pq, kind: isPdf ? 'file' : 'image' });
        await fetch(`${API_BASE}/api/email-media${pq}`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, filename: file.name, kind: isPdf ? 'pdf' : 'image', size }),
        });
      } catch (err) {
        if (!err.planLimit && err.message) alert(err.message);
      }
    }
    setUploading(false);
    load();
  };

  const copy = (url, id) => {
    navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(c => (c === id ? null : c)), 1500);
  };
  const del = async (id) => {
    if (!window.confirm(t('comms.emails.media.deleteConfirm'))) return;
    await fetch(`${API_BASE}/api/email-media/${id}${pq}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal em-media-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{t('comms.emails.media.title')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">{t('comms.emails.media.subtitle')}</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <div className="em-media-toolbar">
            <button type="button" className="crm-add-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <UploadSimple className="crm-add-btn-icon" /> {uploading ? t('comms.emails.media.uploading') : t('comms.emails.media.upload')}
            </button>
            <span className="em-media-hint">{t('comms.emails.media.hint')}</span>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={onFiles} />
          </div>

          {items === null ? (
            <div className="em-media-empty">{t('common.loading')}</div>
          ) : items.length === 0 ? (
            <div className="em-media-empty">{t('comms.emails.media.empty')}</div>
          ) : (
            <div className="em-media-grid">
              {items.map(m => (
                <div key={m.id} className="em-media-card">
                  <div className="em-media-thumb">
                    {m.kind === 'pdf'
                      ? <div className="em-media-pdf"><FilePdf weight="duotone" /></div>
                      : <img src={m.url} alt={m.filename} loading="lazy" />}
                  </div>
                  <div className="em-media-name" title={m.filename}>
                    {m.filename || (m.kind === 'pdf' ? 'PDF' : 'Image')}
                  </div>
                  <div className="em-media-actions">
                    <button type="button" className="em-media-copy" onClick={() => copy(m.url, m.id)}>
                      {copied === m.id
                        ? <><CheckCircle weight="fill" /> {t('comms.emails.media.copied')}</>
                        : <><Copy /> {t('comms.emails.media.copyLink')}</>}
                    </button>
                    <button type="button" className="em-media-del" onClick={() => del(m.id)} title={t('common.delete')}>
                      <Trash />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
