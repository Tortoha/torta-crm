import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, User, CalendarBlank, Phone, EnvelopeSimple, Trash, Note, MapPin } from '@phosphor-icons/react';
import { Combobox } from './BookingCreateModal.jsx';

const STATUS_OPTIONS = [
  { value: 'pending',   label: 'Pending'   },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show',   label: 'No-show'   },
];

const fmtDateLong = ts => ts
  ? new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  : '';
const fmtTime = ts => ts
  ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  : '';

// Read-only-ish booking details with status changer + delete.
function BookingDetailModal({ booking, onClose, onStatusChange, onDelete }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal bk-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div className="auth-modal-icon-wrap">
              <CalendarBlank size={24} className="auth-modal-icon-svg" />
            </div>
            <div>
              <div className="auth-modal-title">Booking #{booking.id}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">{fmtDateLong(booking.starts_at)} · {fmtTime(booking.starts_at)}</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          {/* Summary block */}
          <div className="bk-detail-summary">
            <div className="bk-detail-row">
              <Clock size={16} className="bk-detail-icon" />
              <div>
                <div className="bk-detail-label">When</div>
                <div className="bk-detail-value">
                  {fmtDateLong(booking.starts_at)} · {fmtTime(booking.starts_at)} – {fmtTime(booking.ends_at)}
                </div>
              </div>
            </div>

            <div className="bk-detail-row">
              <CalendarBlank size={16} className="bk-detail-icon" />
              <div>
                <div className="bk-detail-label">
                  {booking.service_id ? 'Service' : 'Service (freeform)'}
                </div>
                <div className="bk-detail-value">
                  {booking.service_name || '—'}
                  {booking.service_duration && <> · {booking.service_duration} min</>}
                  {booking.service_price > 0 && <> · ${booking.service_price.toFixed(2)}</>}
                </div>
              </div>
            </div>

            {booking.staff_name && (
              <div className="bk-detail-row">
                <User size={16} className="bk-detail-icon" />
                <div>
                  <div className="bk-detail-label">Staff</div>
                  <div className="bk-detail-value">{booking.staff_name}</div>
                </div>
              </div>
            )}
          </div>

          <div className="auth-sep" />

          {/* Customer */}
          <div className="bk-detail-summary">
            <div className="bk-detail-row">
              <User size={16} className="bk-detail-icon" />
              <div>
                <div className="bk-detail-label">Customer</div>
                <div className="bk-detail-value">{booking.customer_name || '—'}</div>
              </div>
            </div>
            {booking.customer_phone && (
              <div className="bk-detail-row">
                <Phone size={16} className="bk-detail-icon" />
                <div>
                  <div className="bk-detail-label">Phone</div>
                  <div className="bk-detail-value">
                    <a href={`tel:${booking.customer_phone}`}>{booking.customer_phone}</a>
                  </div>
                </div>
              </div>
            )}
            {booking.customer_email && (
              <div className="bk-detail-row">
                <EnvelopeSimple size={16} className="bk-detail-icon" />
                <div>
                  <div className="bk-detail-label">Email</div>
                  <div className="bk-detail-value">
                    <a href={`mailto:${booking.customer_email}`}>{booking.customer_email}</a>
                  </div>
                </div>
              </div>
            )}
            {booking.customer_address && (
              <div className="bk-detail-row">
                <MapPin size={16} className="bk-detail-icon" />
                <div>
                  <div className="bk-detail-label">Address</div>
                  <div className="bk-detail-value">
                    <a target="_blank" rel="noreferrer"
                       href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.customer_address)}`}>
                      {booking.customer_address}
                    </a>
                  </div>
                </div>
              </div>
            )}
            {booking.notes && (
              <div className="bk-detail-row">
                <Note size={16} className="bk-detail-icon" />
                <div>
                  <div className="bk-detail-label">Notes</div>
                  <div className="bk-detail-value">{booking.notes}</div>
                </div>
              </div>
            )}
          </div>

          <div className="auth-sep" />

          {/* Status changer — custom Combobox matches every other selector in
              the CRM (Calendar staff filter, New-promo categories, Booking
              Settings timezone). The native <select> looked out of place. */}
          <div className="auth-field">
            <label className="auth-label">Status</label>
            <Combobox value={booking.status}
              options={STATUS_OPTIONS}
              onChange={v => onStatusChange(booking.id, v)} />
          </div>

          <div className="auth-actions">
            <button className="auth-btn-danger" type="button" onClick={() => onDelete(booking.id)}>
              <Trash size={15} /> Delete booking
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default BookingDetailModal;
