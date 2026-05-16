import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, User, UploadSimple } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { TimePicker } from './BookingCreateModal.jsx';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Modal for creating / editing a staff member, plus their per-day working hours.
function BookingStaffModal({ projectId, member, allServices, slotInterval = 30, onClose, onSaved }) {
  const pq = `?project_id=${projectId}`;
  const isEdit = !!member;

  const [form, setForm] = useState(() => ({
    name:        member?.name        ?? '',
    avatar_url:  member?.avatar_url  ?? '',
    bio:         member?.bio         ?? '',
    is_active:   member?.is_active   ?? true,
    service_ids: member?.service_ids ?? [],
    commission_pct: member?.commission_pct ?? 0,
  }));
  const [hours, setHours] = useState(() =>
    DAY_NAMES.map((_, i) => ({ day_of_week: i, open_time: '10:00', close_time: '19:00', enabled: false }))
  );
  const [saving,    setSaving]    = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err,       setErr]       = useState('');
  const fileRef = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/upload/image${pq}`, {
        method: 'POST', credentials: 'include', body: fd,
      });
      const data = await res.json();
      if (res.ok && data.url) upd('avatar_url', data.url);
      else setErr('Upload failed');
    } finally { setUploading(false); }
  };

  // Load existing hours when editing
  useEffect(() => {
    if (!isEdit) return;
    fetch(`${API_BASE}/api/booking/hours${pq}&staff_id=${member.id}`, { credentials: 'include' })
      .then(r => r.json()).then(data => {
        const next = DAY_NAMES.map((_, i) => {
          const found = data.find(d => d.day_of_week === i);
          return found
            ? { day_of_week: i, open_time: found.open_time, close_time: found.close_time, enabled: true }
            : { day_of_week: i, open_time: '10:00', close_time: '19:00', enabled: false };
        });
        setHours(next);
      });
  }, [isEdit, member?.id, projectId]);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleService = (id) => setForm(f => ({
    ...f,
    service_ids: f.service_ids.includes(id)
      ? f.service_ids.filter(x => x !== id)
      : [...f.service_ids, id],
  }));
  const updHour = (i, k, v) => setHours(prev => prev.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  const save = async () => {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setSaving(true); setErr('');
    try {
      const url = isEdit
        ? `${API_BASE}/api/booking/staff/${member.id}${pq}`
        : `${API_BASE}/api/booking/staff${pq}`;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          avatar_url: form.avatar_url || null,
          commission_pct: Math.max(0, Math.min(100, parseInt(form.commission_pct, 10) || 0)),
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setErr(j.detail || 'Error saving'); setSaving(false); return;
      }
      const data = await res.json();
      const staffId = isEdit ? member.id : data.id;

      // Save hours
      await fetch(`${API_BASE}/api/booking/hours${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staff_id: staffId,
          rows: hours.filter(r => r.enabled).map(r => ({
            day_of_week: r.day_of_week, open_time: r.open_time, close_time: r.close_time,
          })),
        }),
      });
      onSaved();
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal bk-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div className="auth-modal-icon-wrap">
              {form.avatar_url
                ? <img src={form.avatar_url} className="bk-modal-avatar" alt="" />
                : <User size={24} className="auth-modal-icon-svg" />}
            </div>
            <div>
              <div className="auth-modal-title">{isEdit ? 'Edit staff member' : 'New staff member'}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">Set their services and weekly schedule.</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <div className="auth-field">
            <label className="auth-label">Name</label>
            <input className="crm-input" value={form.name}
              onChange={e => upd('name', e.target.value)}
              placeholder="John Smith" />
          </div>

          <div className="auth-field">
            <label className="auth-label">Staff photo (optional)</label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden-input"
              onChange={e => upload(e.target.files?.[0])} />
            {form.avatar_url ? (
              <div className="bk-svc-img-preview">
                <img src={form.avatar_url} alt="" />
                <div className="bk-svc-img-actions">
                  <button type="button" className="crm-submit-btn auth-btn-secondary"
                    onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? 'Uploading…' : 'Replace'}
                  </button>
                  <button type="button" className="auth-btn-danger"
                    onClick={() => upd('avatar_url', '')}>Remove</button>
                </div>
              </div>
            ) : (
              <button type="button" className="bk-svc-img-drop"
                onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? (
                  <span>Uploading…</span>
                ) : (
                  <>
                    <UploadSimple weight="bold" size={20} />
                    <span>Click to upload a photo</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="auth-field">
            <label className="auth-label">Bio (optional)</label>
            <textarea className="crm-input bk-textarea" rows={2}
              value={form.bio} onChange={e => upd('bio', e.target.value)}
              placeholder="Senior stylist · 10 years experience" />
          </div>

          <div className="auth-field">
            <label className="auth-label">Commission (%)</label>
            <p className="auth-field-hint">
              Informational. Displayed in the staff analytics so you can compute
              this person's payout manually — the CRM does not automate payroll.
            </p>
            <input className="crm-input" type="number" min={0} max={100}
              value={form.commission_pct}
              onChange={e => upd('commission_pct', e.target.value)} />
          </div>

          <div className="auth-toggle-row">
            <div>
              <span className="auth-toggle-label">Active</span>
              <p className="auth-field-hint">Inactive staff are hidden from booking forms.</p>
            </div>
            <label className="auth-toggle">
              <input type="checkbox" checked={form.is_active}
                onChange={e => upd('is_active', e.target.checked)} />
              <span className="auth-toggle-track" />
            </label>
          </div>

          {allServices && allServices.length > 0 && (
            <div className="auth-field">
              <label className="auth-label">Services this person can deliver</label>
              {/* Same checkbox row pattern as the Categories → Add products picker. */}
              <div className="bk-staff-services">
                {allServices.map(s => {
                  const checked = form.service_ids.includes(s.id);
                  return (
                    <label key={s.id}
                      className={`cat-prod-row${checked ? ' cat-prod-row--checked' : ''}`}>
                      <input type="checkbox" className="cat-prod-checkbox"
                        checked={checked} onChange={() => toggleService(s.id)} />
                      <span className="cat-prod-title">{s.name}</span>
                      <span className="cat-prod-badge">
                        {s.duration_minutes} min · ${Number(s.price || 0).toFixed(0)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="auth-sep" />

          <div className="auth-field">
            <label className="auth-label">Weekly schedule</label>
            <p className="auth-field-hint">Select days and set open/close times.</p>
            <div className="bk-hours-block">
              {hours.map((r, i) => (
                <div key={i}
                  className={`bk-hours-row cat-prod-row${r.enabled ? ' cat-prod-row--checked' : ''}`}>
                  <label className="bk-hours-day">
                    <input type="checkbox" className="cat-prod-checkbox"
                      checked={r.enabled}
                      onChange={e => updHour(i, 'enabled', e.target.checked)} />
                    <span>{DAY_NAMES[i]}</span>
                  </label>
                  <div className="bk-hours-time-wrap" data-disabled={!r.enabled || undefined}>
                    <TimePicker value={r.open_time} slotInterval={slotInterval}
                      onChange={(v) => updHour(i, 'open_time', v)} />
                  </div>
                  <span className="bk-hours-dash">–</span>
                  <div className="bk-hours-time-wrap" data-disabled={!r.enabled || undefined}>
                    <TimePicker value={r.close_time} slotInterval={slotInterval}
                      onChange={(v) => updHour(i, 'close_time', v)} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {err && <p className="auth-msg auth-msg--err">{err}</p>}

          <div className="auth-actions">
            <button className="crm-submit-btn" onClick={save} disabled={saving} type="button">
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create staff'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default BookingStaffModal;
