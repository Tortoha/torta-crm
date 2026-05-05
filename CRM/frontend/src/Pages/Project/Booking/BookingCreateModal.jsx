import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CalendarPlus, CaretDown, CaretLeft, CaretRight, Calendar as CalendarIcon, Clock } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { DynamicBlock } from '../../../Utils/DynamicBlock.js';

// ── Helpers ────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0');

const todayInTz = (tz) => {
  const s = new Date().toLocaleString('sv-SE', { timeZone: tz });
  return s.slice(0, 10);
};

function tzOffsetMinutes(tz, dateObj) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(dateObj).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
                         +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - dateObj.getTime()) / 60000);
}

function buildIsoWithTz(date, time, tz) {
  const probe = new Date(`${date}T${time}:00Z`);
  const offMin = tzOffsetMinutes(tz, probe);
  const sign = offMin >= 0 ? '+' : '-';
  const abs  = Math.abs(offMin);
  const off  = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${date}T${time}:00${off}`;
}

// ── Generic combobox (Service / Status) ─────────────────────────────
// Same UX as CpmCategorySelect on the product page: rounded pill button,
// portal dropdown, DynamicBlock indicator follows hover.

export function Combobox({ value, options, placeholder = '— Select —', onChange }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [hovered, setHovered] = useState(null);

  const activeKey = String(value);
  const current = hovered ?? activeKey;
  const { indRef, setItemRef } = DynamicBlock(current, open);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const margin = 12;
    const width  = Math.min(r.width, window.innerWidth - margin * 2);
    setPos({ top: r.bottom + 6, left: Math.max(margin, r.left), width });
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPd  = e => {
      if (!e.target.closest?.('.bk-cb-dropdown') && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  const selected = options.find(o => String(o.value) === String(value));

  return (
    <>
      <button ref={btnRef} type="button"
        className={`cpm-cat-btn${open ? ' cpm-cat-btn--open' : ''}`}
        onClick={() => setOpen(v => !v)}>
        <span className={selected ? '' : 'cpm-cat-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <CaretDown weight="bold" className={`cpm-cat-caret${open ? ' cpm-cat-caret--up' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div className="cat-filter-dropdown bk-cb-dropdown"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onMouseLeave={() => setHovered(null)}>
          <div ref={indRef} className="cat-filter-indicator" />
          {options.map(o => {
            const k = String(o.value);
            return (
              <button key={k} ref={setItemRef(k)} type="button"
                className={`cat-filter-item${current === k ? ' cat-filter-item--current' : ''}`}
                onMouseEnter={() => setHovered(k)}
                onClick={() => { onChange(o.value); setOpen(false); }}>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

// ── Date picker ─────────────────────────────────────────────────────
// Click → portal dropdown with month grid. Prev/next month nav. Hovered
// day gets the same DynamicBlock floating pill that follows the cursor.

function DatePicker({ value, onChange, tz }) {
  const btnRef = useRef(null);
  const indRef = useRef(null);
  const cellRefs = useRef({});
  const [open, setOpen]   = useState(false);
  const [pos, setPos]     = useState(null);
  const [view, setView]   = useState(() => {
    const v = value || todayInTz(tz);
    return { y: parseInt(v.slice(0, 4), 10), m: parseInt(v.slice(5, 7), 10) - 1 };
  });
  const [hovered, setHovered] = useState(null);
  const todayStr = todayInTz(tz);
  const current = hovered ?? value;

  // 2-D DynamicBlock indicator — DynamicBlock util only handles Y.
  // For a calendar grid we need both translate(X, Y) and (width, height).
  useEffect(() => {
    const ind = indRef.current;
    if (!ind) return;
    const el = current ? cellRefs.current[current] : null;
    if (!open || !el) { ind.style.opacity = '0'; return; }
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        ind.style.opacity   = '1';
        ind.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
        ind.style.width     = `${el.offsetWidth}px`;
        ind.style.height    = `${el.offsetHeight}px`;
      });
      ind.__raf2 = raf2;
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (ind.__raf2) cancelAnimationFrame(ind.__raf2);
    };
  }, [current, open, view]);

  const setItemRef = (key) => (el) => { cellRefs.current[key] = el; };

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: Math.max(280, r.width) });
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPd  = e => {
      if (!e.target.closest?.('.bk-date-pop') && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  // Build the 6-week grid (42 cells) for the current view month.
  const grid = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m, 1));
    // Monday=0 ... Sunday=6
    const dow = (first.getUTCDay() + 6) % 7;
    const start = new Date(first); start.setUTCDate(1 - dow);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
      cells.push({
        iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        day: d.getUTCDate(),
        outside: d.getUTCMonth() !== view.m,
      });
    }
    return cells;
  }, [view]);

  const monthLabel = useMemo(() => {
    const d = new Date(Date.UTC(view.y, view.m, 1));
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  }, [view]);

  const goPrev = () => setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { ...v, m: v.m - 1 });
  const goNext = () => setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { ...v, m: v.m + 1 });

  const display = value
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${value}T00:00:00Z`))
    : 'Pick a date';

  return (
    <>
      <button ref={btnRef} type="button"
        className={`cpm-cat-btn${open ? ' cpm-cat-btn--open' : ''}`}
        onClick={() => setOpen(v => !v)}>
        <span className="bk-date-icon-row">
          <CalendarIcon size={14} weight="bold" />
          <span>{display}</span>
        </span>
        <CaretDown weight="bold" className={`cpm-cat-caret${open ? ' cpm-cat-caret--up' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div className="bk-date-pop"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onMouseLeave={() => setHovered(null)}>
          <div className="bk-date-head">
            <button type="button" className="bk-date-nav" onClick={goPrev}>
              <CaretLeft weight="bold" size={14} />
            </button>
            <span className="bk-date-month">{monthLabel}</span>
            <button type="button" className="bk-date-nav" onClick={goNext}>
              <CaretRight weight="bold" size={14} />
            </button>
          </div>
          <div className="bk-date-dow">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="bk-date-grid">
            <div ref={indRef} className="bk-date-indicator" />
            {grid.map(c => {
              const isToday = c.iso === todayStr;
              const isSel   = c.iso === value;
              const isCur   = c.iso === current;
              return (
                <button key={c.iso} ref={setItemRef(c.iso)} type="button"
                  className={`bk-date-cell${c.outside ? ' bk-date-cell--out' : ''}${isToday ? ' bk-date-cell--today' : ''}${isSel ? ' bk-date-cell--sel' : ''}${isCur && !isSel ? ' bk-date-cell--current' : ''}`}
                  onMouseEnter={() => setHovered(c.iso)}
                  onClick={() => { onChange(c.iso); setOpen(false); }}>
                  {c.day}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Time picker — iPhone-alarm wheel (transform-based, not native scroll) ──
// Each column shows 5 rows: ±2 around the selected one, fading + scaling
// like the real iOS wheel. Mouse wheel rotates the wheel by one item per
// notch. Restricted to working hours + slot_interval.

const WHEEL_ITEM_H = 36;
const WHEEL_VISIBLE = 5;       // odd — selected sits in the center

function TimeWheel({ items, value, onChange }) {
  const idx = Math.max(0, items.indexOf(value));
  // Drag state — `dragDelta` is in px and re-renders the wheel each move so
  // items follow the cursor smoothly. On release we compute how many slots
  // the drag covered and snap the value to that target.
  const dragRef = useRef(null);              // { startY, startIdx }
  const lastDragSizeRef = useRef(0);         // gates onClick after a drag
  const [dragDelta, setDragDelta] = useState(0);
  const [dragging, setDragging]   = useState(false);

  const onWheel = (e) => {
    e.preventDefault();
    if (dragging) return;
    const delta = e.deltaY > 0 ? 1 : -1;
    const next = Math.max(0, Math.min(items.length - 1, idx + delta));
    if (next !== idx) onChange(items[next]);
  };

  const onPointerDown = (e) => {
    dragRef.current = { startY: e.clientY, startIdx: idx };
    lastDragSizeRef.current = 0;
    setDragDelta(0);
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    setDragDelta(e.clientY - dragRef.current.startY);
  };
  const onPointerUp = (e) => {
    if (!dragRef.current) return;
    const stepsDelta = -Math.round(dragDelta / WHEEL_ITEM_H);
    const startIdx   = dragRef.current.startIdx;
    lastDragSizeRef.current = Math.abs(dragDelta);
    dragRef.current = null;
    setDragging(false);
    setDragDelta(0);
    const targetIdx = Math.max(0, Math.min(items.length - 1, startIdx + stepsDelta));
    if (targetIdx !== idx) onChange(items[targetIdx]);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // Visual selected index — fractional while dragging (items follow cursor sub-pixel).
  const visualIdx = idx - dragDelta / WHEEL_ITEM_H;
  const radius    = Math.floor(WHEEL_VISIBLE / 2);

  return (
    <div className={`bk-time-wheel${dragging ? ' bk-time-wheel--dragging' : ''}`}
      style={{ height: WHEEL_ITEM_H * WHEEL_VISIBLE }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}>
      {items.map((it, i) => {
        const offset = i - visualIdx;
        if (Math.abs(offset) > radius + 0.5) return null;
        const absOff = Math.abs(offset);
        // Continuous interpolation of opacity / scale so items fade smoothly
        // through the wheel rotation, not in discrete steps.
        const opacity = Math.max(0.15, 1 - absOff * 0.40);
        const scale   = Math.max(0.7,  1 - absOff * 0.15);
        const isSel   = i === idx;
        return (
          <button key={it} type="button"
            className={`bk-time-item${isSel ? ' bk-time-item--sel' : ''}`}
            style={{
              transform: `translateY(${offset * WHEEL_ITEM_H}px) scale(${scale})`,
              opacity,
              height: WHEEL_ITEM_H,
            }}
            onClick={(e) => {
              // Suppress click after a drag (>4px = intentional drag, not a tap)
              if (lastDragSizeRef.current > 4) {
                lastDragSizeRef.current = 0;
                e.preventDefault();
                return;
              }
              onChange(it);
            }}>
            {pad(it)}
          </button>
        );
      })}
    </div>
  );
}

export function TimePicker({ value, onChange, workingHours, slotInterval, dayOfWeek }) {
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);

  // Compute valid hours for this weekday from working_hours config.
  // Falls back to 0..23 when the project hasn't configured hours yet.
  const validHours = useMemo(() => {
    if (!workingHours || workingHours.length === 0) {
      return Array.from({ length: 24 }, (_, i) => i);
    }
    const rows = dayOfWeek != null
      ? workingHours.filter(w => Number(w.day_of_week) === Number(dayOfWeek))
      : workingHours;
    if (rows.length === 0) return [];
    const set = new Set();
    for (const r of rows) {
      const o = parseInt((r.open_time || '08:00').slice(0, 2), 10);
      const c = parseInt((r.close_time || '21:00').slice(0, 2), 10);
      const cm = parseInt((r.close_time || '21:00').slice(3, 5), 10);
      const last = c + (cm > 0 ? 0 : -1);
      for (let h = o; h <= last; h++) set.add(h);
    }
    return [...set].sort((a, b) => a - b);
  }, [workingHours, dayOfWeek]);

  // Minutes that align with slot_interval — e.g. step=20 → [0, 20, 40].
  const validMinutes = useMemo(() => {
    const step = Math.max(1, parseInt(slotInterval, 10) || 30);
    const out = [];
    for (let m = 0; m < 60; m += step) out.push(m);
    return out;
  }, [slotInterval]);

  const [h, m] = (value || '00:00').split(':').map(Number);

  // Snap h/m to the valid grids when day/slot config changes.
  useEffect(() => {
    if (!validHours.length || !validMinutes.length) return;
    const newH = validHours.includes(h) ? h : validHours[0];
    const newM = validMinutes.includes(m) ? m : validMinutes[0];
    if (newH !== h || newM !== m) onChange(`${pad(newH)}:${pad(newM)}`);
  }, [validHours, validMinutes]);   // eslint-disable-line

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPd  = e => {
      if (!e.target.closest?.('.bk-time-pop') && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  const setH = (newH) => onChange(`${pad(newH)}:${pad(m)}`);
  const setM = (newM) => onChange(`${pad(h)}:${pad(newM)}`);

  return (
    <>
      <button ref={btnRef} type="button"
        className={`cpm-cat-btn${open ? ' cpm-cat-btn--open' : ''}`}
        onClick={() => setOpen(v => !v)}>
        <span className="bk-date-icon-row">
          <Clock size={14} weight="bold" />
          <span>{value || '—'}</span>
        </span>
        <CaretDown weight="bold" className={`cpm-cat-caret${open ? ' cpm-cat-caret--up' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className="bk-time-pop"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}>
          <div className="bk-time-wheels">
            {/* Center band — fixed pill behind the wheels marking the selected row */}
            <div className="bk-time-band" />
            <TimeWheel items={validHours.length   ? validHours   : [0]} value={h} onChange={setH} />
            <span className="bk-time-colon">:</span>
            <TimeWheel items={validMinutes.length ? validMinutes : [0]} value={m} onChange={setM} />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Modal ──────────────────────────────────────────────────────────

function BookingCreateModal({ projectId, services, staff, businessTz, workingHours, slotInterval, presetStart, onClose, onCreated }) {
  const tz = businessTz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const pq = `?project_id=${projectId}`;

  const presetDate = presetStart ? presetStart.slice(0, 10) : todayInTz(tz);
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
  const eligibleStaff = useMemo(() => {
    if (!service || !staff) return [];
    if (service.staff_ids && service.staff_ids.length > 0) {
      return staff.filter(s => service.staff_ids.includes(s.id));
    }
    return staff;
  }, [service, staff]);

  // Day-of-week (Mon=0 ... Sun=6) for the chosen date — drives TimePicker hours.
  const dow = useMemo(() => {
    if (!date) return null;
    const d = new Date(`${date}T12:00:00Z`);     // noon-anchored to dodge DST
    return (d.getUTCDay() + 6) % 7;
  }, [date]);

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
      const startsAt = buildIsoWithTz(date, time, tz);
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

  // Build option lists for the comboboxes.
  const serviceOptions = services.map(s => ({
    value: s.id, label: `${s.name} · ${s.duration_minutes} min`,
  }));
  const staffOptions = [
    { value: '', label: '— Any —' },
    ...eligibleStaff.map(s => ({ value: s.id, label: s.name })),
  ];
  const statusOptions = [
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'pending',   label: 'Pending'   },
  ];

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
                <Combobox value={serviceId} options={serviceOptions}
                  onChange={(v) => { setServiceId(v); setStaffId(''); }} />
              </div>

              {(service?.requires_staff || eligibleStaff.length > 0) && (
                <div className="auth-field">
                  <label className="auth-label">
                    Staff{service?.requires_staff ? '' : ' (optional)'}
                  </label>
                  <Combobox value={staffId} options={staffOptions}
                    onChange={setStaffId} placeholder="— Any —" />
                </div>
              )}

              <div className="bk-rules-grid">
                <div className="auth-field">
                  <label className="auth-label">Date</label>
                  <DatePicker value={date} onChange={setDate} tz={tz} />
                </div>
                <div className="auth-field">
                  <label className="auth-label">
                    Time <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>· {tz}</span>
                  </label>
                  <TimePicker value={time} onChange={setTime}
                    workingHours={workingHours} slotInterval={slotInterval} dayOfWeek={dow} />
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
                <Combobox value={status} options={statusOptions} onChange={setStatus} />
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
