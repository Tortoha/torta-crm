import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import '../Style/Modal.css';

export default function Modal({
  onClose,
  title,
  subtitle,
  extra,
  maxWidth = 560,
  children,
}) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ maxWidth }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-head">
          <div className="modal-title-wrap">
            {title    && <span className="modal-title">{title}</span>}
            {subtitle && <span className="modal-subtitle">{subtitle}</span>}
          </div>
          {extra}
          <button className="crm-icon-btn" onClick={onClose} type="button">
            <X className="crm-icon" />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
