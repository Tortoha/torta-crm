// Static, faithful mock of the CRM Bookings week calendar (light theme only).
// Mirrors Pages/Project/Booking/BookingCalendar.jsx. Appointment blocks are
// absolute-positioned by pixel (30-min slot = 48px, grid starts at 09:00).

import { CaretLeft, CaretRight, UsersThree } from '@phosphor-icons/react';

const HOURS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00'];
const DAYS = [
  { day: 'Mon', date: 14 }, { day: 'Tue', date: 15 }, { day: 'Wed', date: 16, today: true },
  { day: 'Thu', date: 17 }, { day: 'Fri', date: 18 }, { day: 'Sat', date: 19 }, { day: 'Sun', date: 20 },
];
const APPTS = [
  { col: 0, service: 'Haircut & Style',     staff: 'with Anna',   time: '09:00 – 10:00', st: 'confirmed', top: 3,   h: 90 },
  { col: 0, service: 'Beard Trim',          staff: 'with Dmitri', time: '11:30 – 12:00', st: 'pending',   top: 243, h: 42 },
  { col: 2, service: 'Color & Highlights',  staff: 'with Anna',   time: '13:00 – 15:00', st: 'confirmed', top: 387, h: 186 },
  { col: 3, service: 'Manicure',            staff: 'with Lena',   time: '10:00 – 10:45', st: 'completed', top: 99,  h: 66 },
  { col: 4, service: 'Deep-Tissue Massage', staff: 'with Marco',  time: '14:00 – 15:00', st: 'cancelled', top: 483, h: 90 },
];

export default function MockBooking() {
  return (
    <div className="mk-bk">
      <div className="mk-bk-toolbar">
        <span className="mk-bk-nav"><CaretLeft weight="bold" /></span>
        <span className="mk-bk-today">Today</span>
        <span className="mk-bk-nav"><CaretRight weight="bold" /></span>
        <span className="mk-bk-range">Jul 14 – Jul 20, 2026</span>
        <span className="mk-bk-staff"><UsersThree weight="bold" /> All staff</span>
      </div>

      <div className="mk-bk-grid">
        <div className="mk-bk-gutter">
          <div className="mk-bk-gspacer" />
          {HOURS.map((h) => (
            <div key={h} className="mk-bk-hour"><span className="mk-bk-hpill">{h}</span></div>
          ))}
        </div>

        <div className="mk-bk-cols">
          {DAYS.map((d, ci) => (
            <div key={d.day} className={`mk-bk-col${d.today ? ' mk-bk-col--today' : ''}`}>
              <div className="mk-bk-colhead">
                <span className="mk-bk-cday">{d.day}</span>
                <span className="mk-bk-cdate">{d.date}</span>
              </div>
              <div className="mk-bk-colbody">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="mk-bk-slot" style={{ top: i * 48 + 3, height: 42 }} />
                ))}
                {APPTS.filter((a) => a.col === ci).map((a, i) => (
                  <div key={i} className={`mk-bk-card mk-bk-card--${a.st}`} style={{ top: a.top, height: a.h }}>
                    <span className="mk-bk-stripe" />
                    <div className="mk-bk-cinner">
                      <span className="mk-bk-cname">{a.service}</span>
                      <span className="mk-bk-ctime">{a.time}</span>
                      {a.h >= 80 && <span className="mk-bk-cstaff">{a.staff}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
