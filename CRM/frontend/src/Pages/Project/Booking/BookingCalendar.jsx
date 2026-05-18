import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CaretLeft, CaretRight, CaretDown, User, UserGear, Phone, ChatText, Users } from '@phosphor-icons/react';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import { formatMoney } from '../../../Utils/currency.js';
import { Combobox } from './BookingCreateModal.jsx';

// Tilt config for empty/busy slot cells — matches the same gentle 3D tilt
// you see on org cards (Dashboard / Organization / Products grid).
const CELL_TILT = {
  maxAngle: 14, lerp: 0.05, lerpOut: 0.07,
  scale: 1.04, perspective: 600,
  gloss: { opacity: 0.14, spread: 50 },
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Fixed slot-row height (Google Calendar style). Each slot row is the same
// height; a booking's pixel-height is derived from its duration so a 60-min
// booking visually spans two 30-min slots, a 90-min one spans three, etc.
// 48px = 42px cell + 6px gap (matches the old pre-rework empty-slot height).
const SLOT_HEIGHT = 48;
// Floor — very short bookings still need to be readable.
const BLOCK_MIN_HEIGHT = 36;
// Horizontal column gutter between overlapping bookings in the same cluster.
const COL_GAP = 4;
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

// Status order for the dropdown menu (controls visual flow: progressing
// upward statuses first, then negative outcomes at the bottom).
const STATUS_MENU_ORDER = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

// Portal-positioned status picker for the calendar card badge. Visual is the
// same as the Header org/project switchers: a sliding `hdr-sw-indicator` pill
// that follows the hovered item (DynamicBlock pattern). Anchors its bottom
// edge above the badge when there isn't room below, so it never floats off-
// screen. Closes on outside-click / Escape.
function StatusMenu({ anchorEl, current, onPick, onClose }) {
  const [pos, setPos]   = useState(null);
  const [hovId, setHov] = useState(null);
  const itemsEl = useRef(null);
  const itemEls = useRef({});
  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });
  const curKey = hovId ?? current;

  useEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    // 5 status items × ~36px ≈ 180px; container has its own 8px padding +
    // borders. Use that as our flip-up threshold.
    const MENU_H = 220;
    const margin = 8;
    const width  = 180;
    const flipUp = window.innerHeight - r.bottom < MENU_H + margin;
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, r.left));
    if (flipUp) {
      setPos({ bottom: window.innerHeight - r.top + 6, left, width });
    } else {
      setPos({ top: r.bottom + 6, left, width });
    }
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    const onPd  = e => {
      if (!e.target.closest?.('.bk-status-menu') && !anchorEl.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [anchorEl, onClose]);

  // DynamicBlock pill: measure the active/hovered item and slide the
  // indicator to it. Re-runs on hover change + on mount.
  useEffect(() => {
    if (!pos) return;
    const raf = requestAnimationFrame(() => {
      const el = curKey != null ? itemEls.current[curKey] : null;
      if (!el) { setInd(p => ({ ...p, opacity: 0 })); return; }
      setInd({ opacity: 1, y: el.offsetTop, h: el.offsetHeight });
    });
    return () => cancelAnimationFrame(raf);
  }, [curKey, pos]);

  if (!pos) return null;
  return createPortal(
    <div className="bk-status-menu hdr-switcher-list"
      style={{
        ...(pos.top    != null ? { top:    pos.top    } : null),
        ...(pos.bottom != null ? { bottom: pos.bottom } : null),
        left: pos.left, width: pos.width,
      }}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onMouseLeave={() => setHov(null)}>
      <div className="hdr-sw-items" ref={itemsEl}>
        <div className="hdr-sw-indicator"
          style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }} />
        {STATUS_MENU_ORDER.map(s => (
          <button key={s} type="button"
            ref={el => { if (el) itemEls.current[s] = el; else delete itemEls.current[s]; }}
            className={`hdr-switcher-item${curKey === s ? ' hdr-sw-item--current' : ''}`}
            onMouseEnter={() => setHov(s)}
            onClick={() => { onPick(s); onClose(); }}>
            {STATUS_LABEL[s] || s}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

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
// `past` greys the cell (50% opacity) and freezes the tilt so the user can't
// click it to schedule a booking in the past.
function CalendarCell({ top, busy, height, past }) {
  const { ref, glossRef, handlers } = InteractiveSection(CELL_TILT, past);
  const cls = `bk-cal-cell ${busy ? 'bk-cal-cell--busy' : 'bk-cal-cell--empty'}${past ? ' bk-cal-cell--past' : ''}`;
  return (
    <div ref={ref}
      className={cls}
      style={{ top: `${top}px`, height: height != null ? `${height}px` : undefined }}
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
function BookingCalendar({ bookings, onOpenBooking, onCreateAt, onMoveBooking, onStatusChange, workingHours = [], businessTz, slotInterval = 30, staff = [], services = [], currency = 'USD' }) {
  const tz = businessTz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [anchor, setAnchor] = useState(() => startOfWeekInTz(tz));
  const [staffFilter, setStaffFilter] = useState('all');  // 'all' | staff_id
  // `statusMenuFor` = { bookingId, anchorEl } | null. When set, the portal
  // status-picker renders next to the booking's badge. Click on the badge
  // toggles this; the menu closes itself on outside click / Escape.
  const [statusMenuFor, setStatusMenuFor] = useState(null);
  // Stable close handler so StatusMenu's useEffect doesn't see a new onClose
  // every render (which would re-attach the document pointer listener every
  // BookingCalendar render and could race with the very click that opened
  // the menu, dismissing it before paint).
  const closeStatusMenu = useCallback(() => setStatusMenuFor(null), []);

  // Apply staff filter — bookings without staff_name are kept in 'all' only.
  const visibleBookings = staffFilter === 'all'
    ? bookings
    : bookings.filter(b => String(b.staff_id) === String(staffFilter));

  // Card refs are used both for legacy DOM access (drag preview etc) AND to
  // measure each card's natural content height — the inner element has
  // `min-height: 0` and the children stack freely, so `scrollHeight` reports
  // the content height even when the card itself is force-sized via inline
  // height. Heights feed back into `rowHeights` so single-slot cards with
  // a lot of content can push their slot row taller (and any cards
  // spanning that slot grow proportionally).
  const cardRefs       = useRef({});
  const cardInnerRefs  = useRef({});
  const [cardH, setCardH] = useState({});
  useLayoutEffect(() => {
    const next = { ...cardH };
    let changed = false;
    for (const id of Object.keys(cardInnerRefs.current)) {
      const el = cardInnerRefs.current[id];
      if (!el) continue;
      // Skip cards currently hovered — hover expands the details panel and
      // measuring at that moment would feed inflated heights back into the
      // layout, causing the grid to "pump" as the user mouses around.
      const card = el.closest?.('.bk-cal-card');
      if (card && card.matches?.(':hover')) continue;
      const h = el.scrollHeight;
      if (next[id] !== h) { next[id] = h; changed = true; }
    }
    // Detect removed entries — drop them.
    for (const id of Object.keys(cardH)) {
      if (!cardInnerRefs.current[id]) {
        delete next[id];
        changed = true;
      }
    }
    if (changed) setCardH(next);
  });

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

  // Set of the 7 dayKeys (`YYYY-MM-DD`) for the currently anchored week.
  // Used to restrict rowHeights to bookings inside the visible week — without
  // this filter, a busy slot on Week A (e.g. two bookings at 13:30) would
  // permanently inflate the 13:30 row on every other week the user navigates
  // to, because `rowHeights` was computing MAX across all dates present in
  // the bookings prop.
  const currentWeekDayKeys = useMemo(() => {
    const set = new Set();
    for (let i = 0; i < 7; i++) {
      const d = new Date(anchor);
      d.setUTCDate(anchor.getUTCDate() + i);
      set.add(toISODate(d));
    }
    return set;
  }, [anchor]);

  // Per-slot row heights. Default = SLOT_HEIGHT (= 48px) but a slot can grow:
  //   • when a SINGLE-slot card starting there has more content than fits
  //     in the default height (30-min booking with full details = ~120px);
  //   • when bookings stack in the same start-time bucket (same service,
  //     same time) — each sibling needs ≥ MIN_STACK_H to remain readable,
  //     so the slot grows to fit `N * MIN_STACK_H + (N-1) * inner_gap`.
  //
  // Multi-slot cards (slotsTall > 1) don't contribute to row growth —
  // they already span multiple slots' worth of pixels.
  // Each stacked sub-card needs enough vertical room for the service name + a
  // breathable line for the time slot underneath. 56px = 6px top padding +
  // 14px name line + 6px gap + 14px time line + 6px bottom padding + 10px
  // extra breathing room so the content doesn't kiss the edges.
  const MIN_STACK_H = 56;
  const STACK_GAP_INNER = 4;    // visible gap between stacked sub-cards
  const rowHeights = useMemo(() => {
    // First pass — bucket single-slot bookings per
    // (day, slot, service_key, start_time) so we can count stack siblings.
    // Stack annotations from `byDay` aren't available here because byDay is
    // declared below, so we compute the bucket counts inline.
    const stackCount = new Map();   // bucketKey → count
    const bookingStartSlot = new Map();   // bookingId → startSlot (cached)
    const bookingBucketKey = new Map();   // bookingId → bucketKey
    for (const b of visibleBookings) {
      if (!b.starts_at) continue;
      const p = partsInTz(new Date(b.starts_at), tz);
      const dayKey = `${p.year}-${p.month}-${p.day}`;
      if (!currentWeekDayKeys.has(dayKey)) continue;
      const startMin  = parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
      const startSlot = Math.floor((startMin - firstHour * 60) / SLOT_MIN);
      if (startSlot < 0 || startSlot >= SLOTS.length) continue;
      const durMin = b.ends_at
        ? Math.max(1, (new Date(b.ends_at) - new Date(b.starts_at)) / 60000)
        : SLOT_MIN;
      const slotsTall = Math.max(1, Math.ceil(durMin / SLOT_MIN));
      if (slotsTall !== 1) continue;
      const sKey = b.service_id != null
        ? `s:${b.service_id}`
        : `f:${(b.freeform_service_name || '').toLowerCase()}`;
      const bucketKey = `${dayKey}|${startSlot}|${sKey}|${p.hour}:${p.minute}`;
      stackCount.set(bucketKey, (stackCount.get(bucketKey) || 0) + 1);
      bookingStartSlot.set(b.id, startSlot);
      bookingBucketKey.set(b.id, bucketKey);
    }
    // Second pass — for each booking we know its start slot + stack count.
    // Row height = max over all contributing bookings (content or stack-min).
    const maxBySlot = {};
    for (const b of visibleBookings) {
      const startSlot = bookingStartSlot.get(b.id);
      if (startSlot == null) continue;
      const contentH = (cardH[b.id] || 0) + 6;
      const sTotal   = stackCount.get(bookingBucketKey.get(b.id)) || 1;
      const stackMinH = sTotal > 1
        ? sTotal * MIN_STACK_H + (sTotal - 1) * STACK_GAP_INNER + 6
        : 0;
      const h = Math.max(contentH, stackMinH);
      if (h > (maxBySlot[startSlot] || 0)) maxBySlot[startSlot] = h;
    }
    return SLOTS.map((_, idx) =>
      Math.max(SLOT_HEIGHT, maxBySlot[idx] || 0)
    );
  }, [SLOTS, visibleBookings, currentWeekDayKeys, firstHour, SLOT_MIN, cardH, tz]);

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

  // Per-day_of_week open/close minutes-from-midnight pulled from project
  // settings (Mon=0..Sun=6 to match HoursEditor). When a day has an entry
  // here it's "enabled"; the entry's range is then used to grey individual
  // slots that fall outside the day's hours (see isOffHoursSlot below).
  // Empty config falls back to "all days enabled" with no per-day range so
  // freshly-installed projects don't see an empty calendar.
  const workingHoursByDow = useMemo(() => {
    const out = new Map();
    if (Array.isArray(workingHours)) {
      for (const w of workingHours) {
        const dow = Number(w.day_of_week);
        const [oh, om] = (w.open_time  || '08:00').split(':').map(Number);
        const [ch, cm] = (w.close_time || '21:00').split(':').map(Number);
        out.set(dow, {
          openMin:  (oh || 0) * 60 + (om || 0),
          closeMin: (ch || 0) * 60 + (cm || 0),
        });
      }
    }
    return out;
  }, [workingHours]);

  // All 7 days are rendered; `enabled` marks whether the day is a working day
  // per `workingHours`. Disabled days stay in the grid so the user keeps a
  // visual rhythm of the week (otherwise you can't tell at a glance whether
  // "Friday" is in column 5 or 4 because Sat/Sun were silently dropped).
  // Click + drag-drop are blocked on disabled days the same way past slots
  // are blocked — see handleColClick / onColDrop.
  const weekDays = useMemo(() => {
    const allEnabled = workingHoursByDow.size === 0;
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(anchor); d.setUTCDate(anchor.getUTCDate() + i);
      return { date: d, dow: i, enabled: allEnabled || workingHoursByDow.has(i) };
    });
  }, [anchor, workingHoursByDow]);

  // Is this slot outside the day's open hours? Returns false for fully
  // disabled days (caller already handles those at column level) and false
  // when no per-day config exists (legacy fallback). Slot is off-hours when
  // it STARTS before open OR at/after close — so the slot ending at close
  // still counts as active.
  const isOffHoursSlot = (dow, slotMin) => {
    const range = workingHoursByDow.get(dow);
    if (!range) return false;
    return slotMin < range.openMin || slotMin >= range.closeMin;
  };

  // "Now" projected into business TZ, broken into the same parts we compare
  // against — used by isPastSlot(). Recomputed every render so the past-slot
  // greying naturally extends through the day; with this small a useMemo
  // dependency set it's cheap.
  const nowInTz = useMemo(() => {
    const p = partsInTz(new Date(), tz);
    return {
      iso:    `${p.year}-${p.month}-${p.day}`,
      minutes: parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10),
    };
  }, [tz]);

  // A slot is past when its END time (slot_start + SLOT_MIN) is <= "now" in
  // business TZ. The currently-active slot stays bookable — the merchant might
  // still want to record a walk-in for the current quarter-hour. Everything
  // strictly before today, plus today's slots that have fully elapsed, is grey.
  const isPastSlot = (date, slotMinutes) => {
    const iso = toISODate(date);
    if (iso < nowInTz.iso) return true;
    if (iso > nowInTz.iso) return false;
    return (slotMinutes + SLOT_MIN) <= nowInTz.minutes;
  };

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

  // Group bookings by LOCAL business date, then by overlap cluster, then by
  // service inside each cluster:
  //
  //   1. For each day, sort bookings by starts_at + id (stable).
  //   2. Build CLUSTERS — a cluster = maximal set of bookings whose time
  //      ranges form one connected overlap component. Non-overlapping
  //      bookings end up in different clusters (each renders full-width).
  //   3. Inside a cluster, GROUP BY SERVICE (service_id, falling back to a
  //      freeform-name key when service_id is NULL). Each service group
  //      becomes a single HORIZONTAL column inside the cluster — so 3
  //      simultaneous yoga classes don't blow up into 3 narrow columns;
  //      they stack vertically inside one "Yoga" column.
  //   4. Inside a service group, multiple bookings sharing the exact same
  //      start time split the column VERTICALLY (equal sub-heights). Bookings
  //      at different start times keep their natural top/height — they just
  //      happen to share the column visually.
  //
  // Each booking gets:
  //   _colIndex     — service-group column index inside the cluster
  //   _clusterSize  — total service groups in this cluster
  //   _stackIndex   — sub-stack index within (column × start_time)
  //   _stackTotal   — total bookings in that (column × start_time) bucket
  const byDay = useMemo(() => {
    const serviceKey = (b) => b.service_id != null
      ? `s:${b.service_id}`
      : `f:${(b.freeform_service_name || '').toLowerCase()}`;

    const m = {};
    for (const b of localised) {
      if (!b._localDate) continue;
      (m[b._localDate] = m[b._localDate] || []).push(b);
    }
    for (const dayKey of Object.keys(m)) {
      const dayList = m[dayKey].slice().sort((a, b) => {
        const ts = new Date(a.starts_at) - new Date(b.starts_at);
        return ts !== 0 ? ts : (a.id - b.id);
      });
      // 1. Build overlap clusters (transitive component by time range).
      const clusters = [];
      let currentEnd = -Infinity;
      let cur = null;
      for (const b of dayList) {
        const start = new Date(b.starts_at).getTime();
        const end   = new Date(b.ends_at || b.starts_at).getTime();
        if (cur && start < currentEnd) {
          cur.bookings.push(b);
          currentEnd = Math.max(currentEnd, end);
        } else {
          cur = { bookings: [b] };
          clusters.push(cur);
          currentEnd = end;
        }
      }
      // 2. Inside each cluster: group-by-service → column + sub-stack.
      for (const cluster of clusters) {
        const groups = new Map();
        for (const b of cluster.bookings) {
          const k = serviceKey(b);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(b);
        }
        const groupKeys = [...groups.keys()];
        const clusterSize = groupKeys.length;
        groupKeys.forEach((k, colIdx) => {
          const groupBookings = groups.get(k);
          // Sub-stack: bookings with the same start time inside this service
          // group share a vertical band. Different start times → independent.
          const byStart = new Map();
          for (const b of groupBookings) {
            const t = b._localTime || '';
            if (!byStart.has(t)) byStart.set(t, []);
            byStart.get(t).push(b);
          }
          for (const arr of byStart.values()) {
            arr.forEach((b, sIdx) => {
              b._colIndex    = colIdx;
              b._clusterSize = clusterSize;
              b._stackIndex  = sIdx;
              b._stackTotal  = arr.length;
            });
          }
        });
      }
      m[dayKey] = dayList;
    }
    return m;
  }, [localised]);

  // "Today" computed in business TZ (not browser local)
  const todayISO = useMemo(() => {
    const p = partsInTz(new Date(), tz);
    return `${p.year}-${p.month}-${p.day}`;
  }, [tz]);

  // Slide-transition state. Tracks the direction the new week is sliding in
  // from so we can swap CSS keyframes on the remounted column grid. Cleared
  // automatically when the animation finishes (onAnimationEnd) so subsequent
  // mounts don't accidentally re-trigger an animation.
  const [slideDir, setSlideDir] = useState(null);  // 'from-left' | 'from-right' | null
  const _switchToAnchor = (newAnchor) => {
    if (newAnchor.getTime() === anchor.getTime()) return;
    setSlideDir(newAnchor.getTime() < anchor.getTime() ? 'from-left' : 'from-right');
    setAnchor(newAnchor);
  };
  const goPrev  = () => { const d = new Date(anchor); d.setUTCDate(d.getUTCDate() - 7); _switchToAnchor(d); };
  const goNext  = () => { const d = new Date(anchor); d.setUTCDate(d.getUTCDate() + 7); _switchToAnchor(d); };
  const goToday = () => _switchToAnchor(startOfWeekInTz(tz));

  // ── Drag-to-edge auto week switch ──────────────────────────────────
  // While a booking card is being dragged near the left/right edge of the
  // grid we auto-advance to the prev/next week after a short hold. This
  // lets the user move a booking to "next Monday" without dropping +
  // re-dragging. Native HTML5 DnD keeps the dataTransfer alive across the
  // remount, so the same booking can be dropped into the new week.
  const edgeTimerRef = useRef(null);
  const clearEdgeTimer = () => {
    if (edgeTimerRef.current) {
      clearTimeout(edgeTimerRef.current);
      edgeTimerRef.current = null;
    }
  };
  const onEdgeDragOver = (dir) => (e) => {
    e.preventDefault();
    if (edgeTimerRef.current) return;   // already counting down
    edgeTimerRef.current = setTimeout(() => {
      edgeTimerRef.current = null;
      dir === 'prev' ? goPrev() : goNext();
    }, 400);
  };
  const onEdgeDragLeave = () => clearEdgeTimer();
  // Drop on the edge zone = treat as drop on the column body it was over
  // before the swap. We don't actually receive useful info here (the user
  // is releasing on the edge, not a slot), so consume the event to avoid
  // it bubbling to the column body of a stale week.
  const onEdgeDrop = (e) => { e.preventDefault(); clearEdgeTimer(); };

  const blockStyle = (b) => {
    // Top + height come from the booking's actual time window. Width + left
    // come from its service column inside the overlap cluster. Top + height
    // are further subdivided when multiple same-service bookings share an
    // exact start time (vertical stack inside the column band).
    const slotTop = offsetPx(b._localHour ?? 0, b._localMin ?? 0);
    const durationMin = b.ends_at
      ? Math.max(1, (new Date(b.ends_at) - new Date(b.starts_at)) / 60000)
      : SLOT_MIN;
    const startMin = (b._localHour ?? 0) * 60 + (b._localMin ?? 0);
    const startSlot = Math.max(0, Math.floor((startMin - firstHour * 60) / SLOT_MIN));
    const slotsTall = Math.max(1, Math.ceil(durationMin / SLOT_MIN));
    const endSlot   = Math.min(SLOTS.length, startSlot + slotsTall);
    let allocatedPx = 0;
    for (let i = startSlot; i < endSlot; i++) allocatedPx += rowHeights[i];
    const fullHeightPx = allocatedPx - 6;

    // Horizontal (cluster columns by service).
    const colIdx    = b._colIndex   || 0;
    const clusterN  = b._clusterSize || 1;
    const widthPct  = 100 / clusterN;
    const leftPct   = colIdx * widthPct;

    // Vertical sub-stack (same service + same start time).
    const sIdx   = b._stackIndex || 0;
    const sTotal = Math.max(1, b._stackTotal || 1);
    const innerGap = sTotal > 1 ? STACK_GAP_INNER : 0;
    const subHeightPx = sTotal > 1
      ? (fullHeightPx - innerGap * (sTotal - 1)) / sTotal
      : fullHeightPx;
    const subTopOffset = sIdx * (subHeightPx + innerGap);

    return {
      top:          `${slotTop + 3 + subTopOffset}px`,
      height:       `${subHeightPx}px`,
      left:         `calc(${leftPct}% + 2px)`,
      width:        `calc(${widthPct}% - ${COL_GAP}px)`,
      borderRadius: '10px',
    };
  };

  // Click on a free area → create booking snapped to slot interval.
  // Refuses to fire when:
  //   • the day itself is closed (enabled === false),
  //   • the slot is in the past,
  //   • the slot is before that day's open time or at/after its close time.
  // Each of these has matching visual greying so the rejection isn't surprising.
  const handleColClick = (dayObj, e) => {
    if (!dayObj.enabled) return;
    const day = dayObj.date;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const slot = snapToSlot(pxToTime(y));
    if (isPastSlot(day, slot)) return;
    if (isOffHoursSlot(dayObj.dow, slot)) return;
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
  //
  // Conflict rules (in order):
  //   1) **Staff double-booking** — a staff member can only serve one
  //      booking at a time. If the dragged booking has staff_id X and
  //      any overlapping booking ALSO has staff_id X → BLOCK.
  //   2) **Service capacity** — a service has `capacity` (group classes /
  //      shared resources may set it > 1 to allow multiple concurrent
  //      customers). Count overlapping bookings of the same service; if
  //      that count is already >= capacity → BLOCK. Capacity is also the
  //      only constraint for services that don't require staff.
  //
  // Before this fix, the check just rejected ANY overlap with the same
  // service_id — which ignored capacity entirely and made `Capacity per
  // slot = 3` impossible to actually use.
  const validateDrop = (booking, targetDayISO, targetMinutes) => {
    const dur = (new Date(booking.ends_at) - new Date(booking.starts_at)) / 60000;
    const targetStart = new Date(`${targetDayISO}T${pad(Math.floor(targetMinutes / 60))}:${pad(targetMinutes % 60)}:00`);
    const targetEnd   = new Date(targetStart.getTime() + dur * 60000);

    // Collect every other live booking that overlaps the target range.
    // Cancelled / no_show don't occupy the slot.
    const overlapping = visibleBookings.filter(other => {
      if (other.id === booking.id) return false;
      if (other.status === 'cancelled' || other.status === 'no_show') return false;
      const oStart = new Date(other.starts_at);
      const oEnd   = new Date(other.ends_at || other.starts_at);
      // Overlap iff intervals are not disjoint.
      return !(oEnd <= targetStart || oStart >= targetEnd);
    });

    // Rule 1: same staff in the overlap window → hard conflict.
    if (booking.staff_id) {
      const staffClash = overlapping.find(o =>
        o.staff_id && String(o.staff_id) === String(booking.staff_id)
      );
      if (staffClash) {
        const staffName = (staff.find(s => String(s.id) === String(booking.staff_id)) || {}).name
                       || staffClash.staff_name
                       || 'This staff member';
        const t = (staffClash._localTime || staffClash.starts_at.slice(11, 16));
        return { error: `${staffName} is already booked at ${t}` };
      }
    }

    // Rule 2: service capacity. Lookup `capacity` from the service
    // catalog — defaults to 1 when service is unknown / freeform, so
    // freeform bookings behave like the old "no overlap" rule. For
    // services with capacity > 1 (group classes etc.), up to N concurrent
    // bookings of the same service share the slot.
    const svc = services.find(s => String(s.id) === String(booking.service_id));
    const capacity = Math.max(1, parseInt(svc?.capacity, 10) || 1);
    const sameServiceConcurrent = overlapping.filter(o =>
      String(o.service_id) === String(booking.service_id)
    ).length;
    if (sameServiceConcurrent >= capacity) {
      return {
        error: capacity > 1
          ? `${svc?.name || 'This service'} is at capacity (${capacity}) at this slot`
          : `Slot conflicts with another ${svc?.name || 'booking'} here`,
      };
    }

    return { ok: true };
  };

  const onColDrop = (dayObj, e) => {
    e.preventDefault();
    setDraggingId(null);
    const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!id) return;
    const booking = visibleBookings.find(b => b.id === id);
    if (!booking) return;

    if (!dayObj.enabled) {
      setDropError('That day is closed in your working hours');
      setTimeout(() => setDropError(''), 3500);
      return;
    }
    const day = dayObj.date;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const slot = snapToSlot(pxToTime(y));
    const h = Math.max(0, Math.min(23, Math.floor(slot / 60)));
    const m = Math.max(0, Math.min(59, slot % 60));
    const targetDayISO = toISODate(day);

    // Same past-slot guard as click-to-create — dragging a booking onto a
    // past cell would otherwise let the user "reschedule" into the past,
    // which doesn't make sense and contradicts the visual greying.
    if (isPastSlot(day, slot)) {
      setDropError('Cannot move a booking to a past time');
      setTimeout(() => setDropError(''), 3500);
      return;
    }
    if (isOffHoursSlot(dayObj.dow, slot)) {
      setDropError('That slot is outside the day’s working hours');
      setTimeout(() => setDropError(''), 3500);
      return;
    }

    const v = validateDrop(booking, targetDayISO, slot);
    if (v.error) {
      setDropError(v.error);
      setTimeout(() => setDropError(''), 3500);
      return;
    }
    onMoveBooking?.(id, toISOLocal(day, h, m));
  };

  // Use UTC formatter — weekDays are pinned to UTC noon to match business-local.
  // Build the header from the *full* Monday–Sunday range, not from `weekDays`,
  // because `weekDays` is now filtered (excluded non-working days), and using
  // its first/last entries would either crash (when weekDays[6] is undefined)
  // or show a misleading shorter range like "Mon Mar 4 – Fri Mar 8".
  const _fmtRange = (d, opts) =>
    new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(d);
  const _weekFirstDate = anchor;
  const _weekLastDate  = (() => {
    const d = new Date(anchor); d.setUTCDate(anchor.getUTCDate() + 6); return d;
  })();
  const headerRange = `${_fmtRange(_weekFirstDate, { month: 'short', day: 'numeric' })} – ${
    _fmtRange(_weekLastDate, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="bk-cal">
      <div className="bk-cal-toolbar">
        <button className="crm-icon-btn" onClick={goPrev}    type="button" title="Previous week"><CaretLeft size={16} /></button>
        <button className="crm-add-btn"  onClick={goToday}   type="button" style={{ padding: '6px 14px' }}>Today</button>
        <button className="crm-icon-btn" onClick={goNext}    type="button" title="Next week"><CaretRight size={16} /></button>
        <WeekPicker anchorDate={anchor} label={headerRange}
          onPickWeek={(monday) => _switchToAnchor(monday)} />
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
            // All gutter labels are the same height now (= SLOT_HEIGHT) since
            // the grid no longer varies per slot. Keeping the --empty class
            // for background / font-weight styling consistency.
            return (
              <div key={min}
                className="bk-cal-hour bk-cal-hour--empty"
                style={{ height: `${rowHeights[idx]}px` }}>
                <div className="bk-cal-hour-pill">{pad(h)}:{pad(m)}</div>
              </div>
            );
          })}
        </div>

        {/* Static 7-column grid — non-working days are greyed in place rather
            than removed, so the Mon→Sun rhythm stays obvious. The remountable
            wrapper carries a `key` derived from the anchor's ISO date so each
            week change forces a remount + a one-shot CSS slide-in animation
            keyed by `slideDir`. Inside the wrapper, two invisible edge zones
            (left/right) handle drag-to-edge auto-advance during DnD. */}
        <div className="bk-cal-cols-wrap">
          <div
            key={toISODate(anchor)}
            className={`bk-cal-cols${slideDir ? ` bk-cal-cols--${slideDir}` : ''}`}
            onAnimationEnd={() => setSlideDir(null)}>
          {weekDays.map((dayObj) => {
            const { date: day, dow, enabled } = dayObj;
            const dayKey = toISODate(day);
            const isToday = dayKey === todayISO;
            const dayBookings = byDay[dayKey] || [];
            const totalH = rowOffsets[rowOffsets.length - 1];
            const colCls = `bk-cal-col${isToday ? ' bk-cal-col--today' : ''}${enabled ? '' : ' bk-cal-col--disabled'}`;
            return (
              <div key={dayKey} className={colCls}>
                <div className="bk-cal-col-head">
                  <div className="bk-cal-col-day">{DAY_NAMES[dow]}</div>
                  <div className="bk-cal-col-date">{day.getUTCDate()}</div>
                </div>

                <div className="bk-cal-col-body"
                  style={{ height: `${totalH}px` }}
                  onClick={(e) => handleColClick(dayObj, e)}
                  onDragOver={onColDragOver}
                  onDrop={(e) => onColDrop(dayObj, e)}>
                  {/* Each slot cell is its own rounded pill with the same 3D
                      tilt + gloss as org / product cards. `top` is inline
                      (cumulative offset); height lives in CSS. `past` greys
                      the cell + disables its click. We mark a cell as past
                      when it's either in the past time-wise OR before/after
                      that day's open hours. For fully-disabled days the
                      column itself is faded (.bk-cal-col--disabled), so we
                      DON'T add the per-cell past class — otherwise the two
                      opacities compound and the day looks nearly invisible. */}
                  {SLOTS.map((slotMin, idx) => (
                    <CalendarCell key={idx}
                      top={rowOffsets[idx] + 3}
                      busy={false}
                      past={enabled && (isPastSlot(day, slotMin) || isOffHoursSlot(dow, slotMin))}
                      // Cell pill follows the actual slot row height — if a
                      // sibling card in this row grew the slot (variable-height
                      // mode), every empty cell in the same row grows too so
                      // the visual row stays uniform across all 7 columns.
                      // 6px gap = 3px above + 3px below.
                      height={rowHeights[idx] - 6} />
                  ))}

                  {/* Booking cards — copy of org-card visual: white pill with
                      gloss + status accent stripe + structured info. */}
                  {dayBookings.map(b => {
                    const startStr = b._localTime || b.starts_at.slice(11, 16);
                    const endStr   = b._localEndTime || (b.ends_at ? b.ends_at.slice(11, 16) : '');
                    const statusLbl = STATUS_LABEL[b.status] || b.status;
                    const dragCls   = draggingId === b.id ? ' bk-cal-card--dragging' : '';
                    // Solo = no concurrent bookings *and* no stacked siblings.
                    // Solo cards get the full-width column to themselves, so they
                    // skip the compact summary and render full details by default.
                    const soloCls   = ((b._clusterSize || 1) === 1 && (b._stackTotal || 1) === 1)
                      ? ' bk-cal-card--solo' : '';
                    return (
                      <div key={b.id}
                        ref={(el) => {
                          if (el) cardRefs.current[b.id] = el;
                          else    delete cardRefs.current[b.id];
                        }}
                        className={`bk-cal-card bk-cal-card--${b.status}${dragCls}${soloCls}`}
                        style={blockStyle(b)}
                        draggable={!!onMoveBooking}
                        onDragStart={(e) => onBlockDragStart(e, b)}
                        onDragEnd={onBlockDragEnd}
                        onClick={(e) => { e.stopPropagation(); onOpenBooking(b); }}>
                        <div className="bk-cal-card-stripe" />
                        <div className="bk-cal-card-inner"
                          ref={(el) => {
                            if (el) cardInnerRefs.current[b.id] = el;
                            else    delete cardInnerRefs.current[b.id];
                          }}>
                          {/* COMPACT — always visible. Single row with the service
                              name + status pill. Designed for the smallest case
                              (15-min slot, half-width column from a 2-cluster). */}
                          <div className="bk-cal-card-compact">
                            <span className="bk-cal-card-compact-name">
                              {b.service_name || '—'}
                            </span>
                            <span className="bk-cal-card-compact-time">
                              {startStr}{endStr && ` · ${endStr}`}
                            </span>
                          </div>
                          {/* DETAILS — slides in on hover (CSS-only). Hidden by
                              max-height: 0 + opacity: 0 in default state. */}
                          <div className="bk-cal-card-details">
                            <div className="bk-cal-card-head">
                              <span className="bk-cal-card-time">
                                {startStr}{endStr && ` – ${endStr}`}
                              </span>
                              <button type="button"
                                className={`bk-cal-card-badge bk-cal-card-badge--${b.status} bk-cal-card-badge--btn`}
                                draggable={false}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const btn = e.currentTarget;
                                  setStatusMenuFor(prev =>
                                    prev?.bookingId === b.id
                                      ? null
                                      : { bookingId: b.id, anchorEl: btn }
                                  );
                                }}>
                                {statusLbl}
                              </button>
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
                                {formatMoney(b.service_price, currency)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </div>

          {/* Edge auto-advance zones — invisible 28px strips on both sides of
              the columns. They're only "armed" while a booking card is being
              dragged: outside of drag they have pointer-events:none + no
              visual treatment so a normal mouse hover near the calendar edge
              doesn't trigger the gradient highlight. Inside drag, hovering
              one of them for 400ms swaps the visible week (goPrev/goNext).
              The columns re-key + animate while the native drag session
              stays alive, so the user can drop straight onto the new week. */}
          <div className={`bk-cal-edge bk-cal-edge--prev${draggingId != null ? ' bk-cal-edge--armed' : ''}`}
            onDragEnter={onEdgeDragOver('prev')}
            onDragOver={onEdgeDragOver('prev')}
            onDragLeave={onEdgeDragLeave}
            onDrop={onEdgeDrop} />
          <div className={`bk-cal-edge bk-cal-edge--next${draggingId != null ? ' bk-cal-edge--armed' : ''}`}
            onDragEnter={onEdgeDragOver('next')}
            onDragOver={onEdgeDragOver('next')}
            onDragLeave={onEdgeDragLeave}
            onDrop={onEdgeDrop} />
        </div>
      </div>

      {/* Drop-conflict toast — appears for ~3.5s when a drag-drop is rejected */}
      {dropError && <div className="bk-cal-drop-error">{dropError}</div>}

      {/* Status picker — rendered once at the calendar root and positioned
          against the clicked badge via portal. Looking up the current status
          from `bookings` rather than caching on open so it stays correct after
          a PATCH-driven re-render. */}
      {statusMenuFor && (() => {
        const b = visibleBookings.find(x => x.id === statusMenuFor.bookingId);
        if (!b) return null;
        return (
          <StatusMenu anchorEl={statusMenuFor.anchorEl}
            current={b.status}
            onPick={(s) => onStatusChange?.(b.id, s)}
            onClose={closeStatusMenu} />
        );
      })()}
    </div>
  );
}

export default BookingCalendar;
