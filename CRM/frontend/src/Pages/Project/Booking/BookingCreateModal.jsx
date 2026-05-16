import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CalendarPlus, CaretDown, CaretLeft, CaretRight, Calendar as CalendarIcon, Clock, Briefcase, PencilSimple } from '@phosphor-icons/react';
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

// ── Generic combobox (Service / Status) — same UX as CpmCategorySelect: pill button + portal dropdown + DynamicBlock. ──

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
    // Smart up/down: if there's < 200px below the trigger (typical for the
    // last input on a settings page), flip the dropdown above the trigger.
    // maxHeight gets clamped to whichever side we land on so the dropdown
    // always stays inside the viewport — no scroll-trapped popup.
    //
    // CRITICAL: when flipping up, we anchor the dropdown's BOTTOM edge to
    // the trigger using a `bottom` CSS value instead of converting to a `top`.
    // Going via `top: triggerTop - maxHeight` would leave a huge gap above
    // when the actual dropdown is shorter than maxHeight (e.g. a 2-option
    // status picker with maxHeight=360 → the dropdown floats 300px above
    // the trigger, blocking the page). With `bottom` anchoring, the visual
    // height naturally shrinks to the actual content height and the dropdown
    // hugs the trigger.
    const MAX_H = 360;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const flipUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = flipUp ? Math.min(MAX_H, spaceAbove) : Math.min(MAX_H, spaceBelow);
    if (flipUp) {
      setPos({
        bottom: window.innerHeight - r.top + 6,
        left:   Math.max(margin, r.left),
        width, maxHeight,
      });
    } else {
      setPos({
        top:  r.bottom + 6,
        left: Math.max(margin, r.left),
        width, maxHeight,
      });
    }
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
          style={{
            ...(pos.top    != null ? { top:    pos.top }    : null),
            ...(pos.bottom != null ? { bottom: pos.bottom } : null),
            left: pos.left, width: pos.width, maxHeight: pos.maxHeight,
          }}
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

// ── Date picker — portal dropdown with month grid, prev/next nav, DynamicBlock pill on hover. ──

export function DatePicker({ value, onChange, tz }) {
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

  // 2-D indicator: DynamicBlock util only handles Y; calendar grid needs translate(X,Y) + (width,height).
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
    const width = Math.max(280, r.width);
    // The 6-week grid pop-up is ~320px tall — flip above the trigger when
    // there isn't enough room below (last input on a scrolled modal).
    // Anchoring via `bottom` instead of computing a `top` keeps the pop-up
    // visually hugging the trigger even when the grid is shorter than max.
    const POP_H = 340;
    const margin = 12;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const flipUp = spaceBelow < POP_H && spaceAbove > spaceBelow;
    if (flipUp) {
      setPos({ bottom: window.innerHeight - r.top + 6, left: r.left, width });
    } else {
      setPos({ top: r.bottom + 6, left: r.left, width });
    }
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
          style={{
            ...(pos.top    != null ? { top:    pos.top }    : null),
            ...(pos.bottom != null ? { bottom: pos.bottom } : null),
            left: pos.left, width: pos.width,
          }}
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

// ── Time picker — iPhone-alarm wheel (transform-based); 5 rows fading+scaling, restricted to working hours + slot_interval. ──

const WHEEL_ITEM_H = 36;
const WHEEL_VISIBLE = 5;       // odd — selected sits in the center

function TimeWheel({ items, value, onChange }) {
  const idx = Math.max(0, items.indexOf(value));
  // Drag state: dragDelta (px) re-renders wheel each move; on release, compute slots covered and snap value.
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
        // Continuous opacity/scale interpolation for smooth fade through wheel rotation.
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

  // Valid hours for this weekday from working_hours; falls back to 0..23 when unset.
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
    // Wheel pop-up is ~200px tall (5 visible rows × 36 + chrome). Flip up
    // when the trigger sits near the bottom of the viewport — same logic
    // as the DatePicker above.
    const POP_H = 220;
    const margin = 12;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const flipUp = spaceBelow < POP_H && spaceAbove > spaceBelow;
    if (flipUp) {
      setPos({ bottom: window.innerHeight - r.top + 6, left: r.left, width: r.width });
    } else {
      setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    }
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
          style={{
            ...(pos.top    != null ? { top:    pos.top }    : null),
            ...(pos.bottom != null ? { bottom: pos.bottom } : null),
            left: pos.left, width: pos.width,
          }}
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

// ── Mode tabs (Catalog / Freeform) ────────────────────────────────
// Same pill-indicator look as the main Bookings page tabs — copy of
// `auth-tab-switcher` so the visual language is consistent.
function ModeTabs({ freeform, setFreeform, catalogDisabled }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const active = freeform ? 'freeform' : 'catalog';
  const current = hovered ?? active;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[current];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [current, active]);

  const TABS = [
    { key: 'catalog',  label: 'From catalog', Icon: Briefcase,     disabled: catalogDisabled },
    { key: 'freeform', label: 'Freeform',     Icon: PencilSimple,  disabled: false },
  ];

  return (
    <div className="auth-tab-switcher bk-mode-tabs"
         onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="auth-tab-indicator" />
      {TABS.map(({ key, label, Icon, disabled }) => (
        <button key={key} ref={el => { btnRefs.current[key] = el; }}
          className={`auth-tab-btn${active === key ? ' auth-tab-btn--active' : ''}`}
          onMouseEnter={() => !disabled && setHovered(key)}
          onClick={() => !disabled && setFreeform(key === 'freeform')}
          disabled={disabled}
          type="button">
          <Icon className="auth-tab-icon" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────

function BookingCreateModal({ projectId, services, staff, businessTz, workingHours, slotInterval, presetStart, onClose, onCreated }) {
  const tz = businessTz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const pq = `?project_id=${projectId}`;

  const presetDate = presetStart ? presetStart.slice(0, 10) : todayInTz(tz);
  const presetTime = presetStart ? presetStart.slice(11, 16) : '10:00';

  // Freeform mode = no catalog service; user types the service name + duration + price.
  // Sensible default: if there are services to pick from, start in service mode.
  const [freeform,      setFreeform]      = useState(services.length === 0);
  const [serviceId,     setServiceId]     = useState(services[0]?.id ?? '');
  const [staffId,       setStaffId]       = useState('');
  const [date,          setDate]          = useState(presetDate);
  const [time,          setTime]          = useState(presetTime);
  const [customerName,  setCustomerName]  = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [notes,         setNotes]         = useState('');
  const [status,        setStatus]        = useState('confirmed');
  // Freeform fields (used only when freeform=true)
  const [freeName,      setFreeName]      = useState('');
  const [freeDur,       setFreeDur]       = useState(30);
  const [freePrice,     setFreePrice]     = useState('');
  const [saving,        setSaving]        = useState(false);
  const [err,           setErr]           = useState('');

  const service = useMemo(
    () => freeform ? null : services.find(s => s.id === parseInt(serviceId, 10)),
    [freeform, services, serviceId]
  );
  // 'shop' | 'customer' | 'either'. In freeform mode the caller decides — default 'shop'.
  const locType = service?.location_type || 'shop';
  // Address field is always rendered — it's useful even for in-shop services
  // (e.g. courier add-on, follow-up visit). Only REQUIRED when the service
  // is explicitly delivered at the customer's location.
  const addressRequired = !freeform && locType === 'customer';
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
    if (!freeform && !serviceId) { setErr('Pick a service'); return; }
    if (freeform) {
      if (!freeName.trim())           { setErr('Service name is required'); return; }
      const d = parseInt(freeDur, 10);
      if (!d || d < 5 || d > 1440)    { setErr('Duration must be 5–1440 minutes'); return; }
    }
    if (!customerName.trim()) { setErr('Customer name required'); return; }
    if (service?.requires_staff && !staffId) {
      setErr('This service requires choosing a staff member'); return;
    }
    if (addressRequired && !customerAddress.trim()) {
      setErr('This service is delivered at the customer’s location — please add the address.');
      return;
    }
    setSaving(true); setErr('');
    try {
      const startsAt = buildIsoWithTz(date, time, tz);
      const body = {
        staff_id:        staffId ? parseInt(staffId, 10) : null,
        starts_at:       startsAt,
        customer_name:   customerName,
        customer_phone:  customerPhone,
        customer_email:  customerEmail,
        customer_address: customerAddress,
        notes,
        status,
      };
      if (freeform) {
        body.service_id              = null;
        body.freeform_service_name   = freeName.trim();
        body.freeform_duration_minutes = parseInt(freeDur, 10);
        body.freeform_price          = freePrice === '' ? null : parseFloat(freePrice);
      } else {
        body.service_id = parseInt(serviceId, 10);
      }
      const res = await fetch(`${API_BASE}/api/booking/bookings${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
          {/* Mode toggle — same pill-tab look as the main Bookings page tabs.
              "From catalog" = pick from the project's services list; "Freeform"
              = type service name + duration + price on the fly. */}
          <ModeTabs freeform={freeform} setFreeform={setFreeform}
                    catalogDisabled={services.length === 0} />

          {(!freeform && services.length === 0) ? (
            <p className="crm-placeholder">
              No services configured yet — switch to <b>Freeform</b> above or open the Settings tab and create a service first.
            </p>
          ) : (
            <>
              {freeform ? (
                <>
                  <div className="auth-field">
                    <label className="auth-label">Service name</label>
                    <input className="crm-input" value={freeName}
                      onChange={e => setFreeName(e.target.value)}
                      placeholder="House call · Custom repair · Anything" />
                  </div>
                  <div className="bk-rules-grid">
                    <div className="auth-field">
                      <label className="auth-label">Duration (minutes)</label>
                      <input className="crm-input" type="number" min={5} max={1440}
                        value={freeDur} onChange={e => setFreeDur(e.target.value)} />
                    </div>
                    <div className="auth-field">
                      <label className="auth-label">Price (optional)</label>
                      <input className="crm-input" type="number" min={0} step="0.01"
                        value={freePrice} onChange={e => setFreePrice(e.target.value)}
                        placeholder="0.00" />
                    </div>
                  </div>
                </>
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
                </>
              )}

              {freeform && (
                <div className="auth-field">
                  <label className="auth-label">Staff (optional)</label>
                  <Combobox value={staffId}
                    options={[{ value: '', label: '— Any —' }, ...staff.map(s => ({ value: s.id, label: s.name }))]}
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
                <label className="auth-label">
                  Customer address{addressRequired ? '' : ' (optional)'}
                </label>
                {addressRequired && (
                  <p className="auth-field-hint">
                    This service is delivered at the customer's location.
                  </p>
                )}
                <input className="crm-input" value={customerAddress}
                  onChange={e => setCustomerAddress(e.target.value)}
                  placeholder="221B Baker Street, London" />
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
