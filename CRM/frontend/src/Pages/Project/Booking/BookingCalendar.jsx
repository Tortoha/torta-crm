import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_HEIGHT = 56;            // px per hour row
const DEFAULT_FIRST_HOUR = 8;
const DEFAULT_LAST_HOUR  = 22;     // exclusive — i.e. 8..21 visible

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

// Get the Monday of the week containing `date`.
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;     // shift Sun(0) → 6, Mon(1) → 0
  d.setDate(d.getDate() - dow);
  return d;
}

// Format YYYY-MM-DD without timezone surprises.
const pad = n => String(n).padStart(2, '0');
const toISODate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toISOLocal = (d, h, m) => `${toISODate(d)}T${pad(h)}:${pad(m)}`;

// Calendar — weekly grid with bookings as positioned blocks. Click an empty
// area to create a booking at that time, click a block to open detail.
// Pass `workingHours` (array of {open_time, close_time, day_of_week}) to size
// the hour gutter dynamically; defaults to 08:00–22:00 if not provided.
function BookingCalendar({ bookings, onOpenBooking, onCreateAt, workingHours = [] }) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));

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
      const d = new Date(anchor); d.setDate(anchor.getDate() + i); return d;
    });
  }, [anchor]);

  // Group bookings by (yyyy-mm-dd).
  const byDay = useMemo(() => {
    const m = {};
    for (const b of bookings) {
      if (!b.starts_at) continue;
      const key = b.starts_at.slice(0, 10);
      (m[key] = m[key] || []).push(b);
    }
    return m;
  }, [bookings]);

  const todayISO = toISODate(new Date());

  const goPrev = () => { const d = new Date(anchor); d.setDate(d.getDate() - 7); setAnchor(d); };
  const goNext = () => { const d = new Date(anchor); d.setDate(d.getDate() + 7); setAnchor(d); };
  const goToday = () => setAnchor(startOfWeek(new Date()));

  // Compute block layout: top, height. Clamp to grid bounds.
  const blockStyle = (b) => {
    const start = new Date(b.starts_at);
    const end   = new Date(b.ends_at || b.starts_at);
    const top   = offsetPx(start.getHours(), start.getMinutes());
    const dur   = (end - start) / 60000;          // minutes
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

  const headerRange = `${weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${
    weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="bk-cal">
      <div className="bk-cal-toolbar">
        <button className="crm-icon-btn" onClick={goPrev}    type="button" title="Previous week"><CaretLeft size={16} /></button>
        <button className="crm-add-btn"  onClick={goToday}   type="button" style={{ padding: '6px 14px' }}>Today</button>
        <button className="crm-icon-btn" onClick={goNext}    type="button" title="Next week"><CaretRight size={16} /></button>
        <span className="bk-cal-range">{headerRange}</span>
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
                  <div className="bk-cal-col-date">{day.getDate()}</div>
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
                        {b.starts_at.slice(11, 16)} · {b.service_name}
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
