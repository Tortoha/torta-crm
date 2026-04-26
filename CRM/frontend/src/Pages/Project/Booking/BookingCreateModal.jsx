import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CalendarPlus } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';

// Pad to two digits — for date / time strings.
const pad = n => String(n).padStart(2, '0');
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Modal for the operator to create a booking on behalf of a customer.
function BookingCreateModal({ projectId, services, staff, presetStart, onClose, onCreated }) {
  const pq = `?project_id=${projectId}`;

  // Pre-fill from "click on calendar slot" interaction
  const presetDate = presetStart ? presetStart.slice(0, 10) : todayISO();
  const presetTime = presetStart ? presetStart.slice(11, 16) : '10:00';

  const [serviceId,     setServiceId]     = useState(services[0]?.id ?? '');
  const [staffId,       setStaffId]       = useState('');
  const [date,          setDate]          = useState(presetDate);
  const [time,          setTime]          = useState(presetTime);
  const [customerName,  setCustomerName]  = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes,         setNotes]         = useState('');
  const [status,        setStatus]        = useState('confirmed');
  const [saving,        setSaving]        = useState(false);
  const [err,           setErr]           = useState('');

  const service = useMemo(
    () => services.find(s => s.id === parseInt(serviceId, 10)),
    [services, serviceId]
  );
  // Show only staff that is linked to the chosen service (if any links exist)
  const eligibleStaff = useMemo(() => {
    if (!service || !staff) return [];
    if (service.staff_ids && service.staff_ids.length > 0) {
      return staff.filter(s => service.staff_ids.includes(s.id));
    }
    return staff;
  }, [service, staff]);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const create = async () => {
    if (!serviceId)        { setErr('Pick a service');           return; }
    if (!customerName.trim()) { setErr('Customer name required'); return; }
    if (service?.requires_staff && !staffId) {
      setErr('This service requires choosing a staff member'); return;
    }
    setSaving(true); setErr('');
    try {
      const startsAt = `${date}T${time}:00`;
      const res = await fetch(`${API_BASE}/api/booking/bookings${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: parseInt(serviceId, 10),
          staff_id:   staffId ? parseInt(staffId, 10) : null,
          starts_at:  startsAt,
          customer_name:  customerName,
          customer_phone: customerPhone,
          customer_email: customerEmail,
          notes,
          status,
        }),
      });
      if (res.ok) onCreated();
      else { const j = await res.json(); setErr(j.detail || 'Error creating booking'); }
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal bk-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div className="auth-modal-icon-wrap">
              <CalendarPlus size={24} className="auth-modal-icon-svg" />
            </div>
            <div>
              <div className="auth-modal-title">New booking</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">Add an appointment manually.</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          {services.length === 0 ? (
            <p className="crm-placeholder">
              No services configured yet. Open the Settings tab and create a service first.
            </p>
          ) : (
            <>
              <div className="auth-field">
                <label className="auth-label">Service</label>
                <select className="crm-input" value={serviceId}
                  onChange={e => { setServiceId(e.target.value); setStaffId(''); }}>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.duration_minutes} min
                    </option>
                  ))}
                </select>
              </div>

              {(service?.requires_staff || eligibleStaff.length > 0) && (
                <div className="auth-field">
                  <label className="auth-label">
                    Staff{service?.requires_staff ? '' : ' (optional)'}
                  </label>
                  <select className="crm-input" value={staffId}
                    onChange={e => setStaffId(e.target.value)}>
                    <option value="">— Any —</option>
                    {eligibleStaff.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="bk-rules-grid">
                <div className="auth-field">
                  <label className="auth-label">Date</label>
                  <input type="date" className="crm-input" value={date}
                    onChange={e => setDate(e.target.value)} />
                </div>
                <div className="auth-field">
                  <label className="auth-label">Time</label>
                  <input type="time" className="crm-input" value={time}
                    onChange={e => setTime(e.target.value)} />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label">Customer name</label>
                <input className="crm-input" value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Jane Doe" />
              </div>

              <div className="bk-rules-grid">
                <div className="auth-field">
                  <label className="auth-label">Phone</label>
                  <input className="crm-input" value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    placeholder="+1 555 0100" />
                </div>
                <div className="auth-field">
                  <label className="auth-label">Email</label>
                  <input className="crm-input" type="email" value={customerEmail}
                    onChange={e => setCustomerEmail(e.target.value)}
                    placeholder="jane@example.com" />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label">Notes (optional)</label>
                <textarea className="crm-input bk-textarea" rows={2}
                  value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Special requests, allergies, etc." />
              </div>

              <div className="auth-field">
                <label className="auth-label">Initial status</label>
                <select className="crm-input" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending</option>
                </select>
              </div>

              {err && <p className="auth-msg auth-msg--err">{err}</p>}

              <div className="auth-actions">
                <button className="crm-submit-btn" onClick={create} disabled={saving} type="button">
                  {saving ? 'Creating…' : 'Create booking'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default BookingCreateModal;
