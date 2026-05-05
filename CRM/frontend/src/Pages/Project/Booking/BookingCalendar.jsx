import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretLeft, CaretRight, CaretDown, User, UserGear, Phone, ChatText, Users } from '@phosphor-icons/react';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import { Combobox } from './BookingCreateModal.jsx';

// Tilt config for empty/busy slot cells — matches the same gentle 3D tilt
// you see on org cards (Dashboard / Organization / Products grid).
const CELL_TILT = {
  maxAngle: 14, lerp: 0.05, lerpOut: 0.07,
  scale: 1.04, perspective: 600,
  gloss: { opacity: 0.14, spread: 50 },
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Variable row heights: empty hours stay compact, hours containing a
// booking-start expand so the booking card has room for full info.
// Both values are also exposed to CSS via custom properties (--cell-h on each
// cell) so the actual `height` rule lives in Booking.css, not inline style.
const ROW_MIN  = 48;     // empty hour
const ROW_BUSY = 100;    // hour with at least one booking start
// Block height floor — shorter bookings still get enough room to be readable.
const BLOCK_MIN_HEIGHT = 96;
const DEFAULT_FIRST_HOUR = 8;
const DEFAULT_LAST_HOUR  = 22;     // exclusive — i.e. 8..21 visible


// Project the given Date instant into the named TZ and return its parts.
function partsInTz(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out; // { year, month, day, hour, minute, weekday }
}

// Compute the visible hour window from the project's working hours so that
// shops open early or late aren't clipped.
//   "07:30" → 7,    "22:30" → 23
function computeHourRange(workingHours) {
  if (!Array.isArray(workingHours) || workingHours.length === 0) {
    return [DEFAULT_FIRST_HOUR, DEFAULT_LAST_HOUR];
  }
  let first = 24, last = 0;
  for (const w of workingHours) {
    const o = (w.open_time  || '08:00').split(':').map(Number);
    const c = (w.close_time || '21:00').split(':').map(Number);
    first = Math.min(first, o[0] || 0);
    // Round close-time minutes up so a "22:30" close gives last=23
    last  = Math.max(last,  (c[0] || 0) + ((c[1] || 0) > 0 ? 1 : 0));
  }
  if (first >= last) return [DEFAULT_FIRST_HOUR, DEFAULT_LAST_HOUR];
  return [Math.max(0, first), Math.min(24, last)];
}

// Status → human label for the card badge
const STATUS_LABEL = {
  pending:   'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show:   'No-show',
};

const pad = n => String(n).padStart(2, '0');

// Get the Monday of the week containing today, in the BUSINESS timezone.
// Returns a Date pinned at 12:00 UTC on that Monday — noon avoids DST edge
// cases that bite midnight-anchored dates near spring-forward transitions.
function startOfWeekInTz(tz) {
  const today = partsInTz(new Date(), tz);
  const todayY = +today.year, todayM = +today.month, todayD = +today.day;
  // Monday=0, Tuesday=1, ..., Sunday=6
  const dowMap = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const dow = dowMap[today.weekday] ?? 0;
  // Build a UTC noon Date and step back `dow` days
  const d = new Date(Date.UTC(todayY, todayM - 1, todayD, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

// Format the calendar grid date as "YYYY-MM-DD" — uses UTC fields because
// our weekDays are pinned to UTC noon (see startOfWeekInTz).
const toISODate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const toISOLocal = (d, h, m) => `${toISODate(d)}T${pad(h)}:${pad(m)}`;

// Week picker — month grid with the DynamicBlock indicator stretched to
// span the entire week row that the cursor is over. Click any day → set the
// calendar anchor to the Monday of that week.
function WeekPicker({ anchorDate, onPickWeek, label }) {
  const btnRef = useRef(null);
  const indRef = useRef(null);
  const rowRefs = useRef({});       // weekIndex → row element
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState(null);
  const [view, setView] = useState(() => ({
    y: anchorDate.getUTCFullYear(),
    m: anchorDate.getUTCMonth(),
  }));
  const [hoveredRow, setHoveredRow] = useState(null);

  // The currently-anchored week — one row in the grid, used as default highlight
  const anchorISO = `${anchorDate.getUTCFullYear()}-${String(anchorDate.getUTCMonth() + 1).padStart(2, '0')}-${String(anchorDate.getUTCDate()).padStart(2, '0')}`;

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: Math.max(280, r.width) });
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPd  = e => {
      if (!e.target.closest?.('.bk-week-pop') && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  // Build 6×7 grid of dates for the current view-month (cells outside fade).
  const grid = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m, 1));
    const dow = (first.getUTCDay() + 6) % 7;        // Mon=0..Sun=6
    const start = new Date(first); start.setUTCDate(1 - dow);
    const out = [];
    for (let r = 0; r < 6; r++) {
      const row = [];
      for (let c = 0; c < 7; c++) {
        const d = new Date(start);
        d.setUTCDate(start.getUTCDate() + r * 7 + c);
        row.push({
          y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(),
          iso: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
          weekStart: r === 0 && c === 0 ? new Date(d) : null,
          outside: d.getUTCMonth() !== view.m,
          dateObj: new Date(d),
        });
      }
      out.push(row);
    }
    return out;
  }, [view]);

  // Find which week (row index) contains the anchor — used for the default highlight
  const anchorRow = useMemo(() => {
    for (let i = 0; i < grid.length; i++) {
      if (grid[i].some(c => c.iso === anchorISO)) return i;
      // Also detect when anchorDate is in this week even if outside the view month
      const ws = grid[i][0].dateObj;
      const we = grid[i][6].dateObj;
      if (anchorDate >= ws && anchorDate <= we) return i;
    }
    return null;
  }, [grid, anchorISO, anchorDate]);

  const currentRow = hoveredRow ?? anchorRow;

  // Position the indicator pill across the active row.
  // `pos` in the dep list — the popup portal mounts on a later render than
  // setOpen(true), so without this dep the effect would fire BEFORE the row
  // refs are assigned and the indicator would stay invisible until you hover.
  useEffect(() => {
    const ind = indRef.current;
    if (!ind) return;
    if (!open || currentRow == null) { ind.style.opacity = '0'; return; }
    // Double-RAF so layout has fully committed before reading offsetTop.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        const el = rowRefs.current[currentRow];
        if (!el) { ind.style.opacity = '0'; return; }
        ind.style.opacity   = '1';
        ind.style.transform = `translateY(${el.offsetTop}px)`;
        ind.style.height    = `${el.offsetHeight}px`;
      });
      ind.__raf2 = raf2;
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (ind.__raf2) cancelAnimationFrame(ind.__raf2);
    };
  }, [currentRow, open, view, pos]);

  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(view.y, view.m, 1)));
  const goPrev = () => setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { ...v, m: v.m - 1 });
  const goNext = () => setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { ...v, m: v.m + 1 });

  const pickWeek = (rowIdx) => {
    const monday = grid[rowIdx][0].dateObj;
    onPickWeek(monday);
    setOpen(false);
  };

  return (
    <>
      <button ref={btnRef} type="button" className="bk-cal-range-btn"
        onClick={() => setOpen(v => !v)}>
        <span>{label}</span>
        <CaretDown weight="bold" size={12} className={`bk-cal-range-caret${open ? ' bk-cal-range-caret--up' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div className="bk-week-pop"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onMouseLeave={() => setHoveredRow(null)}>
          <div className="bk-date-head">
            <button type="button" className="bk-date-nav" onClick={goPrev}><CaretLeft weight="bold" size={14} /></button>
            <span className="bk-date-month">{monthLabel}</span>
            <button type="button" className="bk-date-nav" onClick={goNext}><CaretRight weight="bold" size={14} /></button>
          </div>
          <div className="bk-date-dow">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="bk-week-grid">
            <div ref={indRef} className="bk-week-indicator" />
            {grid.map((row, r) => (
              <div key={r}
                className={`bk-week-row${r === currentRow ? ' bk-week-row--current' : ''}`}
                ref={el => { rowRefs.current[r] = el; }}
                onMouseEnter={() => setHoveredRow(r)}
                onClick={() => pickWeek(r)}>
                {row.map(c => (
                  <span key={c.iso}
                    className={`bk-week-cell${c.outside ? ' bk-week-cell--out' : ''}`}>
                    {c.d}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// One slot cell — own component so the InteractiveSection hook can run at
// component top-level (not inside a .map). Renders the gloss overlay too.
function CalendarCell({ top, busy }) {
  const { ref, glossRef, handlers } = InteractiveSection(CELL_TILT, false);
  return (
    <div ref={ref}
      className={`bk-cal-cell ${busy ? 'bk-cal-cell--busy' : 'bk-cal-cell--empty'}`}
      style={{ top: `${top}px` }}
      {...handlers}>
      <div ref={glossRef} className="bk-cal-cell-gloss" />
    </div>
  );
}

// Calendar — weekly grid with bookings as positioned blocks. Click an empty
// area to create a booking at that time, click a block to open detail.
// Pass `workingHours` to size the hour gutter dynamically.
// Pass `businessTz` (IANA name) so booking blocks render in business clock,
// not browser clock.
function BookingCalendar({ bookings, onOpenBooking, onCreateAt, onMoveBooking, workingHours = [], businessTz, slotInterval = 30, staff = [] }) {
  const tz = businessTz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [anchor, setAnchor] = useState(() => startOfWeekInTz(tz));
  const [staffFilter, setStaffFilter] = useState('all');  // 'all' | staff_id

  // Apply staff filter — bookings without staff_name are kept in 'all' only.
  const visibleBookings = staffFilter === 'all'
    ? bookings
    : bookings.filter(b => String(b.staff_id) === String(staffFilter));

  // Slot step (minutes) — clamped so a sub-15min interval doesn't produce a
  // 100-row vertical noodle. Anything finer is still allowed for booking math
  // but the calendar ticks are at least 15min apart.
  const SLOT_MIN = Math.max(15, Math.min(60, parseInt(slotInterval, 10) || 30));

  // Hour window (memoised — recompute only when workingHours change)
  const [firstHour, lastHour] = useMemo(
    () => computeHourRange(workingHours), [workingHours]
  );

  // SLOTS array — each entry is the slot's start, in minutes from midnight.
  // length = (working_hours_in_minutes) / SLOT_MIN, e.g. 8h * 60 / 20 = 24 slots.
  const SLOTS = useMemo(() => {
    const startMin = firstHour * 60;
    const endMin   = lastHour * 60;
    const out = [];
    for (let m = startMin; m < endMin; m += SLOT_MIN) out.push(m);
    return out;
  }, [firstHour, lastHour, SLOT_MIN]);

  // Per-slot row heights — expanded when a booking starts in that exact slot
  // (across ALL visible days, so columns stay aligned with the gutter).
  const rowHeights = useMemo(() => {
    // Snap each booking's start to the nearest slot index it occupies.
    const busy = new Set(visibleBookings
      .filter(b => b.starts_at)
      .map(b => {
        const p = partsInTz(new Date(b.starts_at), tz);
        const totalMin = parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
        // Slot index that contains this start (floor toward earlier slot).
        return Math.floor((totalMin - firstHour * 60) / SLOT_MIN);
      }));
    return SLOTS.map((_, idx) => busy.has(idx) ? ROW_BUSY : ROW_MIN);
  }, [visibleBookings, SLOTS, tz, firstHour, SLOT_MIN]);

  // Cumulative offset (px from top of grid) to the start of each slot row.
  const rowOffsets = useMemo(() => {
    const out = [0];
    for (let i = 0; i < rowHeights.length; i++) out.push(out[i] + rowHeights[i]);
    return out; // length = SLOTS.length + 1; last entry = total grid height
  }, [rowHeights]);

  // Vertical offset (px from top of grid) for a given (h, m). Clamps to grid.
  // Computes the slot index, then linearly interpolates within that slot.
  const offsetPx = (h, m) => {
    const totalMin   = h * 60 + m;
    const startMin   = firstHour * 60;
    const idxFloat   = (totalMin - startMin) / SLOT_MIN;
    const idx        = Math.max(0, Math.min(SLOTS.length - 1, Math.floor(idxFloat)));
    const fracInSlot = Math.max(0, Math.min(1, idxFloat - idx));
    return rowOffsets[idx] + fracInSlot * rowHeights[idx];
  };

  // Reverse: y-pixel → minutes-from-midnight. Used by click-to-create + drag-drop.
  const pxToTime = (y) => {
    let acc = 0;
    for (let i = 0; i < rowHeights.length; i++) {
      const next = acc + rowHeights[i];
      if (y < next) {
        const fracInSlot = (y - acc) / rowHeights[i];      // 0..1 within this slot
        return SLOTS[i] + fracInSlot * SLOT_MIN;            // minutes from midnight
      }
      acc = next;
    }
    return lastHour * 60;  // beyond last row → end of day
  };

  const snapToSlot = (totalMinutes) => {
    const startMin = firstHour * 60;
    const idx = Math.floor((totalMinutes - startMin) / SLOT_MIN);
    const clamped = Math.max(0, Math.min(SLOTS.length - 1, idx));
    return SLOTS[clamped];
  };

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      // Use UTC arithmetic so toISODate() returns business-local dates
      const d = new Date(anchor); d.setUTCDate(anchor.getUTCDate() + i); return d;
    });
  }, [anchor]);

  const localised = useMemo(() => visibleBookings.map(b => {
    if (!b.starts_at) return b;
    const start = new Date(b.starts_at);
    const p = partsInTz(start, tz);
    let endTime = '';
    if (b.ends_at) {
      const pe = partsInTz(new Date(b.ends_at), tz);
      endTime = `${pe.hour}:${pe.minute}`;
    }
    return {
      ...b,
      _localDate: `${p.year}-${p.month}-${p.day}`,
      _localTime: `${p.hour}:${p.minute}`,
      _localEndTime: endTime,
      _localHour: parseInt(p.hour, 10),
      _localMin:  parseInt(p.minute, 10),
    };
  }), [visibleBookings, tz]);

  // Group bookings by their LOCAL business date
  const byDay = useMemo(() => {
    const m = {};
    for (const b of localised) {
      if (!b._localDate) continue;
      (m[b._localDate] = m[b._localDate] || []).push(b);
    }
    return m;
  }, [localised]);

  // "Today" computed in business TZ (not browser local)
  const todayISO = useMemo(() => {
    const p = partsInTz(new Date(), tz);
    return `${p.year}-${p.month}-${p.day}`;
  }, [tz]);

  const goPrev  = () => { const d = new Date(anchor); d.setUTCDate(d.getUTCDate() - 7); setAnchor(d); };
  const goNext  = () => { const d = new Date(anchor); d.setUTCDate(d.getUTCDate() + 7); setAnchor(d); };
  const goToday = () => setAnchor(startOfWeekInTz(tz));

  const blockStyle = (b) => {
    const start = new Date(b.starts_at);
    const end   = new Date(b.ends_at || b.starts_at);
    const top   = offsetPx(b._localHour ?? 0, b._localMin ?? 0);
    const dur   = (end - start) / 60000;
    const h     = Math.max(BLOCK_MIN_HEIGHT, (dur / 60) * ROW_BUSY - 2);
    return { top: `${top}px`, height: `${h}px` };
  };

  // Click on a free area → create booking snapped to slot interval
  const handleColClick = (day, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const slot = snapToSlot(pxToTime(y));
    const h = Math.floor(slot / 60), m = slot % 60;
    onCreateAt?.(toISOLocal(day, h, m));
  };

  // ── Drag-and-drop with conflict detection ────────────────────────────
  // Booking blocks are draggable. On drop we:
  // 1) snap to slot_interval boundary
  // 2) check that the target time range is free for the same staff/service
  // 3) cancel the drop with a transient error if it would overlap

  const [draggingId, setDraggingId] = useState(null);
  const [dropError,  setDropError]  = useState('');

  const onBlockDragStart = (e, b) => {
    e.dataTransfer.setData('text/plain', String(b.id));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(b.id);
  };
  const onBlockDragEnd = () => setDraggingId(null);
  const onColDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

  // Returns the moved booking + computed target time, OR an error message.
  // Conflict rule: another booking with the same staff_id (or same service_id
  // when staff is not set) overlapping the target [start, end) range blocks the move.
  const validateDrop = (booking, targetDayISO, targetMinutes) => {
    const dur = (new Date(booking.ends_at) - new Date(booking.starts_at)) / 60000;
    const targetStart = new Date(`${targetDayISO}T${pad(Math.floor(targetMinutes / 60))}:${pad(targetMinutes % 60)}:00`);
    const targetEnd   = new Date(targetStart.getTime() + dur * 60000);

    const conflict = visibleBookings.find(other => {
      if (other.id === booking.id) return false;
      if (other.status === 'cancelled' || other.status === 'no_show') return false;
      // Match by resource: staff if both have one, otherwise service
      if (booking.staff_id && other.staff_id) {
        if (String(other.staff_id) !== String(booking.staff_id)) return false;
      } else if (String(other.service_id) !== String(booking.service_id)) {
        return false;
      }
      const oStart = new Date(other.starts_at);
      const oEnd   = new Date(other.ends_at || other.starts_at);
      // Overlap if not (oEnd <= targetStart) and not (oStart >= targetEnd)
      return !(oEnd <= targetStart || oStart >= targetEnd);
    });
    if (conflict) {
      const conflictTime = (conflict._localTime || conflict.starts_at.slice(11, 16));
      return { error: `Slot conflicts with ${conflict.customer_name || 'another booking'} at ${conflictTime}` };
    }
    return { ok: true };
  };

  const onColDrop = (day, e) => {
    e.preventDefault();
    setDraggingId(null);
    const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!id) return;
    const booking = visibleBookings.find(b => b.id === id);
    if (!booking) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const slot = snapToSlot(pxToTime(y));
    const h = Math.max(0, Math.min(23, Math.floor(slot / 60)));
    const m = Math.max(0, Math.min(59, slot % 60));
    const targetDayISO = toISODate(day);

    const v = validateDrop(booking, targetDayISO, slot);
    if (v.error) {
      setDropError(v.error);
      setTimeout(() => setDropError(''), 3500);
      return;
    }
    onMoveBooking?.(id, toISOLocal(day, h, m));
  };

  // Use UTC formatter — weekDays are pinned to UTC noon to match business-local
  const _fmtRange = (d, opts) =>
    new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(d);
  const headerRange = `${_fmtRange(weekDays[0], { month: 'short', day: 'numeric' })} – ${
    _fmtRange(weekDays[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="bk-cal">
      <div className="bk-cal-toolbar">
        <button className="crm-icon-btn" onClick={goPrev}    type="button" title="Previous week"><CaretLeft size={16} /></button>
        <button className="crm-add-btn"  onClick={goToday}   type="button" style={{ padding: '6px 14px' }}>Today</button>
        <button className="crm-icon-btn" onClick={goNext}    type="button" title="Next week"><CaretRight size={16} /></button>
        <WeekPicker anchorDate={anchor} label={headerRange}
          onPickWeek={(monday) => setAnchor(monday)} />
        {staff.length > 0 && (
          <div className="bk-cal-staff-cb">
            <Users size={14} weight="bold" className="bk-cal-staff-cb-icon" />
            <Combobox value={staffFilter}
              options={[{ value: 'all', label: 'All staff' },
                        ...staff.map(s => ({ value: String(s.id), label: s.name }))]}
              onChange={v => setStaffFilter(v)} />
          </div>
        )}
      </div>

      <div className="bk-cal-grid">
        {/* Slot gutter — one label per slot start (e.g. 08:00, 08:20, 08:40
            for slot_interval=20). Width / labelling driven by SLOTS array. */}
        <div className="bk-cal-gutter">
          <div className="bk-cal-gutter-spacer" />
          {SLOTS.map((min, idx) => {
            const h = Math.floor(min / 60), m = min % 60;
            return (
              <div key={min}
                className={`bk-cal-hour ${rowHeights[idx] === ROW_BUSY ? 'bk-cal-hour--busy' : 'bk-cal-hour--empty'}`}>
                <div className="bk-cal-hour-pill">{pad(h)}:{pad(m)}</div>
              </div>
            );
          })}
        </div>

        {/* 7 day columns */}
        <div className="bk-cal-cols">
          {weekDays.map((day, i) => {
            const dayKey = toISODate(day);
            const isToday = dayKey === todayISO;
            const dayBookings = byDay[dayKey] || [];
            const totalH = rowOffsets[rowOffsets.length - 1];
            return (
              <div key={i} className={`bk-cal-col${isToday ? ' bk-cal-col--today' : ''}`}>
                <div className="bk-cal-col-head">
                  <div className="bk-cal-col-day">{DAY_NAMES[i]}</div>
                  <div className="bk-cal-col-date">{day.getUTCDate()}</div>
                </div>

                <div className="bk-cal-col-body"
                  style={{ height: `${totalH}px` }}
                  onClick={(e) => handleColClick(day, e)}
                  onDragOver={onColDragOver}
                  onDrop={(e) => onColDrop(day, e)}>
                  {/* Each slot cell is its own rounded pill with the same 3D
                      tilt + gloss as org / product cards. `top` is inline
                      (cumulative offset); height lives in CSS. */}
                  {SLOTS.map((_, idx) => (
                    <CalendarCell key={idx}
                      top={rowOffsets[idx] + 3}
                      busy={rowHeights[idx] === ROW_BUSY} />
                  ))}

                  {/* Booking cards — copy of org-card visual: white pill with
                      gloss + status accent stripe + structured info. */}
                  {dayBookings.map(b => {
                    const startStr = b._localTime || b.starts_at.slice(11, 16);
                    const endStr   = b._localEndTime || (b.ends_at ? b.ends_at.slice(11, 16) : '');
                    const statusLbl = STATUS_LABEL[b.status] || b.status;
                    const dragCls   = draggingId === b.id ? ' bk-cal-card--dragging' : '';
                    return (
                      <div key={b.id}
                        className={`bk-cal-card bk-cal-card--${b.status}${dragCls}`}
                        style={blockStyle(b)}
                        draggable={!!onMoveBooking}
                        onDragStart={(e) => onBlockDragStart(e, b)}
                        onDragEnd={onBlockDragEnd}
                        onClick={(e) => { e.stopPropagation(); onOpenBooking(b); }}>
                        <div className="bk-cal-card-stripe" />
                        <div className="bk-cal-card-inner">
                          <div className="bk-cal-card-head">
                            <span className="bk-cal-card-time">
                              {startStr}{endStr && ` – ${endStr}`}
                            </span>
                            <span className={`bk-cal-card-badge bk-cal-card-badge--${b.status}`}>
                              {statusLbl}
                            </span>
                          </div>
                          {b.service_name && (
                            <div className="bk-cal-card-service">{b.service_name}</div>
                          )}
                          {b.customer_name && (
                            <div className="bk-cal-card-line">
                              <User size={12} weight="bold" className="bk-cal-card-icon" />
                              <span>{b.customer_name}</span>
                            </div>
                          )}
                          {b.staff_name && (
                            <div className="bk-cal-card-line">
                              <UserGear size={12} weight="bold" className="bk-cal-card-icon" />
                              <span>{b.staff_name}</span>
                            </div>
                          )}
                          {b.customer_phone && (
                            <div className="bk-cal-card-line">
                              <Phone size={12} weight="bold" className="bk-cal-card-icon" />
                              <span>{b.customer_phone}</span>
                            </div>
                          )}
                          {b.notes && (
                            <div className="bk-cal-card-line bk-cal-card-line--notes">
                              <ChatText size={12} weight="bold" className="bk-cal-card-icon" />
                              <span>{b.notes}</span>
                            </div>
                          )}
                          {b.service_price > 0 && (
                            <div className="bk-cal-card-price">
                              ${Number(b.service_price).toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drop-conflict toast — appears for ~3.5s when a drag-drop is rejected */}
      {dropError && <div className="bk-cal-drop-error">{dropError}</div>}
    </div>
  );
}

export default BookingCalendar;
