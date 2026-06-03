import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation, Trans } from 'react-i18next';
import { X, UploadSimple, Image as ImageIcon } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { presignedUpload } from '../../../Utils/upload.js';

// New-service modal. Creates a `products` row with type=service (which
// auto-seeds a linked booking_service via backend), then PUTs the
// service-specific fields. Only used for CREATE — editing existing services
// jumps straight to /product/{hash} (see Booking.jsx → onEditService).
function BookingServiceModal({ projectId, service, allStaff, onClose, onSaved }) {
  const { t } = useTranslation();
  const pq = `?project_id=${projectId}`;
  const isEdit = !!service;
  const fileRef = useRef(null);

  const [form, setForm] = useState(() => ({
    name:             service?.name             ?? '',
    subtitle:         service?.subtitle         ?? '',
    description:      service?.description      ?? '',
    duration_minutes: service?.duration_minutes ?? 30,
    price:            service?.price            ?? 0,
    image_url:        service?.image_url        ?? '',
    is_active:        service?.is_active        ?? true,
    requires_staff:   service?.requires_staff   ?? false,
    capacity:         service?.capacity         ?? 1,
    staff_ids:        service?.staff_ids        ?? [],
    location_type:    service?.location_type    ?? 'shop',
  }));
  const [saving,    setSaving]    = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err,       setErr]       = useState('');

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleStaff = (id) => setForm(f => ({
    ...f,
    staff_ids: f.staff_ids.includes(id)
      ? f.staff_ids.filter(x => x !== id)
      : [...f.staff_ids, id],
  }));

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await presignedUpload(file, { pq, kind: 'image' });
      if (url) upd('image_url', url);
    } catch (e) {
      if (!e.planLimit) setErr(e.message || t('booking.serviceModal.uploadFailed'));
    } finally { setUploading(false); }
  };

  // CREATE: products → backend auto-creates booking_service → PUT booking_service with details.
  // EDIT (legacy, for services without product_id): plain PUT /booking/services.
  const save = async () => {
    if (!form.name.trim()) { setErr(t('booking.serviceModal.err.nameRequired')); return; }
    if (form.duration_minutes < 5) { setErr(t('booking.serviceModal.err.durationMin')); return; }
    setSaving(true); setErr('');
    try {
      const payload = {
        ...form,
        price: parseFloat(form.price) || 0,
        duration_minutes: parseInt(form.duration_minutes, 10) || 30,
        capacity: parseInt(form.capacity, 10) || 1,
        image_url: form.image_url || null,
      };

      if (!isEdit) {
        // 1) Create the product row (backend seeds booking_services with defaults).
        const pRes = await fetch(`${API_BASE}/api/products${pq}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title:        form.name.trim(),
            subtitle:     form.subtitle?.trim() || null,
            description:  form.description?.trim() || null,
            product_type: 'service',
          }),
        });
        const pData = await pRes.json();
        if (!pRes.ok) { setErr(pData.detail || t('booking.serviceModal.err.createError')); return; }

        // 2) Find the booking_service the backend just created (one per product_id).
        const listRes = await fetch(`${API_BASE}/api/booking/services${pq}`, { credentials: 'include' });
        const list = listRes.ok ? await listRes.json() : [];
        const linked = (list || []).find(s => s.product_id === pData.id);
        if (linked) {
          await fetch(`${API_BASE}/api/booking/services/${linked.id}${pq}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, name: form.name.trim() }),
          });
        }
        onSaved();
        return;
      }

      // EDIT (legacy): existing booking_service without a product link.
      const res = await fetch(`${API_BASE}/api/booking/services/${service.id}${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) onSaved();
      else { const j = await res.json(); setErr(j.detail || t('booking.serviceModal.err.saveError')); }
    } catch { setErr(t('common.networkError')); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal bk-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{isEdit ? t('booking.serviceModal.editTitle') : t('booking.serviceModal.newTitle')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">{t('booking.serviceModal.subtitle')}</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <div className="auth-field">
            <label className="auth-label">{t('booking.serviceModal.serviceName')}</label>
            <input className="crm-input" value={form.name}
              onChange={e => upd('name', e.target.value)}
              placeholder={t('booking.serviceModal.serviceNamePlaceholder')} />
          </div>

          <div className="auth-field">
            <label className="auth-label">{t('booking.serviceModal.subtitleLabel')}</label>
            <input className="crm-input" value={form.subtitle}
              onChange={e => upd('subtitle', e.target.value)}
              placeholder={t('booking.serviceModal.subtitlePlaceholder')} />
          </div>

          <div className="auth-field">
            <label className="auth-label">{t('booking.serviceModal.description')}</label>
            <textarea className="crm-input bk-textarea" rows={3}
              value={form.description} onChange={e => upd('description', e.target.value)}
              placeholder={t('booking.serviceModal.descriptionPlaceholder')} />
          </div>

          <div className="bk-rules-grid">
            <div className="auth-field">
              <label className="auth-label">{t('booking.serviceModal.duration')}</label>
              <input className="crm-input" type="number" min={5} max={1440}
                value={form.duration_minutes}
                onChange={e => upd('duration_minutes', e.target.value)} />
            </div>
            <div className="auth-field">
              <label className="auth-label">{t('booking.serviceModal.price')}</label>
              <input className="crm-input" type="number" min={0} step="0.01"
                value={form.price} onChange={e => upd('price', e.target.value)} />
            </div>
          </div>

          <div className="auth-field">
            <label className="auth-label">{t('booking.serviceModal.image')}</label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden-input"
              onChange={e => upload(e.target.files?.[0])} />
            {form.image_url ? (
              <div className="bk-svc-img-preview">
                <img src={form.image_url} alt="" />
                <div className="bk-svc-img-actions">
                  <button type="button" className="crm-submit-btn auth-btn-secondary"
                    onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? t('booking.serviceModal.uploading') : t('booking.serviceModal.replace')}
                  </button>
                  <button type="button" className="auth-btn-danger"
                    onClick={() => upd('image_url', '')}>{t('booking.serviceModal.remove')}</button>
                </div>
              </div>
            ) : (
              <button type="button" className="bk-svc-img-drop"
                onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? (
                  <span>{t('booking.serviceModal.uploading')}</span>
                ) : (
                  <>
                    <UploadSimple weight="bold" size={20} />
                    <span>{t('booking.serviceModal.uploadImage')}</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="auth-sep" />

          <div className="auth-toggle-row">
            <div>
              <span className="auth-toggle-label">{t('booking.serviceModal.visible')}</span>
              <p className="auth-field-hint">{t('booking.serviceModal.visibleHint')}</p>
            </div>
            <label className="auth-toggle">
              <input type="checkbox" checked={form.is_active}
                onChange={e => upd('is_active', e.target.checked)} />
              <span className="auth-toggle-track" />
            </label>
          </div>

          <div className="auth-toggle-row">
            <div>
              <span className="auth-toggle-label">{t('booking.serviceModal.requiresStaff')}</span>
              <p className="auth-field-hint">
                {t('booking.serviceModal.requiresStaffHintLine1')}<br />
                <Trans i18nKey="booking.serviceModal.requiresStaffHintLine2" components={{ 1: <b /> }} />
              </p>
            </div>
            <label className="auth-toggle">
              <input type="checkbox" checked={form.requires_staff}
                onChange={e => upd('requires_staff', e.target.checked)} />
              <span className="auth-toggle-track" />
            </label>
          </div>

          {!form.requires_staff && (
            <div className="auth-field">
              <label className="auth-label">{t('booking.serviceModal.capacity')}</label>
              <p className="auth-field-hint">{t('booking.serviceModal.capacityHint')}</p>
              <input className="crm-input" type="number" min={1}
                value={form.capacity} onChange={e => upd('capacity', e.target.value)} />
            </div>
          )}

          <div className="auth-field">
            <label className="auth-label">{t('booking.serviceModal.locationLabel')}</label>
            <p className="auth-field-hint">
              <b>{t('booking.serviceModal.locationHintShop')}</b>{t('booking.serviceModal.locationHintShopText')}&nbsp;
              <b>{t('booking.serviceModal.locationHintCustomer')}</b>{t('booking.serviceModal.locationHintCustomerText')}&nbsp;
              <b>{t('booking.serviceModal.locationHintEither')}</b>{t('booking.serviceModal.locationHintEitherText')}
            </p>
            <div className="bk-loc-pick">
              {['shop', 'customer', 'either'].map(opt => (
                <button key={opt} type="button"
                  className={`bk-loc-pick-btn${form.location_type === opt ? ' bk-loc-pick-btn--on' : ''}`}
                  onClick={() => upd('location_type', opt)}>
                  {opt === 'shop' ? t('booking.serviceModal.locShop') : opt === 'customer' ? t('booking.serviceModal.locCustomer') : t('booking.serviceModal.locEither')}
                </button>
              ))}
            </div>
          </div>

          {allStaff && allStaff.length > 0 && (
            <div className="auth-field">
              <label className="auth-label">{t('booking.serviceModal.staffLabel')}</label>
              <p className="auth-field-hint">
                {form.requires_staff
                  ? t('booking.serviceModal.staffHintRequired')
                  : t('booking.serviceModal.staffHintOptional')}
              </p>
              <div className="bk-staff-pick">
                {allStaff.map(s => (
                  <button key={s.id} type="button"
                    className={`bk-staff-pick-btn${form.staff_ids.includes(s.id) ? ' bk-staff-pick-btn--on' : ''}`}
                    onClick={() => toggleStaff(s.id)}>
                    {s.avatar_url
                      ? <img src={s.avatar_url} className="bk-staff-pick-avatar" alt="" />
                      : <span className="bk-staff-pick-avatar bk-staff-pick-avatar--empty" />}
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {err && <p className="auth-msg auth-msg--err">{err}</p>}

          <div className="auth-actions">
            <button className="crm-submit-btn" onClick={save} disabled={saving} type="button">
              {saving ? t('booking.serviceModal.saving') : isEdit ? t('booking.serviceModal.saveChanges') : t('booking.serviceModal.createService')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default BookingServiceModal;
