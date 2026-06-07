import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { encodeId } from '../../../Utils/hashids.js';
import { useTabParam } from '../../../Utils/useTabParam.js';
import {
  CalendarBlank, GearSix, MagnifyingGlass, List, SquaresFour, CalendarCheck,
  Plus, CaretDown, ArrowDown, Trash, Pencil, Clock, User, Users, Briefcase, DotsThreeOutline, X,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { formatMoney } from '../../../Utils/currency.js';
import { InteractiveSection } from '../../../Utils/InteractiveSection.js';
import BookingServiceModal from './BookingServiceModal.jsx';
import BookingStaffModal   from './BookingStaffModal.jsx';
import BookingCreateModal, { TimePicker, Combobox } from './BookingCreateModal.jsx';
import BookingDetailModal  from './BookingDetailModal.jsx';
import BookingCalendar     from './BookingCalendar.jsx';
import '../../../Style/Organization.css';
import '../../../Style/Products.css';
import '../../../Style/Orders.css';
import '../../../Style/Authentication.css';
import '../../../Style/Booking.css';

// ── Constants ──────────────────────────────────────────────────

const ALL_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

// .ord-badge--bk-completed is a green variant defined in Booking.css —
// we don't reuse Orders' cyan .ord-badge--delivered because a completed
// booking is a different kind of "done" (it's a positive outcome, not a
// shipment status).
const STATUS_CLS = {
  pending:   'ord-badge--new',
  confirmed: 'ord-badge--confirmed',
  completed: 'ord-badge--bk-completed',
  cancelled: 'ord-badge--cancelled',
  no_show:   'ord-badge--refunded',
};

const statusLabel = (t, s) => STATUS_CLS[s] ? t(`booking.status.${s}`) : s;

// Period values for the staff-analytics combobox. Keys MUST match the
// _STAFF_ANALYTICS_PERIODS dict in CRM/backend/main.py (booking_staff_analytics).
const STAFF_PERIOD_VALUES = ['1d', '3d', '1w', '2w', '1mo', '2mo', 'season', 'halfyear', '1y', '2y'];

const SORT_FIELD_KEY = { date: 'sortByDate', customer: 'sortByCustomer' };
const DEFAULT_DIR = { date: 'desc', customer: 'asc' };

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// ── Tilt configs ───────────────────────────────────────────────

const ROW_TILT  = { maxAngleX: 10, maxAngleY: 4, lerp: 0.05, lerpOut: 0.07, scale: 1.052, perspective: 900, gloss: { opacity: 0.14, spread: 40 } };
const CARD_TILT = { maxAngle: 8, lerp: 0.05, lerpOut: 0.07, scale: 1.02, perspective: 800, gloss: { opacity: 0.12, spread: 50 } };
const ITEM_TILT = { maxAngleX: 6, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07, scale: 1.018, perspective: 900, gloss: { opacity: 0.10, spread: 40 } };

// ── Helpers ────────────────────────────────────────────────────

const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString([],   { hour: '2-digit', minute: '2-digit' }) : '';
const fmtDateLong = ts => ts ? new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
// Project-currency-aware money formatter — bound at component mount
// via the `__BOOKING_CURRENCY` module global below. Booking page sets
// it once when it reads project.currency, then every service-card /
// staff-row / KPI render reuses it without prop-drilling. Same
// pattern as `__ORDERS_TZ` in Orders.jsx — pragmatic and avoids
// threading currency through 8 component layers.
let __BOOKING_CURRENCY = 'USD';
const setBookingCurrency = (c) => { __BOOKING_CURRENCY = c || 'USD'; };
const fmtMoney = n => formatMoney(n, __BOOKING_CURRENCY);

// ─── Tab Switcher (mirror of Authentication) ──────────────────

function TabSwitcher({ tabs, tab, setTab }) {
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

  return (
    <div className="auth-tab-switcher" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="auth-tab-indicator" />
      {tabs.map(({ key, label, Icon }) => (
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
  const { t } = useTranslation();
  const cls = STATUS_CLS[status] ?? '';
  return <span className={`ord-badge ${cls}`}>{statusLabel(t, status)}</span>;
}

// ── Sort toggle (shared with Orders style) ────────────────────

function SortToggle({ sort, onSort, options, defaultDirs = DEFAULT_DIR }) {
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

const SVC_SORT_DIRS     = { name: 'asc', price: 'asc', duration: 'asc' };
const STAFF_SORT_DIRS   = { name: 'asc', date: 'desc' };

// ── Status filter pill bar ────────────────────────────────────

function StatusFilter({ active, counts, onChange }) {
  const { t } = useTranslation();
  const indRef  = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const cur = hovered ?? active;
  const tabs = [
    { key: 'all', label: t('booking.list.all') },
    ...ALL_STATUSES.map(s => ({ key: s, label: statusLabel(t, s) })),
  ];

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
      {tabs.map(({ key, label }) => (
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
  const { t } = useTranslation();
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
          : <span className="bk-no-staff">{t('booking.list.anyStaff')}</span>}
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
  const { t } = useTranslation();
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
        <Pencil className="org-card-dropdown-icon" /> {t('booking.services.edit')}
      </button>
      <div className="org-card-dropdown-sep" />
      <button className="org-card-dropdown-item org-card-dropdown-item--danger" onClick={onDelete}>
        <Trash className="org-card-dropdown-icon" /> {t('booking.services.delete')}
      </button>
    </div>,
    document.body
  );
}

function ServiceRow({ service, staff, onEdit, onDelete }) {
  const { t } = useTranslation();
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
    ? t('booking.services.oneToOne')
    : service.capacity > 1 ? t('booking.services.seats', { n: service.capacity }) : '—';
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
      <span className="prow-cell">{t('booking.services.minutes', { n: service.duration_minutes })}</span>
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
  const { t } = useTranslation();
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
  if (!service.is_active)                 badge = t('booking.services.hidden');
  else if (service.requires_staff)        badge = t('booking.services.oneToOne');
  else if (service.capacity > 1)          badge = t('booking.services.seats', { n: service.capacity });

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
            <span className="pcard-price">{t('booking.services.minutes', { n: service.duration_minutes })}</span>
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
function StaffRow({ member, services, analytics, onEdit, onDelete }) {
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
      <span className="prow-cell bk-stf-row-num">
        {fmtMoney(analytics?.cassa_earned ?? 0)}
        {member.commission_pct > 0 && (
          <span className="bk-stf-metric-commission"> · {member.commission_pct}%</span>
        )}
      </span>
      <span className="prow-cell bk-stf-row-num">{analytics?.bookings_count ?? 0}</span>
      <span className="prow-cell bk-stf-row-num">{(analytics?.hours_worked ?? 0).toFixed(1)}</span>
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
function StaffCard({ member, services, analytics, onEdit, onDelete }) {
  const { t } = useTranslation();
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

  const badge = !member.is_active ? t('booking.staff.hidden')
              : linked.length > 0 ? t('booking.staff.servicesCount', { count: linked.length })
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
          {/* 4-tile analytics grid — quiet numbers, no payroll math. The
              commission % from the staff modal is shown alongside Cassa so
              the owner can compute the payout in their head if they want. */}
          <div className="bk-stf-metrics">
            <div className="bk-stf-metric">
              <span className="bk-stf-metric-label">{t('booking.staff.cassa')}
                {member.commission_pct > 0 && (
                  <span className="bk-stf-metric-commission"> · {member.commission_pct}%</span>
                )}
              </span>
              <span className="bk-stf-metric-value">
                {fmtMoney(analytics?.cassa_earned ?? 0)}
              </span>
            </div>
            <div className="bk-stf-metric">
              <span className="bk-stf-metric-label">{t('booking.staff.bookings')}</span>
              <span className="bk-stf-metric-value">{analytics?.bookings_count ?? 0}</span>
            </div>
            <div className="bk-stf-metric">
              <span className="bk-stf-metric-label">{t('booking.staff.hours')}</span>
              <span className="bk-stf-metric-value">{(analytics?.hours_worked ?? 0).toFixed(1)}</span>
            </div>
            <div className="bk-stf-metric">
              <span className="bk-stf-metric-label">{t('booking.staff.avgTicket')}</span>
              <span className="bk-stf-metric-value">{fmtMoney(analytics?.avg_ticket ?? 0)}</span>
            </div>
          </div>
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
  const { t } = useTranslation();
  const pq = `?project_id=${projectId}`;
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/booking/stats${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null).then(setStats);
  }, [projectId]);

  if (!stats) return <p className="crm-placeholder">{t('booking.settings.loading')}</p>;
  const wow = stats.last_week_count
    ? Math.round(((stats.week_count - stats.last_week_count) / stats.last_week_count) * 100)
    : null;

  return (
    <div className="bk-stats-grid">
      <StatCard label={t('booking.settings.stats.total')} value={stats.total} />
      <StatCard label={t('booking.settings.stats.thisWeek')} value={stats.week_count}
        delta={wow != null ? t('booking.settings.stats.vsLastWeek', { pct: `${wow >= 0 ? '+' : ''}${wow}` }) : ''} />
      <StatCard label={t('booking.settings.stats.avgTicket')} value={fmtMoney(stats.avg_ticket)} />
      <StatCard label={t('booking.settings.stats.noShowRate')} value={`${stats.no_show_rate}%`}
        tone={stats.no_show_rate > 15 ? 'warn' : 'ok'} />
      {stats.top_staff.length > 0 && (
        <div className="bk-stats-card bk-stats-card--wide">
          <span className="bk-stats-label">{t('booking.settings.stats.topStaff')}</span>
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
// Design mirrors the New-promo-code modal: cat-prod-checkbox + cat-prod-row
// for each day, custom TimePicker (from BookingCreateModal) instead of the
// browser's native <input type=time>, and silent auto-save 600ms after the
// last edit — no Save button.

function HoursEditor({ projectId, showToast, onSaved }) {
  const { t } = useTranslation();
  const pq = `?project_id=${projectId}`;
  const [rows, setRows] = useState(() => DAY_KEYS.map((_, i) =>
    ({ day_of_week: i, open_time: '10:00', close_time: '19:00', enabled: false })
  ));
  // `hydrated` flips to true after the first GET completes. Without it, the
  // auto-save effect would fire on initial render and clobber server state
  // with the placeholder defaults.
  const [hydrated, setHydrated] = useState(false);
  const skipNextSave = useRef(false);
  // Callbacks bag stays in a ref so changes to its identity (which happen on
  // every parent re-render — onSaved is `reload`, a fresh closure each time)
  // don't re-trigger the auto-save effect. Without this we ended up in an
  // infinite loop: save → reload → parent re-renders → onSaved identity
  // changes → effect re-runs → new save → … See save-effect deps below.
  const cbRef = useRef({ showToast, onSaved });
  cbRef.current = { showToast, onSaved };

  useEffect(() => {
    fetch(`${API_BASE}/api/booking/hours${pq}`, { credentials: 'include' })
      .then(r => r.json()).then(data => {
        const next = DAY_KEYS.map((_, i) => {
          const found = (data || []).find(d => d.day_of_week === i);
          return found
            ? { day_of_week: i, open_time: found.open_time.slice(0, 5),
                close_time: found.close_time.slice(0, 5), enabled: true }
            : { day_of_week: i, open_time: '10:00', close_time: '19:00', enabled: false };
        });
        skipNextSave.current = true;   // first state-set after fetch isn't a user edit
        setRows(next);
        setHydrated(true);
      });
  }, [projectId]);

  const updateRow = (i, k, v) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  // Debounced auto-save. Fires 600ms after rows stop changing. Dependencies
  // are restricted to (rows, hydrated, pq) — the side-effect callbacks live
  // in cbRef so their identity changes don't trigger this effect.
  useEffect(() => {
    if (!hydrated) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    const timer = setTimeout(async () => {
      try {
        const body = {
          staff_id: null,
          rows: rows.filter(r => r.enabled).map(r => ({
            day_of_week: r.day_of_week,
            open_time:   r.open_time,
            close_time:  r.close_time,
          })),
        };
        const res = await fetch(`${API_BASE}/api/booking/hours${pq}`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          cbRef.current.showToast?.(t('booking.settings.toast.hoursUpdated'));
          cbRef.current.onSaved?.();
        }
      } catch { /* silent — next edit will retry */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [rows, hydrated, pq]);

  return (
    <div className="bk-hours-block">
      {rows.map((r, i) => (
        <div key={i}
          className={`cat-prod-row bk-hours-row${r.enabled ? ' cat-prod-row--checked' : ''}`}>
          <input type="checkbox" className="cat-prod-checkbox"
            checked={r.enabled}
            onChange={e => updateRow(i, 'enabled', e.target.checked)} />
          <span className="bk-hours-day-name">{t(`booking.days.${DAY_KEYS[i]}`)}</span>
          <div className="bk-hours-time-wrap" data-disabled={r.enabled ? undefined : 'true'}>
            <TimePicker value={r.open_time || '10:00'}
              onChange={v => updateRow(i, 'open_time', v)}
              slotInterval={15} />
          </div>
          <span className="bk-hours-dash">–</span>
          <div className="bk-hours-time-wrap" data-disabled={r.enabled ? undefined : 'true'}>
            <TimePicker value={r.close_time || '19:00'}
              onChange={v => updateRow(i, 'close_time', v)}
              slotInterval={15} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Booking Rules ────────────────────────────────────────────

function RulesEditor({ projectId, showToast, onSaved }) {
  const { t } = useTranslation();
  const pq = `?project_id=${projectId}`;
  const [form, setForm] = useState(null);
  // `hydrated` mirrors HoursEditor — first state set from the GET response
  // should NOT trigger auto-save, otherwise we'd PUT back what we just GOT.
  const [hydrated, setHydrated] = useState(false);
  const skipNextSave = useRef(false);
  // Stable ref to the latest callbacks — see HoursEditor for the same pattern.
  // Without this, every parent re-render gave us new onSaved identity which
  // re-fired the save effect → infinite loop.
  const cbRef = useRef({ showToast, onSaved });
  cbRef.current = { showToast, onSaved };
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  // Curated list of major IANA timezones sorted east-to-west. We deliberately
  // DO NOT show the browser's full supportedValuesOf('timeZone') (~440 entries)
  // because scrolling through that without search is hostile UX. Common ones
  // cover ~99% of small-business needs; any merchant in a niche zone can ask
  // support to add it. Offsets are computed at render time so DST shifts the
  // label automatically (e.g. London is UTC+00:00 in winter, UTC+01:00 in summer).
  const tzOptions = useMemo(() => {
    const NAMES = [
      'UTC',
      // Pacific
      'Pacific/Honolulu', 'Pacific/Auckland', 'Pacific/Fiji',
      // Americas
      'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
      'America/Chicago', 'America/New_York', 'America/Toronto',
      'America/Halifax', 'America/Mexico_City', 'America/Sao_Paulo',
      'America/Argentina/Buenos_Aires',
      // Europe + UK
      'Atlantic/Reykjavik', 'Europe/London', 'Europe/Lisbon',
      'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
      'Europe/Amsterdam', 'Europe/Warsaw', 'Europe/Athens',
      'Europe/Helsinki', 'Europe/Bucharest', 'Europe/Istanbul',
      'Europe/Kiev', 'Europe/Moscow',
      // Middle East / Caucasus
      'Asia/Jerusalem', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Tehran',
      'Asia/Yerevan', 'Asia/Tbilisi', 'Asia/Baku',
      // Central Asia (Kazakhstan + neighbours — main user region)
      'Asia/Karachi', 'Asia/Tashkent', 'Asia/Yekaterinburg',
      'Asia/Aqtobe', 'Asia/Aqtau', 'Asia/Atyrau', 'Asia/Oral',
      'Asia/Bishkek', 'Asia/Almaty', 'Asia/Qyzylorda',
      // South + South-East Asia
      'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dhaka',
      'Asia/Bangkok', 'Asia/Singapore',
      // East Asia
      'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Manila',
      'Asia/Seoul', 'Asia/Tokyo',
      // Australia
      'Australia/Perth', 'Australia/Adelaide', 'Australia/Sydney',
      // Africa
      'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg',
    ];
    // Splice in the merchant's currently-saved tz if it's not in the curated
    // set — so a niche IANA name they typed before never silently disappears
    // from the dropdown.
    const saved = (form?.timezone || '').trim();
    if (saved && !NAMES.includes(saved)) NAMES.push(saved);
    // Also splice in the browser tz so the user can pick "my local zone" with one click.
    if (browserTz && !NAMES.includes(browserTz)) NAMES.push(browserTz);

    const opts = NAMES.map(name => {
      let offsetMin = 0;
      try {
        const fmt = new Intl.DateTimeFormat('en', { timeZone: name, timeZoneName: 'shortOffset' });
        const tag = fmt.formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || '';
        // tag is "GMT", "GMT+5", "GMT-08:00", "GMT+05:30", etc.
        if (tag !== 'GMT') {
          const m = tag.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
          if (m) {
            const sign = m[1] === '+' ? 1 : -1;
            offsetMin = sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
          }
        }
      } catch { /* fall through with offsetMin=0 */ }
      const sign = offsetMin >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMin);
      const offLabel = name === 'UTC'
        ? 'UTC'
        : `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
      // Pretty city name: last segment with underscores → spaces.
      // "America/Argentina/Buenos_Aires" → "Buenos Aires".
      const city = name.split('/').pop().replace(/_/g, ' ');
      const suffix = name === browserTz ? t('booking.settings.rules.yourLocal') : '';
      return {
        value: name,
        label: name === 'UTC' ? 'UTC' : `${offLabel} · ${city}${suffix}`,
        _offset: offsetMin,
      };
    });
    // Sort by offset (west-to-east), keeping UTC at offset 0 right where it belongs.
    return opts.sort((a, b) => a._offset - b._offset || a.label.localeCompare(b.label));
  }, [form?.timezone, browserTz]);

  useEffect(() => {
    fetch(`${API_BASE}/api/booking/settings${pq}`, { credentials: 'include' })
      .then(r => r.json())
      .then(async d => {
        if (!d) { setForm(d); setHydrated(true); return; }
        // Auto-default to browser TZ when project was created without explicit setting
        // (backend default is 'UTC' which trips up merchants outside that zone).
        // We also AUTO-SAVE this one-time correction so the merchant doesn't have to
        // remember to click Save — the slot filtering on the storefront depends on it.
        const stuckOnUtc = (!d.timezone || d.timezone === 'UTC');
        const browserIsElsewhere = browserTz && browserTz !== 'UTC';
        if (stuckOnUtc && browserIsElsewhere) {
          d.timezone = browserTz;
          // Persist silently — this is a correction, not a user edit
          try {
            const { configured, ...payload } = d;
            await fetch(`${API_BASE}/api/booking/settings${pq}`, {
              method: 'PUT', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            showToast?.(t('booking.settings.toast.timezoneSet', { tz: browserTz }));
            onSaved?.();
          } catch { /* will save next time merchant edits */ }
        }
        skipNextSave.current = true;   // initial setForm isn't a user edit
        setForm(d);
        setHydrated(true);
      });
  }, [projectId]);

  // Debounced auto-save 600ms after form changes — same pattern as HoursEditor.
  // Deps deliberately exclude showToast/onSaved — they live in cbRef.
  useEffect(() => {
    if (!hydrated || !form) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    const timer = setTimeout(async () => {
      try {
        const { configured, ...payload } = form;
        const res = await fetch(`${API_BASE}/api/booking/settings${pq}`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          cbRef.current.showToast?.(t('booking.settings.toast.rulesUpdated'));
          cbRef.current.onSaved?.();
        }
      } catch { /* silent — next edit will retry */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [form, hydrated, pq]);

  if (!form) return <p className="crm-placeholder">{t('booking.settings.loading')}</p>;

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="bk-rules-grid">
      <div className="auth-field">
        <label className="auth-label">{t('booking.settings.rules.slotInterval')}</label>
        <p className="auth-field-hint">{t('booking.settings.rules.slotIntervalHint')}</p>
        <input className="crm-input" type="number" min={5} max={240}
          value={form.slot_interval_minutes}
          onChange={e => upd('slot_interval_minutes', parseInt(e.target.value, 10) || 15)} />
      </div>
      <div className="auth-field">
        <label className="auth-label">{t('booking.settings.rules.minAdvance')}</label>
        <p className="auth-field-hint">{t('booking.settings.rules.minAdvanceHint')}</p>
        <input className="crm-input" type="number" min={0}
          value={form.min_advance_minutes}
          onChange={e => upd('min_advance_minutes', parseInt(e.target.value, 10) || 0)} />
      </div>
      <div className="auth-field">
        <label className="auth-label">{t('booking.settings.rules.maxAdvance')}</label>
        <p className="auth-field-hint">{t('booking.settings.rules.maxAdvanceHint')}</p>
        <input className="crm-input" type="number" min={1} max={365}
          value={form.max_advance_days}
          onChange={e => upd('max_advance_days', parseInt(e.target.value, 10) || 1)} />
      </div>
      <div className="auth-field">
        <label className="auth-label">{t('booking.settings.rules.cancellationWindow')}</label>
        <p className="auth-field-hint">{t('booking.settings.rules.cancellationWindowHint')}</p>
        <input className="crm-input" type="number" min={0}
          value={form.cancellation_window_minutes}
          onChange={e => upd('cancellation_window_minutes', parseInt(e.target.value, 10) || 0)} />
      </div>

      <div className="auth-field" style={{ gridColumn: '1 / -1' }}>
        <label className="auth-label">{t('booking.settings.rules.timezone')}</label>
        <p className="auth-field-hint">
          {t('booking.settings.rules.timezoneHint')}
        </p>
        <Combobox value={form.timezone || browserTz}
          options={tzOptions}
          placeholder={t('booking.settings.rules.timezonePlaceholder')}
          onChange={v => upd('timezone', v)} />
      </div>

      <div className="auth-toggle-row" style={{ gridColumn: '1 / -1' }}>
        <div>
          <span className="auth-toggle-label">{t('booking.settings.rules.autoConfirm')}</span>
          <p className="auth-field-hint">{t('booking.settings.rules.autoConfirmHintPre')}<code>pending</code>{t('booking.settings.rules.autoConfirmHintPost')}</p>
        </div>
        <label className="auth-toggle">
          <input type="checkbox" checked={form.auto_confirm}
            onChange={e => upd('auto_confirm', e.target.checked)} />
          <span className="auth-toggle-track" />
        </label>
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════

function Booking() {
  const { t } = useTranslation();
  const { projectId, project, access } = useOutletContext();
  const canView = (p) => !access || access.is_owner || ['view', 'manage'].includes(access.permissions?.[p]);
  const bookingTabs = [
    canView('booking')          && { key: 'bookings', label: t('booking.tabs.bookings'), Icon: CalendarBlank },
    canView('booking_services') && { key: 'services', label: t('booking.tabs.services'), Icon: Briefcase },
    canView('booking_staff')    && { key: 'staff',    label: t('booking.tabs.staff'),    Icon: Users },
    canView('booking_settings') && { key: 'settings', label: t('booking.tabs.settings'), Icon: GearSix },
  ].filter(Boolean);
  const sortOptions      = [{ field: 'date', label: t('booking.list.sortByDate') }, { field: 'customer', label: t('booking.list.sortByCustomer') }];
  const svcSortOptions   = [{ field: 'name', label: t('booking.services.sortByName') }, { field: 'price', label: t('booking.services.sortByPrice') }, { field: 'duration', label: t('booking.services.sortByDuration') }];
  const staffSortOptions = [{ field: 'name', label: t('booking.staff.sortByName') }, { field: 'date', label: t('booking.staff.sortByDate') }];
  const staffPeriodOptions = STAFF_PERIOD_VALUES.map(v => ({ value: v, label: t(`booking.staff.period.${v}`) }));
  // Sync the module-level currency so fmtMoney() inside Service/Staff
  // sub-components reuses the project's choice without prop drilling.
  // Layout effect → fires before paint so the first render already uses
  // the correct symbol.
  useEffect(() => { setBookingCurrency(project?.currency || 'USD'); }, [project?.currency]);
  const navigate = useNavigate();
  // Edit click on a service: linked products jump to /product/{hash}; legacy ones (no product_id) keep the modal.
  const onEditService = (s) => {
    if (s.product_id) navigate(`/product/${encodeId(s.product_id)}`);
    else setEditService(s);
  };
  const pq = `?project_id=${projectId}`;

  const [tab,       setTab]       = useTabParam(bookingTabs[0]?.key || 'bookings');
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
  // Analytics period (combobox) + the per-staff analytics rows fetched for it.
  const [stfPeriod, setStfPeriod] = useState('1mo');
  const [stfAnalytics, setStfAnalytics] = useState({});   // { [staffId]: { cassa_earned, bookings_count, hours_worked, avg_ticket } }

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
    if (!confirm(t('booking.bulk.setStatusConfirm', { count: selected.size, status: statusLabel(t, status) }))) return;
    const n = selected.size;
    await Promise.all(Array.from(selected).map(id =>
      fetch(`${API_BASE}/api/booking/bookings/${id}${pq}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    ));
    setBookings(prev => prev.map(b => selected.has(b.id) ? { ...b, status } : b));
    clearSel();
    showToast(t('booking.toast.bookingsUpdated', { count: n }));
  };

  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!confirm(t('booking.bulk.deleteConfirm', { count: selected.size }))) return;
    const n = selected.size;
    await Promise.all(Array.from(selected).map(id =>
      fetch(`${API_BASE}/api/booking/bookings/${id}${pq}`, { method: 'DELETE', credentials: 'include' })
    ));
    setBookings(prev => prev.filter(b => !selected.has(b.id)));
    clearSel();
    showToast(t('booking.toast.bookingsDeleted', { count: n }));
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
      if (bRes.ok) {
        const list = await bRes.json();
        setBookings(list);
        // Auto-flip stale bookings: anything whose end-time has fully passed
        // and is still pending/confirmed gets marked no-show. Fires only
        // for bookings that need it (so reload() stays cheap when up-to-date),
        // and PATCHes them silently — the next reload() picks the new status.
        // Without this the calendar grid showed past slots as "Confirmed",
        // which is misleading since the appointment time is gone.
        const now = Date.now();
        const stale = (list || []).filter(b => {
          if (b.status !== 'pending' && b.status !== 'confirmed') return false;
          const end = b.ends_at ? new Date(b.ends_at).getTime() : null;
          return end != null && end < now;
        });
        if (stale.length > 0) {
          await Promise.allSettled(stale.map(b =>
            fetch(`${API_BASE}/api/booking/bookings/${b.id}${pq}`, {
              method: 'PATCH', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'no_show' }),
            })
          ));
          // Reflect locally without a second GET round-trip.
          setBookings(prev => prev.map(b =>
            stale.find(s => s.id === b.id) ? { ...b, status: 'no_show' } : b
          ));
        }
      }
      if (sRes.ok)   setServices(await sRes.json());
      if (stRes.ok)  setStaff(await stRes.json());
      if (hRes.ok)   setHours(await hRes.json());
      if (setRes.ok) {
        const s = await setRes.json();
        setSettings(s);
        // Auto-correct existing UTC-stuck projects to the merchant's browser TZ.
        // Without this, the customer-facing slot times stay anchored to UTC and look
        // like "16:30 UTC · your local 21:30" — visually confusing for everyone outside UTC.
        // Runs once per page mount (per merchant visit), silently persists.
        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        if (s && (!s.timezone || s.timezone === 'UTC') && browserTz && browserTz !== 'UTC') {
          const { configured, ...payload } = s;
          payload.timezone = browserTz;
          try {
            const r = await fetch(`${API_BASE}/api/booking/settings${pq}`, {
              method: 'PUT', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (r.ok) {
              setSettings({ ...s, timezone: browserTz });
              showToast?.(t('booking.settings.toast.timezoneSet', { tz: browserTz }));
            }
          } catch { /* will retry next time */ }
        }
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  // Fetch per-staff analytics for the chosen period. Re-runs whenever the
  // staff list changes (e.g. user adds someone) or the period switches.
  useEffect(() => {
    if (!staff.length) { setStfAnalytics({}); return; }
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(staff.map(m =>
        fetch(`${API_BASE}/api/booking/staff/${m.id}/analytics${pq}&period=${stfPeriod}`,
          { credentials: 'include' })
          .then(r => r.ok ? r.json() : null)
      ));
      if (cancelled) return;
      const next = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) next[staff[i].id] = r.value;
      });
      setStfAnalytics(next);
    })();
    return () => { cancelled = true; };
  }, [staff, stfPeriod, projectId]);   // eslint-disable-line

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
    if (!confirm(t('booking.services.deleteConfirm'))) return;
    await fetch(`${API_BASE}/api/booking/services/${id}${pq}`, { method: 'DELETE', credentials: 'include' });
    reload();
  };
  const deleteStaff = async (id) => {
    if (!confirm(t('booking.staff.deleteConfirm'))) return;
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
    if (!confirm(t('booking.detail.deleteConfirm'))) return;
    await fetch(`${API_BASE}/api/booking/bookings/${id}${pq}`, { method: 'DELETE', credentials: 'include' });
    setBookings(prev => prev.filter(b => b.id !== id));
    setOpenBooking(null);
  };

  const isEmpty = !loading && sorted.length === 0;
  const emptyMsg = statusTab === 'all' && !search ? t('booking.list.emptyAll') : t('booking.list.emptyFiltered');

  return (
    <>
      {/* ── Sticky tab switcher ── */}
      <div className="auth-tab-wrapper">
        {bookingTabs.length > 1 && <TabSwitcher tabs={bookingTabs} tab={tab} setTab={setTab} />}
      </div>

      <div className="prod-page bk-page">

        {/* ───────────────────────────  BOOKINGS TAB  ─────────────────────────── */}
        {tab === 'bookings' && (
          <>
            <h1 className="crm-page-title">{t('booking.list.title')}</h1>

            {/* Single flat toolbar (matches Products / Orders pattern) */}
            <div className="org-toolbar bk-toolbar">
              <div className="org-search-wrap">
                <MagnifyingGlass className="org-search-icon" />
                <input className="org-search-input" placeholder={t('booking.list.searchPlaceholder')}
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>

              <SortToggle sort={sort} onSort={setSort} options={sortOptions} />
              <StatusFilter active={statusTab} counts={counts} onChange={setStatusTab} />

              <div className="org-view-toggle bk-view-toggle" onMouseLeave={() => setViewHover(null)}>
                <div className="org-view-indicator bk-view-ind"
                  style={{ transform: `translateX(${curView === 'list' ? 0 : curView === 'cards' ? 30 : 60}px)` }} />
                <button className={`org-view-btn${curView === 'list' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setView('list')} onMouseEnter={() => setViewHover('list')}
                  title={t('booking.list.listView')} type="button">
                  <List className="org-view-icon" />
                </button>
                <button className={`org-view-btn${curView === 'cards' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setView('cards')} onMouseEnter={() => setViewHover('cards')}
                  title={t('booking.list.cardsView')} type="button">
                  <SquaresFour className="org-view-icon" />
                </button>
                <button className={`org-view-btn${curView === 'calendar' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setView('calendar')} onMouseEnter={() => setViewHover('calendar')}
                  title={t('booking.list.calendarView')} type="button">
                  <CalendarCheck className="org-view-icon" />
                </button>
              </div>

              <button className="org-new-btn" type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="org-new-icon" /> {t('booking.list.newBooking')}
              </button>
            </div>

            {/* List view */}
            {view === 'list' && (
              <div className="prod-list">
                <div className="bk-list-head">
                  <span className="org-list-th">{t('booking.list.colCustomer')}</span>
                  <span className="org-list-th">{t('booking.list.colService')}</span>
                  <span className="org-list-th">{t('booking.list.colStaff')}</span>
                  <span className="org-list-th">{t('booking.list.colWhen')}</span>
                  <span className="org-list-th">{t('booking.list.colStatus')}</span>
                </div>
                {loading ? (
                  <p className="crm-placeholder">{t('booking.list.loading')}</p>
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
                <p className="crm-placeholder">{t('booking.list.loading')}</p>
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
                services={services}
                currency={project?.currency || 'USD'}
                onOpenBooking={setOpenBooking}
                onCreateAt={(iso) => setCreateOpen({ presetStart: iso })}
                onMoveBooking={async (id, iso) => {
                  const res = await fetch(`${API_BASE}/api/booking/bookings/${id}/move${pq}&starts_at=${encodeURIComponent(iso)}`,
                    { method: 'PUT', credentials: 'include' });
                  if (res.ok) { reload(); showToast(t('booking.toast.bookingMoved')); }
                  else showToast(t('booking.toast.moveFailed'));
                }}
                onStatusChange={updateBookingStatus}
              />
            )}
          </>
        )}

        {/* ───────────────────────────  SERVICES TAB  ─────────────────────────── */}
        {tab === 'services' && (
          <>
            <h1 className="crm-page-title">{t('booking.services.title')}</h1>
            <div className="org-toolbar bk-toolbar">
              <div className="org-search-wrap">
                <MagnifyingGlass className="org-search-icon" />
                <input className="org-search-input" placeholder={t('booking.services.searchPlaceholder')}
                  value={svcSearch} onChange={e => setSvcSearch(e.target.value)} />
              </div>
              <SortToggle sort={svcSort} onSort={setSvcSort}
                options={svcSortOptions} defaultDirs={SVC_SORT_DIRS} />
              <div className="org-view-toggle" onMouseLeave={() => setSvcViewHover(null)}>
                <div className="org-view-indicator"
                  style={{ transform: `translateX(${curSvcView === 'cards' ? 30 : 0}px)` }} />
                <button className={`org-view-btn${curSvcView === 'list' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setSvcView('list')} onMouseEnter={() => setSvcViewHover('list')}
                  title={t('booking.services.listView')} type="button">
                  <List className="org-view-icon" />
                </button>
                <button className={`org-view-btn${curSvcView === 'cards' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setSvcView('cards')} onMouseEnter={() => setSvcViewHover('cards')}
                  title={t('booking.services.cardsView')} type="button">
                  <SquaresFour className="org-view-icon" />
                </button>
              </div>
              <button className="org-new-btn" type="button" onClick={() => setEditService({})}>
                <Plus className="org-new-icon" /> {t('booking.services.newService')}
              </button>
            </div>
            {loading ? (
              <p className="crm-placeholder">{t('booking.services.loading')}</p>
            ) : servicesSorted.length === 0 ? (
              <div className="bk-empty-block">
                {services.length === 0
                  ? t('booking.services.empty')
                  : t('booking.services.emptySearch')}
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
                  <span /><span className="org-list-th">{t('booking.services.colTitle')}</span>
                  <span className="org-list-th">{t('booking.services.colDuration')}</span>
                  <span className="org-list-th">{t('booking.services.colPrice')}</span>
                  <span className="org-list-th">{t('booking.services.colCapacity')}</span>
                  <span className="org-list-th">{t('booking.services.colStaff')}</span>
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
            <h1 className="crm-page-title">{t('booking.staff.title')}</h1>
            <div className="org-toolbar bk-toolbar">
              <div className="org-search-wrap">
                <MagnifyingGlass className="org-search-icon" />
                <input className="org-search-input" placeholder={t('booking.staff.searchPlaceholder')}
                  value={stfSearch} onChange={e => setStfSearch(e.target.value)} />
              </div>
              <SortToggle sort={stfSort} onSort={setStfSort}
                options={staffSortOptions} defaultDirs={STAFF_SORT_DIRS} />
              <div className="org-view-toggle" onMouseLeave={() => setStfViewHover(null)}>
                <div className="org-view-indicator"
                  style={{ transform: `translateX(${curStfView === 'cards' ? 30 : 0}px)` }} />
                <button className={`org-view-btn${curStfView === 'list' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setStfView('list')} onMouseEnter={() => setStfViewHover('list')}
                  title={t('booking.staff.listView')} type="button">
                  <List className="org-view-icon" />
                </button>
                <button className={`org-view-btn${curStfView === 'cards' ? ' org-view-btn--current' : ''}`}
                  onClick={() => setStfView('cards')} onMouseEnter={() => setStfViewHover('cards')}
                  title={t('booking.staff.cardsView')} type="button">
                  <SquaresFour className="org-view-icon" />
                </button>
              </div>
              <button className="org-new-btn" type="button" onClick={() => setEditStaff({})}>
                <Plus className="org-new-icon" /> {t('booking.staff.newStaff')}
              </button>
            </div>
            {/* Analytics period picker — drives the 4 metrics on each card/row.
                Combobox is the same widget used everywhere else (timezone, status,
                etc.) so the UI stays consistent. */}
            <div className="bk-stf-analytics-bar">
              <span className="bk-stf-analytics-label">{t('booking.staff.analyticsPeriod')}</span>
              <div className="bk-stf-analytics-cb">
                <Combobox value={stfPeriod} options={staffPeriodOptions}
                  onChange={setStfPeriod} />
              </div>
            </div>
            {loading ? (
              <p className="crm-placeholder">{t('booking.staff.loading')}</p>
            ) : staffSorted.length === 0 ? (
              <div className="bk-empty-block">
                {staff.length === 0
                  ? t('booking.staff.empty')
                  : t('booking.staff.emptySearch')}
              </div>
            ) : stfView === 'cards' ? (
              <div className="prod-grid">
                {staffSorted.map(m => (
                  <StaffCard key={m.id} member={m} services={services}
                    analytics={stfAnalytics[m.id]}
                    onEdit={() => setEditStaff(m)}
                    onDelete={() => deleteStaff(m.id)} />
                ))}
              </div>
            ) : (
              <div className="prod-list">
                <div className="prod-list-head bk-stf-list-head">
                  <span /><span className="org-list-th">{t('booking.staff.colName')}</span>
                  <span className="org-list-th">{t('booking.staff.colBio')}</span>
                  <span className="org-list-th">{t('booking.staff.colServices')}</span>
                  <span className="org-list-th">{t('booking.staff.colCassa')}</span>
                  <span className="org-list-th">{t('booking.staff.colBookings')}</span>
                  <span className="org-list-th">{t('booking.staff.colHours')}</span>
                  <span />
                </div>
                <div className="prod-list-block">
                  {staffSorted.map(m => (
                    <StaffRow key={m.id} member={m} services={services}
                      analytics={stfAnalytics[m.id]}
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
            <h1 className="crm-page-title">{t('booking.settings.title')}</h1>
            <p className="auth-page-subtitle">
              {t('booking.settings.subtitle')}
            </p>

            <section className="bk-section">
              <div className="bk-section-head">
                <h2 className="bk-section-title">{t('booking.settings.statsHeading')}</h2>
              </div>
              <StatsBlock projectId={projectId} />
            </section>

            <section className="bk-section">
              <div className="bk-section-head">
                <h2 className="bk-section-title">{t('booking.settings.workingHoursHeading')}</h2>
              </div>
              <p className="auth-field-hint" style={{ marginBottom: 12 }}>
                {t('booking.settings.workingHoursHint')}
              </p>
              <HoursEditor projectId={projectId} showToast={showToast} onSaved={reload} />
            </section>

            <section className="bk-section">
              <div className="bk-section-head">
                <h2 className="bk-section-title">{t('booking.settings.bookingRulesHeading')}</h2>
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
          currency={project?.currency || 'USD'}
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
          onCreated={() => { setCreateOpen(false); reload(); showToast(t('booking.toast.bookingCreated')); }}
        />
      )}

      {editService !== null && (
        <BookingServiceModal
          projectId={projectId}
          service={editService.id ? editService : null}
          allStaff={staff}
          onClose={() => setEditService(null)}
          onSaved={() => { setEditService(null); reload(); showToast(t('booking.toast.serviceSaved')); }}
        />
      )}

      {editStaff !== null && (
        <BookingStaffModal
          projectId={projectId}
          member={editStaff.id ? editStaff : null}
          allServices={services}
          slotInterval={settings?.slot_interval_minutes || 30}
          onClose={() => setEditStaff(null)}
          onSaved={() => { setEditStaff(null); reload(); showToast(t('booking.toast.staffSaved')); }}
        />
      )}

      {/* Toast */}
      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}

      {/* Bulk-actions toolbar — appears when ≥1 booking is selected. */}
      {inBulk && createPortal(
        <div className="bulk-bar" role="toolbar">
          <span className="bulk-bar-count">
            <span className="bulk-bar-dot" />
            {t('booking.bulk.count', { count: selected.size })}
          </span>
          <div className="bulk-bar-divider" />
          <button type="button" className="bulk-bar-btn" onClick={() => bulkSetStatus('confirmed')}>{t('booking.bulk.confirm')}</button>
          <button type="button" className="bulk-bar-btn" onClick={() => bulkSetStatus('completed')}>{t('booking.bulk.completed')}</button>
          <button type="button" className="bulk-bar-btn" onClick={() => bulkSetStatus('cancelled')}>{t('booking.bulk.cancel')}</button>
          <button type="button" className="bulk-bar-btn" onClick={() => bulkSetStatus('no_show')}>{t('booking.bulk.noShow')}</button>
          <div className="bulk-bar-divider" />
          <button type="button" className="bulk-bar-btn bulk-bar-btn--danger" onClick={bulkDelete}>{t('booking.bulk.delete')}</button>
          <button type="button" className="bulk-bar-btn" onClick={clearSel}>{t('booking.bulk.cancel')}</button>
        </div>,
        document.body
      )}
    </>
  );
}

export default Booking;
