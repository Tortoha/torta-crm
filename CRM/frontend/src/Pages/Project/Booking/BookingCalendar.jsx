import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_HEIGHT = 56;            // px per hour row
const DEFAULT_FIRST_HOUR = 8;
const DEFAULT_LAST_HOUR  = 22;     // exclusive — i.e. 8..21 visible

// ── Timezone helpers ────────────────────────────────────────────────────
// All bookings come from the API as ISO with UTC offset (TIMESTAMPTZ in
// PostgreSQL). For the calendar grid we need to render their wall-clock
// time in the BUSINESS timezone, NOT the browser's local timezone.
// (An owner viewing her Almaty salon from a Frankfurt airport should still
// see appointments at "10:00", not "07:00".)

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

// Status → color (uses --accent / Order palette)
const STATUS_COLOR = {
  pending:   { bg: 'rgba(0,113,227,0.10)', border: 'rgba(0,113,227,0.55)' },
  confirmed: { bg: 'rgba(0,113,227,0.18)', border: 'rgba(0,113,227,0.85)' },
  completed: { bg: 'rgba(99,99,99,0.12)',  border: 'rgba(99,99,99,0.55)'  },
  cancelled: { bg: 'rgba(220,53,69,0.10)', border: 'rgba(220,53,69,0.55)' },
  no_show:   { bg: 'rgba(220,53,69,0.18)', border: 'rgba(220,53,69,0.65)' },
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

// Calendar — weekly grid with bookings as positioned blocks. Click an empty
// area to create a booking at that time, click a block to open detail.
// Pass `workingHours` to size the hour gutter dynamically.
// Pass `businessTz` (IANA name) so booking blocks render in business clock,
// not browser clock.
function BookingCalendar({ bookings, onOpenBooking, onCreateAt, workingHours = [], businessTz }) {
  const tz = businessTz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [anchor, setAnchor] = useState(() => startOfWeekInTz(tz));

  // Hour window (memoised — recompute only when workingHours change)
  const [firstHour, lastHour] = useMemo(
    () => computeHourRange(workingHours), [workingHours]
  );
  const HOURS = useMemo(
    () => Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i),
    [firstHour, lastHour]
  );

  // Vertical offset (px from top of grid) for a given (h, m). Clamps to grid
  // so out-of-range bookings still appear at the edge.
  const offsetPx = (h, m) => {
    const clampedH = Math.max(firstHour, Math.min(h, lastHour - 1));
    return (clampedH - firstHour) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
  };

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      // Use UTC arithmetic so toISODate() returns business-local dates
      const d = new Date(anchor); d.setUTCDate(anchor.getUTCDate() + i); return d;
    });
  }, [anchor]);

  // Pre-compute each booking's wall-clock view in the business TZ.
  // We attach _localDate ("YYYY-MM-DD") and _localTime ("HH:MM") so we can
  // both group by day and render time labels without re-parsing per render.
  const localised = useMemo(() => bookings.map(b => {
    if (!b.starts_at) return b;
    const start = new Date(b.starts_at);
    const p = partsInTz(start, tz);
    return {
      ...b,
      _localDate: `${p.year}-${p.month}-${p.day}`,
      _localTime: `${p.hour}:${p.minute}`,
      _localHour: parseInt(p.hour, 10),
      _localMin:  parseInt(p.minute, 10),
    };
  }), [bookings, tz]);

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

  // Compute block layout: top, height. Uses business-TZ wall-clock.
  const blockStyle = (b) => {
    const start = new Date(b.starts_at);
    const end   = new Date(b.ends_at || b.starts_at);
    const top   = offsetPx(b._localHour ?? 0, b._localMin ?? 0);
    const dur   = (end - start) / 60000;          // minutes (TZ-independent)
    const h     = Math.max(28, (dur / 60) * HOUR_HEIGHT - 2);
    const c = STATUS_COLOR[b.status] || STATUS_COLOR.confirmed;
    return {
      top: `${top}px`, height: `${h}px`,
      background: c.bg, borderLeft: `3px solid ${c.border}`,
    };
  };

  // Click on a free area → create booking at that 30-min slot
  const handleColClick = (day, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalMinutes = (y / HOUR_HEIGHT) * 60 + firstHour * 60;
    const slot = Math.round(totalMinutes / 30) * 30;
    const h = Math.floor(slot / 60), m = slot % 60;
    onCreateAt?.(toISOLocal(day, h, m));
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
        <span className="bk-cal-range">{headerRange}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}
              title="All times shown in this timezone">
          🕐 {tz}
        </span>
      </div>

      <div className="bk-cal-grid">
        {/* Hour gutter (sticky left) */}
        <div className="bk-cal-gutter">
          <div className="bk-cal-gutter-spacer" />
          {HOURS.map(h => (
            <div key={h} className="bk-cal-hour" style={{ height: `${HOUR_HEIGHT}px` }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* 7 day columns */}
        <div className="bk-cal-cols">
          {weekDays.map((day, i) => {
            const dayKey = toISODate(day);
            const isToday = dayKey === todayISO;
            const dayBookings = byDay[dayKey] || [];
            return (
              <div key={i} className={`bk-cal-col${isToday ? ' bk-cal-col--today' : ''}`}>
                <div className="bk-cal-col-head">
                  <div className="bk-cal-col-day">{DAY_NAMES[i]}</div>
                  <div className="bk-cal-col-date">{day.getUTCDate()}</div>
                </div>

                <div className="bk-cal-col-body"
                  style={{ height: `${HOURS.length * HOUR_HEIGHT}px` }}
                  onClick={(e) => handleColClick(day, e)}>
                  {/* Hour grid lines */}
                  {HOURS.map((_, idx) => (
                    <div key={idx} className="bk-cal-hourline"
                      style={{ top: `${idx * HOUR_HEIGHT}px` }} />
                  ))}

                  {/* Booking blocks */}
                  {dayBookings.map(b => (
                    <div key={b.id}
                      className={`bk-cal-block bk-cal-block--${b.status}`}
                      style={blockStyle(b)}
                      onClick={(e) => { e.stopPropagation(); onOpenBooking(b); }}>
                      <div className="bk-cal-block-time">
                        {b._localTime || b.starts_at.slice(11, 16)} · {b.service_name}
                      </div>
                      <div className="bk-cal-block-customer">{b.customer_name}</div>
                      {b.staff_name && (
                        <div className="bk-cal-block-staff">{b.staff_name}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default BookingCalendar;
