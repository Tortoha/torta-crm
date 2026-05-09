// Custom date+time picker — replaces native datetime-local; "YYYY-MM-DDTHH:MM" wire format.

import { DatePicker, TimePicker } from '../Pages/Project/Booking/BookingCreateModal.jsx';
// Pull in bk-date-pop/bk-time-pop styles so consumers don't need to remember the import.
import '../Style/Booking.css';

export function DateTimePicker({ value, onChange, slotInterval = 15 }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [datePart, timePart] = (value || '').includes('T')
    ? value.split('T')
    : [value || '', ''];

  const setDate = (d) => {
    if (!d) { onChange(''); return; }
    onChange(`${d}T${timePart || '00:00'}`);
  };
  const setTime = (t) => {
    if (!datePart) {
      const today = new Date().toISOString().slice(0, 10);
      onChange(`${today}T${t}`);
    } else {
      onChange(`${datePart}T${t}`);
    }
  };

  return (
    <div className="cpm-datetime-row">
      <DatePicker value={datePart} onChange={setDate} tz={tz} />
      <TimePicker value={timePart || '00:00'} onChange={setTime}
        slotInterval={slotInterval} />
    </div>
  );
}
