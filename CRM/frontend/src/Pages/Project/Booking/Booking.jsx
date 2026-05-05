import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { encodeId } from '../../../Utils/hashids.js';
import {
  CalendarBlank, GearSix, MagnifyingGlass, List, SquaresFour, CalendarCheck,
  Plus, CaretDown, ArrowDown, Trash, Pencil, Clock, User, Users, Briefcase, DotsThreeOutline, X,
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
    { key: 'services', label: 'Services', Icon: Briefcase     },
    { key: 'staff',    label: 'Staff',    Icon: Users          },
    { key: 'settings', label: 'Settings', Icon: GearSix       },
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

function SortToggle({ sort, onSort, options = SORT_OPTIONS, defaultDirs = DEFAULT_DIR }) {
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
        : defaultDirs[field] ?? 'asc',
    }));
  };

  return (
    <div className="ord-sort-toggle" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="org-sort-indicator" />
      {options.map(({ field, label }) => {
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

const SVC_SORT_OPTIONS  = [{field:'name',label:'Sort by name'},{field:'price',label:'Sort by price'},{field:'duration',label:'Sort by duration'}];
const SVC_SORT_DIRS     = { name: 'asc', price: 'asc', duration: 'asc' };
const STAFF_SORT_OPTIONS= [{field:'name',label:'Sort by name'},{field:'date',label:'Sort by date'}];
const STAFF_SORT_DIRS   = { name: 'asc', date: 'desc' };

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

function BookingRow({ booking, onOpen, onRowClick, isSelected }) {
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, false);
  return (
    <div ref={ref}
      className={`prow bk-prow${isSelected ? ' prow--bulk' : ''}`}
      onClick={(e) => { if (onRowClick?.(e, booking)) return; onOpen(booking); }}
      {...handlers}>
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

function BookingCard({ booking, onOpen, onRowClick, isSelected }) {
  const { ref, glossRef, handlers } = InteractiveSection(CARD_TILT, false);
  return (
    <div ref={ref}
      className={`ord-card bk-card${isSelected ? ' bk-card--bulk' : ''}`}
      onClick={(e) => { if (onRowClick?.(e, booking)) return; onOpen(booking); }}
      {...handlers}>
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

// ─── Service & Staff list/card components ──────────────────────
// Visual design mirrored from Pages/Project/Products/ProductsList.jsx
// (prod-card / prow + tilt + 3-dots menu) so Services and Products feel
// like one product in the same CRM, not two different pages.

function ServiceMenu({ btnRef, onEdit, onDelete, onClose }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 160) });
    }
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  if (!pos) return null;
  return createPortal(
    <div className="org-card-dropdown" style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <button className="org-card-dropdown-item" onClick={onEdit}>
        <Pencil className="org-card-dropdown-icon" /> Edit
      </button>
      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger" onClick={onDelete}>
        <Trash className="org-card-dropdown-icon" /> Delete
      </button>
    </div>,
    document.body
  );
}

function ServiceRow({ service, staff, onEdit, onDelete }) {
  const menuBtnRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, menuOpen);
  const linked = (service.staff_ids || []).map(id => staff.find(s => s.id === id)).filter(Boolean);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

  const capLabel = service.requires_staff
    ? '1:1'
    : service.capacity > 1 ? `${service.capacity} seats` : '—';
  const staffLabel = linked.length === 0 ? '—'
    : linked.length === 1 ? linked[0].name
    : `${linked[0].name} +${linked.length - 1}`;

  return (
    <div ref={ref}
      className={`prow bk-svc-prow${menuOpen ? ' org-list-row--frozen' : ''}${!service.is_active ? ' prow--paused' : ''}`}
      onClick={onEdit} {...handlers}>
      <div ref={glossRef} className="org-list-gloss" />
      <div className="prow-img-wrap">
        {service.image_url
          ? <img src={service.image_url} className="prow-img" alt="" />
          : <div className="prow-img-empty"><Briefcase size={14} /></div>}
      </div>
      <span className="prow-name">{service.name}</span>
      <span className="prow-cell">{service.duration_minutes} min</span>
      <span className="prow-cell">{fmtMoney(service.price)}</span>
      <span className="prow-cell">{capLabel}</span>
      <span className="prow-cell">{staffLabel}</span>
      <button ref={menuBtnRef} className="org-list-menu-btn" type="button"
        onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <ServiceMenu btnRef={menuBtnRef}
          onEdit={() => { setMenuOpen(false); onEdit(); }}
          onDelete={() => { setMenuOpen(false); onDelete(); }}
          onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

function ServiceCard({ service, staff, onEdit, onDelete }) {
  const menuBtnRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(CARD_TILT, menuOpen);
  const linked = (service.staff_ids || []).map(id => staff.find(s => s.id === id)).filter(Boolean);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

  // Bottom-right badge (mirrors pcard-cat-badge): hidden state wins, then capacity for group sessions.
  let badge = null;
  if (!service.is_active)                 badge = 'Hidden';
  else if (service.requires_staff)        badge = '1:1';
  else if (service.capacity > 1)          badge = `${service.capacity} seats`;

  return (
    <div ref={ref}
      className={`org-card org-card--tilt prod-card bk-svc-pcard${!service.is_active ? ' prod-card--paused' : ''}`}
      onClick={onEdit} {...handlers}>
      <div ref={glossRef} className="org-card-gloss prod-card-gloss" />
      <div className="pcard-inner">
        <div className="pcard-img-wrap">
          {service.image_url
            ? <img src={service.image_url} className="pcard-img" alt="" />
            : <div className="pcard-img-empty"><Briefcase size={22} /></div>}
        </div>
        <div className="pcard-body">
          <div className="pcard-title">{service.name}</div>
          <div className="pcard-row1">
            <span className="pcard-price">{service.duration_minutes} min</span>
            <span className="pcard-pipe">|</span>
            <span className="pcard-stock">{fmtMoney(service.price)}</span>
          </div>
          {linked.length > 0 && (
            <div className="bk-cfg-chiplist">
              {linked.slice(0, 3).map(s => <span key={s.id} className="bk-staff-chip"><User size={11} /> {s.name}</span>)}
              {linked.length > 3 && <span className="bk-staff-chip">+{linked.length - 3}</span>}
            </div>
          )}
        </div>
      </div>
      {badge && <span className="pcard-cat-badge">{badge}</span>}
      <button ref={menuBtnRef} className="org-card-menu-btn pcard-menu-btn" type="button"
        onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <ServiceMenu btnRef={menuBtnRef}
          onEdit={() => { setMenuOpen(false); onEdit(); }}
          onDelete={() => { setMenuOpen(false); onDelete(); }}
          onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

// Staff row — mirrors ServiceRow / ProdListRow visual exactly. Round avatar
// (bk-prow-avatar override) instead of square service image; otherwise same
// 7-col grid + tilt + 3-dot menu.
function StaffRow({ member, services, onEdit, onDelete }) {
  const menuBtnRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, menuOpen);
  const linked = (member.service_ids || []).map(id => services.find(s => s.id === id)).filter(Boolean);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

  const servicesLabel = linked.length === 0 ? '—'
    : linked.length === 1 ? linked[0].name
    : `${linked[0].name} +${linked.length - 1}`;

  return (
    <div ref={ref}
      className={`prow bk-stf-prow${menuOpen ? ' org-list-row--frozen' : ''}${!member.is_active ? ' prow--paused' : ''}`}
      onClick={onEdit} {...handlers}>
      <div ref={glossRef} className="org-list-gloss" />
      <div className="prow-img-wrap bk-stf-avatar-wrap">
        {member.avatar_url
          ? <img src={member.avatar_url} className="prow-img bk-stf-avatar" alt="" />
          : <div className="prow-img-empty bk-stf-avatar"><User size={14} /></div>}
      </div>
      <span className="prow-name">{member.name}</span>
      <span className="prow-cell">{member.bio || <span className="prow-empty">—</span>}</span>
      <span className="prow-cell">{servicesLabel}</span>
      <button ref={menuBtnRef} className="org-list-menu-btn" type="button"
        onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <ServiceMenu btnRef={menuBtnRef}
          onEdit={() => { setMenuOpen(false); onEdit(); }}
          onDelete={() => { setMenuOpen(false); onDelete(); }}
          onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

// Staff card — mirrors ServiceCard / ProductCard. Round avatar instead of
// square image, but same prod-card shell + tilt + 3-dot menu + bottom-right badge.
function StaffCard({ member, services, onEdit, onDelete }) {
  const menuBtnRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(CARD_TILT, menuOpen);
  const linked = (member.service_ids || []).map(id => services.find(s => s.id === id)).filter(Boolean);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => {
      if (!e.target.closest?.('.org-card-dropdown') && !menuBtnRef.current?.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

  const badge = !member.is_active ? 'Hidden'
              : linked.length > 0 ? `${linked.length} service${linked.length === 1 ? '' : 's'}`
              : null;

  return (
    <div ref={ref}
      className={`org-card org-card--tilt prod-card bk-stf-pcard${!member.is_active ? ' prod-card--paused' : ''}`}
      onClick={onEdit} {...handlers}>
      <div ref={glossRef} className="org-card-gloss prod-card-gloss" />
      <div className="pcard-inner">
        <div className="pcard-img-wrap bk-stf-avatar-wrap">
          {member.avatar_url
            ? <img src={member.avatar_url} className="pcard-img bk-stf-avatar" alt="" />
            : <div className="pcard-img-empty bk-stf-avatar"><User size={22} /></div>}
        </div>
        <div className="pcard-body">
          <div className="pcard-title">{member.name}</div>
          {member.bio && (
            <div className="pcard-row1">
              <span className="pcard-stock" style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                {member.bio}
              </span>
            </div>
          )}
          {linked.length > 0 && (
            <div className="bk-cfg-chiplist">
              {linked.slice(0, 3).map(s => <span key={s.id} className="bk-staff-chip">{s.name}</span>)}
              {linked.length > 3 && <span className="bk-staff-chip">+{linked.length - 3}</span>}
            </div>
          )}
        </div>
      </div>
      {badge && <span className="pcard-cat-badge">{badge}</span>}
      <button ref={menuBtnRef} className="org-card-menu-btn pcard-menu-btn" type="button"
        onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
        <DotsThreeOutline weight="fill" className="org-card-menu-icon" />
      </button>
      {menuOpen && (
        <ServiceMenu btnRef={menuBtnRef}
          onEdit={() => { setMenuOpen(false); onEdit(); }}
          onDelete={() => { setMenuOpen(false); onDelete(); }}
          onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

// ─── Stats block (Settings tab) ────────────────────────────────
function StatsBlock({ projectId }) {
  const pq = `?project_id=${projectId}`;
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/booking/stats${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null).then(setStats);
  }, [projectId]);

  if (!stats) return <p className="crm-placeholder">Loading…</p>;
  const wow = stats.last_week_count
    ? Math.round(((stats.week_count - stats.last_week_count) / stats.last_week_count) * 100)
    : null;

  return (
    <div className="bk-stats-grid">
      <StatCard label="Total bookings" value={stats.total} />
      <StatCard label="This week" value={stats.week_count}
        delta={wow != null ? `${wow >= 0 ? '+' : ''}${wow}% vs last week` : ''} />
      <StatCard label="Avg ticket" value={`$${stats.avg_ticket.toFixed(2)}`} />
      <StatCard label="No-show rate" value={`${stats.no_show_rate}%`}
        tone={stats.no_show_rate > 15 ? 'warn' : 'ok'} />
      {stats.top_staff.length > 0 && (
        <div className="bk-stats-card bk-stats-card--wide">
          <span className="bk-stats-label">Top staff (completed)</span>
          <div className="bk-stats-staff-list">
            {stats.top_staff.map(s => (
              <div key={s.id} className="bk-stats-staff-row">
                <span className="bk-stats-staff-name">{s.name}</span>
                <span className="bk-stats-staff-count">{s.completed}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, delta, tone }) {
  return (
    <div className={`bk-stats-card${tone === 'warn' ? ' bk-stats-card--warn' : ''}`}>
      <span className="bk-stats-label">{label}</span>
      <span className="bk-stats-value">{value}</span>
      {delta && <span className="bk-stats-delta">{delta}</span>}
    </div>
  );
}

// ─── Working Hours editor (project-wide) ──────────────────────

function HoursEditor({ projectId, showToast, onSaved }) {
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
      if (res.ok) {
        showToast('Hours saved');
        onSaved?.();
      }
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

function RulesEditor({ projectId, showToast, onSaved }) {
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
      if (res.ok) {
        showToast('Rules saved');
        onSaved?.();
      }
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
  const navigate = useNavigate();
  // Edit click on a service: linked products jump to /product/{hash}; legacy ones (no product_id) keep the modal.
  const onEditService = (s) => {
    if (s.product_id) navigate(`/product/${encodeId(s.product_id)}`);
    else setEditService(s);
  };
  const pq = `?project_id=${projectId}`;

  const [tab,       setTab]       = useState('bookings');
  const [bookings,  setBookings]  = useState([]);
  const [services,  setServices]  = useState([]);
  const [staff,     setStaff]     = useState([]);
  const [hours,     setHours]     = useState([]);   // project working hours
  const [settings,  setSettings]  = useState(null); // booking_settings (incl. timezone)
  const [loading,   setLoading]   = useState(true);

  // Business timezone — falls back to browser's local TZ if not configured.
  // All wall-clock displays (Calendar, Create modal) use THIS, not the
  // browser's TZ — so an Almaty owner travelling to Istanbul still sees
  // her bookings in Almaty time.
  const businessTz = settings?.timezone
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';

  // List view state
  const [view,      setView]      = useState('calendar');
  const [viewHover, setViewHover] = useState(null);
  const [statusTab, setStatusTab] = useState('all');
  const [search,    setSearch]    = useState('');
  const [sort,      setSort]      = useState({ field: 'date', dir: 'desc' });

  // Services tab state
  const [svcSearch, setSvcSearch] = useState('');
  const [svcSort,   setSvcSort]   = useState({ field: 'name', dir: 'asc' });
  const [svcView,   setSvcView]   = useState('list');
  const [svcViewHover, setSvcViewHover] = useState(null);

  // Staff tab state
  const [stfSearch, setStfSearch] = useState('');
  const [stfSort,   setStfSort]   = useState({ field: 'name', dir: 'asc' });
  const [stfView,   setStfView]   = useState('list');
  const [stfViewHover, setStfViewHover] = useState(null);

  // Modals
  const [openBooking,  setOpenBooking]  = useState(null);
  const [createOpen,   setCreateOpen]   = useState(false);
  const [editService,  setEditService]  = useState(null);   // null = closed; {} = create new; {…} = edit
  const [editStaff,    setEditStaff]    = useState(null);

  // Bulk selection — Shift/Ctrl+click toggles a row, plain click in bulk-mode also toggles.
  const [selected, setSelected] = useState(new Set());
  const inBulk = selected.size > 0;
  const toggleSel = (id) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const clearSel = () => setSelected(new Set());

  const onRowClick = (e, b) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey || inBulk) {
      e.stopPropagation();
      toggleSel(b.id);
      return true;  // caller skips the open-detail behaviour
    }
    return false;
  };

  const bulkSetStatus = async (status) => {
    if (!selected.size) return;
    if (!confirm(`Set ${selected.size} booking${selected.size === 1 ? '' : 's'} to "${status}"?`)) return;
    await Promise.all(Array.from(selected).map(id =>
      fetch(`${API_BASE}/api/booking/bookings/${id}${pq}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    ));
    setBookings(prev => prev.map(b => selected.has(b.id) ? { ...b, status } : b));
    clearSel();
    showToast(`${selected.size} booking${selected.size === 1 ? '' : 's'} updated`);
  };

  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} booking${selected.size === 1 ? '' : 's'} permanently?`)) return;
    await Promise.all(Array.from(selected).map(id =>
      fetch(`${API_BASE}/api/booking/bookings/${id}${pq}`, { method: 'DELETE', credentials: 'include' })
    ));
    setBookings(prev => prev.filter(b => !selected.has(b.id)));
    clearSel();
    showToast(`${selected.size} booking${selected.size === 1 ? '' : 's'} deleted`);
  };

  // Esc clears selection.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && selected.size) clearSel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size]);

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
      const [bRes, sRes, stRes, hRes, setRes] = await Promise.all([
        fetch(`${API_BASE}/api/booking/bookings${pq}`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/booking/services${pq}`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/booking/staff${pq}`,    { credentials: 'include' }),
        fetch(`${API_BASE}/api/booking/hours${pq}`,    { credentials: 'include' }),
        fetch(`${API_BASE}/api/booking/settings${pq}`, { credentials: 'include' }),
      ]);
      if (bRes.ok)   setBookings(await bRes.json());
      if (sRes.ok)   setServices(await sRes.json());
      if (stRes.ok)  setStaff(await stRes.json());
      if (hRes.ok)   setHours(await hRes.json());
      if (setRes.ok) setSettings(await setRes.json());
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

  const curView    = viewHover    ?? view;
  const curSvcView = svcViewHover ?? svcView;
  const curStfView = stfViewHover ?? stfView;

  // Services: search + sort
  const servicesSorted = useMemo(() => {
    const q = svcSearch.toLowerCase();
    let arr = services.filter(s => !q || s.name.toLowerCase().includes(q));
    arr = [...arr].sort((a, b) => {
      const getVal = svcSort.field === 'name'
        ? (x => (x.name || '').toLowerCase())
        : svcSort.field === 'price'
        ? (x => Number(x.price) || 0)
        : (x => Number(x.duration_minutes) || 0);
      const va = getVal(a), vb = getVal(b);
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return svcSort.dir === 'asc' ? c : -c;
    });
    return arr;
  }, [services, svcSearch, svcSort]);

  // Staff: search + sort
  const staffSorted = useMemo(() => {
    const q = stfSearch.toLowerCase();
    let arr = staff.filter(m => !q || (m.name || '').toLowerCase().includes(q));
    arr = [...arr].sort((a, b) => {
      if (stfSort.field === 'name') {
        const c = (a.name || '').localeCompare(b.name || '');
        return stfSort.dir === 'asc' ? c : -c;
      }
      return stfSort.dir === 'asc' ? a.id - b.id : b.id - a.id;
    });
    return arr;
  }, [staff, stfSearch, stfSort]);

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
                    {sorted.map(b => (
                      <BookingRow key={b.id} booking={b} onOpen={setOpenBooking}
                        onRowClick={onRowClick} isSelected={selected.has(b.id)} />
                    ))}
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
                  {sorted.map(b => (
                    <BookingCard key={b.id} booking={b} onOpen={setOpenBooking}
                      onRowClick={onRowClick} isSelected={selected.has(b.id)} />
                  ))}
                </div>
              )
            )}

            {/* Calendar view */}
            {view === 'calendar' && (
              <BookingCalendar
                bookings={sorted}
                workingHours={hours}
                businessTz={businessTz}
                slotInterval={settings?.slot_interval_minutes || 30}
                staff={staff}
                onOpenBooking={setOpenBooking}
                onCreateAt={(iso) => setCreateOpen({ presetStart: iso })}
                onMoveBooking={async (id, iso) => {
                  const res = await fetch(`${API_BASE}/api/booking/bookings/${id}/move${pq}&starts_at=${encodeURIComponent(iso)}`,
                    { method: 'PUT', credentials: 'include' });
                  if (res.ok) { reload(); showToast('Booking moved'); }
                  else showToast('Move failed');
                }}
              />
            )}
          </>
        )}

        {/* ───────────────────────────  SERVICES TAB  ─────────────────────────── */}
        {tab === 'services' && (
          <>
            <h1 className="crm-page-title">Services</h1>
            <div className="org-toolbar bk-toolbar">
              <div className="org-search-wrap">
                <MagnifyingGlass className="org-search-icon" />
                <input className="org-search-input" placeholder="Search services…"
                  value={svcSearch} onChange={e => setSvcSearch(e.target.value)} />
              </div>
              <SortToggle sort={svcSort} onSort={setSvcSort}
                options={SVC_SORT_OPTIONS} defaultDirs={SVC_SORT_DIRS} />
              <div className="org-view-toggle" onMouseLeave={() => setSvcViewHover(null)}>
                <div className="org-view-indicator"
                  style={{ transform: `translateX(${curSvcView === 'cards' ? 30 : 0}px)` }} />
                <button className={`org-view-btn${curSvcView === 'list' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setSvcView('list')} onMouseEnter={() => setSvcViewHover('list')}
                  title="List view" type="button">
                  <List className="org-view-icon" />
                </button>
                <button className={`org-view-btn${curSvcView === 'cards' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setSvcView('cards')} onMouseEnter={() => setSvcViewHover('cards')}
                  title="Cards view" type="button">
                  <SquaresFour className="org-view-icon" />
                </button>
              </div>
              <button className="org-new-btn" type="button" onClick={() => setEditService({})}>
                <Plus className="org-new-icon" /> New service
              </button>
            </div>
            {loading ? (
              <p className="crm-placeholder">Loading services…</p>
            ) : servicesSorted.length === 0 ? (
              <div className="bk-empty-block">
                {services.length === 0
                  ? 'No services yet — add one to start accepting bookings.'
                  : 'No services match your search.'}
              </div>
            ) : svcView === 'cards' ? (
              <div className="prod-grid">
                {servicesSorted.map(s => (
                  <ServiceCard key={s.id} service={s} staff={staff}
                    onEdit={() => onEditService(s)}
                    onDelete={() => deleteService(s.id)} />
                ))}
              </div>
            ) : (
              <div className="prod-list">
                <div className="prod-list-head bk-svc-list-head">
                  <span /><span className="org-list-th">Title</span>
                  <span className="org-list-th">Duration</span>
                  <span className="org-list-th">Price</span>
                  <span className="org-list-th">Capacity</span>
                  <span className="org-list-th">Staff</span>
                  <span />
                </div>
                <div className="prod-list-block">
                  {servicesSorted.map(s => (
                    <ServiceRow key={s.id} service={s} staff={staff}
                      onEdit={() => onEditService(s)}
                      onDelete={() => deleteService(s.id)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ───────────────────────────  STAFF TAB  ─────────────────────────── */}
        {tab === 'staff' && (
          <>
            <h1 className="crm-page-title">Staff</h1>
            <div className="org-toolbar bk-toolbar">
              <div className="org-search-wrap">
                <MagnifyingGlass className="org-search-icon" />
                <input className="org-search-input" placeholder="Search staff…"
                  value={stfSearch} onChange={e => setStfSearch(e.target.value)} />
              </div>
              <SortToggle sort={stfSort} onSort={setStfSort}
                options={STAFF_SORT_OPTIONS} defaultDirs={STAFF_SORT_DIRS} />
              <div className="org-view-toggle" onMouseLeave={() => setStfViewHover(null)}>
                <div className="org-view-indicator"
                  style={{ transform: `translateX(${curStfView === 'cards' ? 30 : 0}px)` }} />
                <button className={`org-view-btn${curStfView === 'list' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setStfView('list')} onMouseEnter={() => setStfViewHover('list')}
                  title="List view" type="button">
                  <List className="org-view-icon" />
                </button>
                <button className={`org-view-btn${curStfView === 'cards' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setStfView('cards')} onMouseEnter={() => setStfViewHover('cards')}
                  title="Cards view" type="button">
                  <SquaresFour className="org-view-icon" />
                </button>
              </div>
              <button className="org-new-btn" type="button" onClick={() => setEditStaff({})}>
                <Plus className="org-new-icon" /> New staff
              </button>
            </div>
            {loading ? (
              <p className="crm-placeholder">Loading staff…</p>
            ) : staffSorted.length === 0 ? (
              <div className="bk-empty-block">
                {staff.length === 0
                  ? 'No staff configured. Services without a required staff member will be booked by capacity instead.'
                  : 'No staff match your search.'}
              </div>
            ) : stfView === 'cards' ? (
              <div className="prod-grid">
                {staffSorted.map(m => (
                  <StaffCard key={m.id} member={m} services={services}
                    onEdit={() => setEditStaff(m)}
                    onDelete={() => deleteStaff(m.id)} />
                ))}
              </div>
            ) : (
              <div className="prod-list">
                <div className="prod-list-head bk-stf-list-head">
                  <span /><span className="org-list-th">Name</span>
                  <span className="org-list-th">Bio</span>
                  <span className="org-list-th">Services</span>
                  <span />
                </div>
                <div className="prod-list-block">
                  {staffSorted.map(m => (
                    <StaffRow key={m.id} member={m} services={services}
                      onEdit={() => setEditStaff(m)}
                      onDelete={() => deleteStaff(m.id)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ───────────────────────────  SETTINGS TAB  ─────────────────────────── */}
        {tab === 'settings' && (
          <>
            <h1 className="crm-page-title">Booking Settings</h1>
            <p className="auth-page-subtitle">
              Working hours and booking rules for this business.
            </p>

            <section className="bk-section">
              <div className="bk-section-head">
                <h2 className="bk-section-title">Stats</h2>
              </div>
              <StatsBlock projectId={projectId} />
            </section>

            <section className="bk-section">
              <div className="bk-section-head">
                <h2 className="bk-section-title">Working hours</h2>
              </div>
              <p className="auth-field-hint" style={{ marginBottom: 12 }}>
                Default hours of operation. Used for services without a specific staff member.
              </p>
              <HoursEditor projectId={projectId} showToast={showToast} onSaved={reload} />
            </section>

            <section className="bk-section">
              <div className="bk-section-head">
                <h2 className="bk-section-title">Booking rules</h2>
              </div>
              <RulesEditor projectId={projectId} showToast={showToast} onSaved={reload} />
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
          businessTz={businessTz}
          workingHours={hours}
          slotInterval={settings?.slot_interval_minutes || 30}
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
          slotInterval={settings?.slot_interval_minutes || 30}
          onClose={() => setEditStaff(null)}
          onSaved={() => { setEditStaff(null); reload(); showToast('Staff saved'); }}
        />
      )}

      {/* Toast */}
      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}

      {/* Bulk-actions toolbar — appears when ≥1 booking is selected. */}
      {inBulk && createPortal(
        <div className="bulk-bar" role="toolbar">
          <span className="bulk-bar-count">
            <span className="bulk-bar-dot" />
            {selected.size} booking{selected.size === 1 ? '' : 's'}
          </span>
          <div className="bulk-bar-divider" />
          <button type="button" className="bulk-bar-btn" onClick={() => bulkSetStatus('confirmed')}>Confirm</button>
          <button type="button" className="bulk-bar-btn" onClick={() => bulkSetStatus('completed')}>Completed</button>
          <button type="button" className="bulk-bar-btn" onClick={() => bulkSetStatus('cancelled')}>Cancel</button>
          <button type="button" className="bulk-bar-btn" onClick={() => bulkSetStatus('no_show')}>No-show</button>
          <div className="bulk-bar-divider" />
          <button type="button" className="bulk-bar-btn bulk-bar-btn--danger" onClick={bulkDelete}>Delete</button>
          <button type="button" className="bulk-bar-btn" onClick={clearSel}>Cancel</button>
        </div>,
        document.body
      )}
    </>
  );
}

export default Booking;
