import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  CalendarBlank, GearSix, MagnifyingGlass, List, SquaresFour, CalendarCheck,
  Plus, CaretDown, ArrowDown, Trash, Pencil, Clock, User, X,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import BookingServiceModal from './BookingServiceModal.jsx';
import BookingStaffModal   from './BookingStaffModal.jsx';
import BookingCreateModal  from './BookingCreateModal.jsx';
import BookingDetailModal  from './BookingDetailModal.jsx';
import BookingCalendar     from './BookingCalendar.jsx';
import '../../../Style/Organization.css';
import '../../../Style/Products.css';
import '../../../Style/Orders.css';
import '../../../Style/Authentication.css';
import '../../../Style/Booking.css';

// ── Constants ──────────────────────────────────────────────────

const ALL_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

const STATUS_META = {
  pending:   { label: 'Pending',   cls: 'ord-badge--new'       },
  confirmed: { label: 'Confirmed', cls: 'ord-badge--confirmed' },
  completed: { label: 'Completed', cls: 'ord-badge--delivered' },
  cancelled: { label: 'Cancelled', cls: 'ord-badge--cancelled' },
  no_show:   { label: 'No-show',   cls: 'ord-badge--refunded'  },
};

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  ...ALL_STATUSES.map(s => ({ key: s, label: STATUS_META[s].label })),
];

const SORT_OPTIONS = [
  { field: 'date',     label: 'Sort by date'     },
  { field: 'customer', label: 'Sort by customer' },
];
const DEFAULT_DIR = { date: 'desc', customer: 'asc' };

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Tilt configs ───────────────────────────────────────────────

const ROW_TILT  = { maxAngleX: 10, maxAngleY: 4, lerp: 0.05, lerpOut: 0.07, scale: 1.052, perspective: 900, gloss: { opacity: 0.14, spread: 40 } };
const CARD_TILT = { maxAngle: 8, lerp: 0.05, lerpOut: 0.07, scale: 1.02, perspective: 800, gloss: { opacity: 0.12, spread: 50 } };
const ITEM_TILT = { maxAngleX: 6, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07, scale: 1.018, perspective: 900, gloss: { opacity: 0.10, spread: 40 } };

// ── Helpers ────────────────────────────────────────────────────

const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString([],   { hour: '2-digit', minute: '2-digit' }) : '';
const fmtDateLong = ts => ts ? new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
const fmtMoney = n => `$${(+n).toFixed(2)}`;

// ─── Tab Switcher (mirror of Authentication) ──────────────────

function TabSwitcher({ tab, setTab }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);

  const curTab = hovered ?? tab;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[curTab];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curTab, tab]);

  const TABS = [
    { key: 'bookings', label: 'Bookings', Icon: CalendarBlank },
    { key: 'settings', label: 'Settings', Icon: GearSix },
  ];

  return (
    <div className="auth-tab-switcher" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="auth-tab-indicator" />
      {TABS.map(({ key, label, Icon }) => (
        <button key={key} ref={el => { btnRefs.current[key] = el; }}
          className={`auth-tab-btn${curTab === key ? ' auth-tab-btn--active' : ''}`}
          onMouseEnter={() => setHovered(key)}
          onClick={() => setTab(key)} type="button">
          <Icon className="auth-tab-icon" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Status pill (clickable in row/card to change) ─────────────

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? { label: status, cls: '' };
  return <span className={`ord-badge ${m.cls}`}>{m.label}</span>;
}

// ── Sort toggle (shared with Orders style) ────────────────────

function SortToggle({ sort, onSort }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curField = hovered ?? sort.field;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[curField];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curField, sort.field]);

  const handleClick = field => {
    onSort(prev => ({
      field,
      dir: field === prev.field
        ? (prev.dir === 'asc' ? 'desc' : 'asc')
        : DEFAULT_DIR[field] ?? 'asc',
    }));
  };

  return (
    <div className="ord-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {SORT_OPTIONS.map(({ field, label }) => {
        const active = sort.field === field;
        const isCur  = curField === field;
        return (
          <button key={field} ref={el => { btnRefs.current[field] = el; }}
            className={`org-sort-btn${isCur ? ' org-sort-btn--current' : ''}`}
            style={active ? { paddingLeft: '6px' } : undefined}
            onMouseEnter={() => setHovered(field)}
            onClick={() => handleClick(field)} type="button">
            {active && (
              <ArrowDown className="org-sort-icon"
                style={{ transform: sort.dir === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Status filter pill bar ────────────────────────────────────

function StatusFilter({ active, counts, onChange }) {
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const cur = hovered ?? active;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[cur];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, active]);

  return (
    <div className="ord-filter" onMouseLeave={() => setHovered(null)}>
      <div className="ord-filter-ind" ref={indRef} />
      {STATUS_TABS.map(({ key, label }) => (
        <button key={key} ref={el => { btnRefs.current[key] = el; }}
          className={`ord-filter-btn${cur === key ? ' ord-filter-btn--current' : ''}`}
          onClick={() => onChange(key)}
          onMouseEnter={() => setHovered(key)} type="button">
          {label}
          {key === 'pending' && counts.pending > 0 && (
            <span className="ord-filter-badge">{counts.pending}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Booking row (table view) ─────────────────────────────────

function BookingRow({ booking, onOpen }) {
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, false);
  return (
    <div ref={ref} className="prow bk-prow" onClick={() => onOpen(booking)} {...handlers}>
      <div ref={glossRef} className="org-list-gloss" />

      <span className="bk-prow-customer">
        <span className="bk-prow-name">{booking.customer_name || '—'}</span>
        {booking.customer_phone && <span className="bk-prow-sub">{booking.customer_phone}</span>}
      </span>

      <span className="bk-prow-cell bk-prow-service">{booking.service_name || '—'}</span>

      <span className="bk-prow-cell">
        {booking.staff_name
          ? <span className="bk-staff-chip"><User size={12} /> {booking.staff_name}</span>
          : <span className="bk-no-staff">— Any —</span>}
      </span>

      <span className="bk-prow-cell">
        <div className="bk-when-cell">
          <span className="bk-when-date">{fmtDate(booking.starts_at)}</span>
          <span className="bk-when-time">{fmtTime(booking.starts_at)}</span>
        </div>
      </span>

      <span className="bk-prow-cell"><StatusBadge status={booking.status} /></span>
    </div>
  );
}

// ── Booking card (cards view) ─────────────────────────────────

function BookingCard({ booking, onOpen }) {
  const { ref, glossRef, handlers } = InteractiveSection(CARD_TILT, false);
  return (
    <div ref={ref} className="ord-card bk-card" onClick={() => onOpen(booking)} {...handlers}>
      <div ref={glossRef} className="ord-card-gloss" />
      <div className="ord-card-main">
        <div className="ord-card-top">
          <span className="ord-card-id">{booking.customer_name || '—'}</span>
          <StatusBadge status={booking.status} />
        </div>
        <div className="bk-card-service">{booking.service_name}</div>
        <div className="ord-card-meta">
          <span><Clock size={12} weight="bold" /> {fmtDate(booking.starts_at)} · {fmtTime(booking.starts_at)}</span>
          {booking.staff_name && (
            <>
              <span className="ord-card-dot">·</span>
              <span><User size={12} weight="bold" /> {booking.staff_name}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Service & Staff settings sub-sections ──────────────────────

function ServiceCard({ service, staff, onEdit, onDelete }) {
  const { ref, glossRef, handlers } = InteractiveSection(ITEM_TILT, false);
  const linked = (service.staff_ids || []).map(id => staff.find(s => s.id === id)).filter(Boolean);
  return (
    <div ref={ref} className="bk-cfg-row" {...handlers}>
      <div ref={glossRef} className="org-list-gloss" />
      <div className="bk-cfg-row-main">
        {service.image_url
          ? <img src={service.image_url} className="bk-cfg-img" alt="" />
          : <div className="bk-cfg-img bk-cfg-img--empty"><CalendarBlank size={20} /></div>}
        <div className="bk-cfg-info">
          <div className="bk-cfg-name">{service.name}</div>
          <div className="bk-cfg-meta">
            <span>{service.duration_minutes} min</span>
            <span>·</span>
            <span>{fmtMoney(service.price)}</span>
            {service.requires_staff
              ? <><span>·</span><span>requires staff</span></>
              : service.capacity > 1
                ? <><span>·</span><span>capacity {service.capacity}</span></>
                : null}
            {!service.is_active && <><span>·</span><span className="bk-cfg-inactive">hidden</span></>}
          </div>
          {linked.length > 0 && (
            <div className="bk-cfg-chiplist">
              {linked.map(s => <span key={s.id} className="bk-staff-chip"><User size={11} /> {s.name}</span>)}
            </div>
          )}
        </div>
      </div>
      <div className="bk-cfg-actions">
        <button className="crm-icon-btn" type="button" onClick={onEdit} title="Edit"><Pencil size={16} /></button>
        <button className="crm-icon-btn crm-icon-btn--danger" type="button" onClick={onDelete} title="Delete"><Trash size={16} /></button>
      </div>
    </div>
  );
}

function StaffCard({ member, services, onEdit, onDelete }) {
  const { ref, glossRef, handlers } = InteractiveSection(ITEM_TILT, false);
  const linked = (member.service_ids || []).map(id => services.find(s => s.id === id)).filter(Boolean);
  return (
    <div ref={ref} className="bk-cfg-row" {...handlers}>
      <div ref={glossRef} className="org-list-gloss" />
      <div className="bk-cfg-row-main">
        {member.avatar_url
          ? <img src={member.avatar_url} className="bk-cfg-img bk-cfg-img--round" alt="" />
          : <div className="bk-cfg-img bk-cfg-img--round bk-cfg-img--empty"><User size={20} /></div>}
        <div className="bk-cfg-info">
          <div className="bk-cfg-name">{member.name}</div>
          {member.bio && <div className="bk-cfg-meta">{member.bio}</div>}
          {linked.length > 0 && (
            <div className="bk-cfg-chiplist">
              {linked.map(s => <span key={s.id} className="bk-staff-chip">{s.name}</span>)}
            </div>
          )}
          {!member.is_active && <div className="bk-cfg-meta"><span className="bk-cfg-inactive">hidden</span></div>}
        </div>
      </div>
      <div className="bk-cfg-actions">
        <button className="crm-icon-btn" type="button" onClick={onEdit} title="Edit"><Pencil size={16} /></button>
        <button className="crm-icon-btn crm-icon-btn--danger" type="button" onClick={onDelete} title="Delete"><Trash size={16} /></button>
      </div>
    </div>
  );
}

// ─── Working Hours editor (project-wide) ──────────────────────

function HoursEditor({ projectId, showToast }) {
  const pq = `?project_id=${projectId}`;
  const [rows, setRows] = useState(() => DAY_NAMES.map((_, i) => ({ day_of_week: i, open_time: '', close_time: '', enabled: false })));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/booking/hours${pq}`, { credentials: 'include' })
      .then(r => r.json()).then(data => {
        const next = DAY_NAMES.map((_, i) => {
          const found = data.find(d => d.day_of_week === i);
          return found
            ? { day_of_week: i, open_time: found.open_time, close_time: found.close_time, enabled: true }
            : { day_of_week: i, open_time: '10:00', close_time: '19:00', enabled: false };
        });
        setRows(next);
      });
  }, [projectId]);

  const updateRow = (i, k, v) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  const save = async () => {
    setSaving(true);
    try {
      const body = { staff_id: null, rows: rows.filter(r => r.enabled).map(r => ({
        day_of_week: r.day_of_week, open_time: r.open_time, close_time: r.close_time,
      })) };
      const res = await fetch(`${API_BASE}/api/booking/hours${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) showToast('Hours saved');
    } finally { setSaving(false); }
  };

  return (
    <div className="bk-hours-block">
      {rows.map((r, i) => (
        <div key={i} className="bk-hours-row">
          <label className="bk-hours-day">
            <input type="checkbox" checked={r.enabled}
              onChange={e => updateRow(i, 'enabled', e.target.checked)} />
            <span>{DAY_NAMES[i]}</span>
          </label>
          <input type="time" className="crm-input bk-hours-time"
            value={r.open_time} disabled={!r.enabled}
            onChange={e => updateRow(i, 'open_time', e.target.value)} />
          <span className="bk-hours-dash">–</span>
          <input type="time" className="crm-input bk-hours-time"
            value={r.close_time} disabled={!r.enabled}
            onChange={e => updateRow(i, 'close_time', e.target.value)} />
        </div>
      ))}
      <button className="crm-submit-btn" onClick={save} disabled={saving} type="button" style={{ marginTop: 12 }}>
        {saving ? 'Saving…' : 'Save hours'}
      </button>
    </div>
  );
}

// ─── Booking Rules ────────────────────────────────────────────

function RulesEditor({ projectId, showToast }) {
  const pq = `?project_id=${projectId}`;
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/booking/settings${pq}`, { credentials: 'include' })
      .then(r => r.json()).then(setForm);
  }, [projectId]);

  if (!form) return <p className="crm-placeholder">Loading…</p>;

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const { configured, ...payload } = form;
      const res = await fetch(`${API_BASE}/api/booking/settings${pq}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) showToast('Rules saved');
    } finally { setSaving(false); }
  };

  return (
    <div className="bk-rules-grid">
      <div className="auth-field">
        <label className="auth-label">Slot interval (minutes)</label>
        <p className="auth-field-hint">Step between adjacent bookable times.</p>
        <input className="crm-input" type="number" min={5} max={240}
          value={form.slot_interval_minutes}
          onChange={e => upd('slot_interval_minutes', parseInt(e.target.value, 10) || 15)} />
      </div>
      <div className="auth-field">
        <label className="auth-label">Min advance time (minutes)</label>
        <p className="auth-field-hint">Earliest booking is now + this many minutes.</p>
        <input className="crm-input" type="number" min={0}
          value={form.min_advance_minutes}
          onChange={e => upd('min_advance_minutes', parseInt(e.target.value, 10) || 0)} />
      </div>
      <div className="auth-field">
        <label className="auth-label">Max advance (days)</label>
        <p className="auth-field-hint">Customers can book this many days ahead.</p>
        <input className="crm-input" type="number" min={1} max={365}
          value={form.max_advance_days}
          onChange={e => upd('max_advance_days', parseInt(e.target.value, 10) || 1)} />
      </div>
      <div className="auth-field">
        <label className="auth-label">Cancellation window (minutes)</label>
        <p className="auth-field-hint">Customers can cancel up to this many minutes before the start.</p>
        <input className="crm-input" type="number" min={0}
          value={form.cancellation_window_minutes}
          onChange={e => upd('cancellation_window_minutes', parseInt(e.target.value, 10) || 0)} />
      </div>

      <div className="auth-toggle-row" style={{ gridColumn: '1 / -1' }}>
        <div>
          <span className="auth-toggle-label">Auto-confirm bookings</span>
          <p className="auth-field-hint">When off, new bookings start as <code>pending</code> and you confirm manually.</p>
        </div>
        <label className="auth-toggle">
          <input type="checkbox" checked={form.auto_confirm}
            onChange={e => upd('auto_confirm', e.target.checked)} />
          <span className="auth-toggle-track" />
        </label>
      </div>

      <div className="auth-actions" style={{ gridColumn: '1 / -1' }}>
        <button className="crm-submit-btn" onClick={save} disabled={saving} type="button">
          {saving ? 'Saving…' : 'Save rules'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════

function Booking() {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;

  const [tab,       setTab]       = useState('bookings');
  const [bookings,  setBookings]  = useState([]);
  const [services,  setServices]  = useState([]);
  const [staff,     setStaff]     = useState([]);
  const [hours,     setHours]     = useState([]);   // project working hours
  const [loading,   setLoading]   = useState(true);

  // List view state
  const [view,      setView]      = useState('list');
  const [viewHover, setViewHover] = useState(null);
  const [statusTab, setStatusTab] = useState('all');
  const [search,    setSearch]    = useState('');
  const [sort,      setSort]      = useState({ field: 'date', dir: 'desc' });

  // Modals
  const [openBooking,  setOpenBooking]  = useState(null);
  const [createOpen,   setCreateOpen]   = useState(false);
  const [editService,  setEditService]  = useState(null);   // null = closed; {} = create new; {…} = edit
  const [editStaff,    setEditStaff]    = useState(null);

  // Toast
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  // ── Fetch all data ──
  const reload = useCallback(async () => {
    try {
      const [bRes, sRes, stRes, hRes] = await Promise.all([
        fetch(`${API_BASE}/api/booking/bookings${pq}`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/booking/services${pq}`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/booking/staff${pq}`,    { credentials: 'include' }),
        fetch(`${API_BASE}/api/booking/hours${pq}`,    { credentials: 'include' }),
      ]);
      if (bRes.ok)  setBookings(await bRes.json());
      if (sRes.ok)  setServices(await sRes.json());
      if (stRes.ok) setStaff(await stRes.json());
      if (hRes.ok)  setHours(await hRes.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  // ── Status counts ──
  const counts = useMemo(() => {
    const c = { all: bookings.length };
    for (const s of ALL_STATUSES) c[s] = 0;
    for (const b of bookings) if (c[b.status] !== undefined) c[b.status]++;
    return c;
  }, [bookings]);

  // ── Filtered + sorted ──
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return bookings.filter(b => {
      if (statusTab !== 'all' && b.status !== statusTab) return false;
      if (q) {
        const name = (b.customer_name || '').toLowerCase();
        const svc  = (b.service_name  || '').toLowerCase();
        if (!name.includes(q) && !svc.includes(q)) return false;
      }
      return true;
    });
  }, [bookings, statusTab, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort.field === 'customer') {
      arr.sort((a, b) => {
        const c = (a.customer_name || '').localeCompare(b.customer_name || '');
        return sort.dir === 'asc' ? c : -c;
      });
    } else {
      arr.sort((a, b) => {
        const da = new Date(a.starts_at).getTime();
        const db = new Date(b.starts_at).getTime();
        return sort.dir === 'asc' ? da - db : db - da;
      });
    }
    return arr;
  }, [filtered, sort]);

  const curView = viewHover ?? view;

  // ── Service / staff handlers ──
  const deleteService = async (id) => {
    if (!confirm('Delete this service? Existing bookings will keep referencing it.')) return;
    await fetch(`${API_BASE}/api/booking/services/${id}${pq}`, { method: 'DELETE', credentials: 'include' });
    reload();
  };
  const deleteStaff = async (id) => {
    if (!confirm('Delete this staff member?')) return;
    await fetch(`${API_BASE}/api/booking/staff/${id}${pq}`, { method: 'DELETE', credentials: 'include' });
    reload();
  };

  const updateBookingStatus = async (id, status) => {
    await fetch(`${API_BASE}/api/booking/bookings/${id}${pq}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    setOpenBooking(prev => prev?.id === id ? { ...prev, status } : prev);
  };

  const deleteBooking = async (id) => {
    if (!confirm('Delete this booking permanently?')) return;
    await fetch(`${API_BASE}/api/booking/bookings/${id}${pq}`, { method: 'DELETE', credentials: 'include' });
    setBookings(prev => prev.filter(b => b.id !== id));
    setOpenBooking(null);
  };

  const isEmpty = !loading && sorted.length === 0;
  const emptyMsg = statusTab === 'all' && !search ? 'No bookings yet' : 'No bookings match your filter';

  return (
    <>
      {/* ── Sticky tab switcher ── */}
      <div className="auth-tab-wrapper">
        <TabSwitcher tab={tab} setTab={setTab} />
      </div>

      <div className="prod-page bk-page">

        {/* ───────────────────────────  BOOKINGS TAB  ─────────────────────────── */}
        {tab === 'bookings' && (
          <>
            <h1 className="crm-page-title">Bookings</h1>

            {/* Single flat toolbar (matches Products / Orders pattern) */}
            <div className="org-toolbar bk-toolbar">
              <div className="org-search-wrap">
                <MagnifyingGlass className="org-search-icon" />
                <input className="org-search-input" placeholder="Search bookings…"
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>

              <SortToggle sort={sort} onSort={setSort} />
              <StatusFilter active={statusTab} counts={counts} onChange={setStatusTab} />

              <div className="org-view-toggle bk-view-toggle" onMouseLeave={() => setViewHover(null)}>
                <div className="org-view-indicator bk-view-ind"
                  style={{ transform: `translateX(${curView === 'list' ? 0 : curView === 'cards' ? 30 : 60}px)` }} />
                <button className={`org-view-btn${curView === 'list' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setView('list')} onMouseEnter={() => setViewHover('list')}
                  title="List view" type="button">
                  <List className="org-view-icon" />
                </button>
                <button className={`org-view-btn${curView === 'cards' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setView('cards')} onMouseEnter={() => setViewHover('cards')}
                  title="Cards view" type="button">
                  <SquaresFour className="org-view-icon" />
                </button>
                <button className={`org-view-btn${curView === 'calendar' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setView('calendar')} onMouseEnter={() => setViewHover('calendar')}
                  title="Calendar view" type="button">
                  <CalendarCheck className="org-view-icon" />
                </button>
              </div>

              <button className="org-new-btn" type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="org-new-icon" /> New booking
              </button>
            </div>

            {/* List view */}
            {view === 'list' && (
              <div className="prod-list">
                <div className="bk-list-head">
                  <span className="org-list-th">Customer</span>
                  <span className="org-list-th">Service</span>
                  <span className="org-list-th">Staff</span>
                  <span className="org-list-th">When</span>
                  <span className="org-list-th">Status</span>
                </div>
                {loading ? (
                  <p className="crm-placeholder">Loading bookings…</p>
                ) : isEmpty ? (
                  <div className="ord-empty">
                    <CalendarBlank className="ord-empty-icon" weight="duotone" />
                    <p>{emptyMsg}</p>
                  </div>
                ) : (
                  <div className="prod-list-block">
                    {sorted.map(b => <BookingRow key={b.id} booking={b} onOpen={setOpenBooking} />)}
                  </div>
                )}
              </div>
            )}

            {/* Cards view */}
            {view === 'cards' && (
              loading ? (
                <p className="crm-placeholder">Loading bookings…</p>
              ) : isEmpty ? (
                <div className="ord-empty">
                  <CalendarBlank className="ord-empty-icon" weight="duotone" />
                  <p>{emptyMsg}</p>
                </div>
              ) : (
                <div className="ord-cards">
                  {sorted.map(b => <BookingCard key={b.id} booking={b} onOpen={setOpenBooking} />)}
                </div>
              )
            )}

            {/* Calendar view */}
            {view === 'calendar' && (
              <BookingCalendar
                bookings={sorted}
                workingHours={hours}
                onOpenBooking={setOpenBooking}
                onCreateAt={(iso) => setCreateOpen({ presetStart: iso })}
              />
            )}
          </>
        )}

        {/* ───────────────────────────  SETTINGS TAB  ─────────────────────────── */}
        {tab === 'settings' && (
          <>
            <h1 className="crm-page-title">Booking Settings</h1>
            <p className="auth-page-subtitle">
              Configure services, staff, working hours and booking rules for this business.
            </p>

            {/* Services */}
            <section className="bk-section">
              <div className="bk-section-head">
                <h2 className="bk-section-title">Services</h2>
                <button className="crm-add-btn" type="button" onClick={() => setEditService({})}>
                  <Plus size={14} /> New service
                </button>
              </div>
              {services.length === 0 ? (
                <div className="bk-empty-block">No services yet — add one to start accepting bookings.</div>
              ) : (
                <div className="bk-cfg-list">
                  {services.map(s => (
                    <ServiceCard key={s.id} service={s} staff={staff}
                      onEdit={() => setEditService(s)}
                      onDelete={() => deleteService(s.id)} />
                  ))}
                </div>
              )}
            </section>

            {/* Staff */}
            <section className="bk-section">
              <div className="bk-section-head">
                <h2 className="bk-section-title">Staff</h2>
                <button className="crm-add-btn" type="button" onClick={() => setEditStaff({})}>
                  <Plus size={14} /> New staff
                </button>
              </div>
              {staff.length === 0 ? (
                <div className="bk-empty-block">
                  No staff configured. Services without a required staff member will be booked by capacity instead.
                </div>
              ) : (
                <div className="bk-cfg-list">
                  {staff.map(m => (
                    <StaffCard key={m.id} member={m} services={services}
                      onEdit={() => setEditStaff(m)}
                      onDelete={() => deleteStaff(m.id)} />
                  ))}
                </div>
              )}
            </section>

            {/* Working hours */}
            <section className="bk-section">
              <div className="bk-section-head">
                <h2 className="bk-section-title">Working hours</h2>
              </div>
              <p className="auth-field-hint" style={{ marginBottom: 12 }}>
                Default hours of operation. Used for services without a specific staff member.
              </p>
              <HoursEditor projectId={projectId} showToast={showToast} />
            </section>

            {/* Rules */}
            <section className="bk-section">
              <div className="bk-section-head">
                <h2 className="bk-section-title">Booking rules</h2>
              </div>
              <RulesEditor projectId={projectId} showToast={showToast} />
            </section>
          </>
        )}
      </div>

      {/* ───────────────────────────  Modals  ─────────────────────────── */}

      {openBooking && (
        <BookingDetailModal
          booking={openBooking}
          onClose={() => setOpenBooking(null)}
          onStatusChange={updateBookingStatus}
          onDelete={deleteBooking}
        />
      )}

      {createOpen && (
        <BookingCreateModal
          projectId={projectId}
          services={services}
          staff={staff}
          presetStart={typeof createOpen === 'object' ? createOpen.presetStart : null}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); reload(); showToast('Booking created'); }}
        />
      )}

      {editService !== null && (
        <BookingServiceModal
          projectId={projectId}
          service={editService.id ? editService : null}
          allStaff={staff}
          onClose={() => setEditService(null)}
          onSaved={() => { setEditService(null); reload(); showToast('Service saved'); }}
        />
      )}

      {editStaff !== null && (
        <BookingStaffModal
          projectId={projectId}
          member={editStaff.id ? editStaff : null}
          allServices={services}
          onClose={() => setEditStaff(null)}
          onSaved={() => { setEditStaff(null); reload(); showToast('Staff saved'); }}
        />
      )}

      {/* Toast */}
      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}

export default Booking;
