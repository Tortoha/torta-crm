import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { CaretDown, Package, MagnifyingGlass, List, SquaresFour, ArrowDown,
         Receipt, ArrowUUpLeft, Printer } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { formatMoney } from '../../Utils/currency.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import { useInfiniteList } from '../../Utils/useInfiniteList.js';
import { useInfiniteScroll } from '../../Utils/useInfiniteScroll.js';
import PrintShippingLabelModal from './Products/PrintShippingLabelModal.jsx';
import Modal from '../../Elements/Modal.jsx';
import Returns from './Returns.jsx';
import '../../Style/Organization.css';
import '../../Style/Products.css';
import '../../Style/Orders.css';
import '../../Style/Authentication.css';

// ── Constants ──────────────────────────────────────────────────

const ALL_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded'];

const STATUS_META = {
  new:       { label: 'New',       cls: 'ord-badge--new'       },
  confirmed: { label: 'Confirmed', cls: 'ord-badge--confirmed'  },
  shipped:   { label: 'Shipped',   cls: 'ord-badge--shipped'    },
  delivered: { label: 'Delivered', cls: 'ord-badge--delivered'  },
  cancelled: { label: 'Cancelled', cls: 'ord-badge--cancelled'  },
  refunded:  { label: 'Refunded',  cls: 'ord-badge--refunded'   },
};

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  ...ALL_STATUSES.map(s => ({ key: s, label: STATUS_META[s].label })),
];

const SORT_OPTIONS = [
  { field: 'date',   label: 'Sort by date'   },
  { field: 'amount', label: 'Sort by amount' },
  { field: 'name',   label: 'Sort by name'   },
];
const DEFAULT_DIR = { date: 'desc', amount: 'desc', name: 'asc' };

// ── Tilt configs ───────────────────────────────────────────────

const ROW_TILT = {
  maxAngleX: 10, maxAngleY: 4, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.14, spread: 40 },
};

const CARD_TILT = {
  maxAngle: 8, lerp: 0.05, lerpOut: 0.07,
  scale: 1.02, perspective: 800,
  gloss: { opacity: 0.12, spread: 50 },
};

// ── Helpers ────────────────────────────────────────────────────

const fmt = n  => (+n).toFixed(2);
// Module-level mutable project timezone — the Orders top-level
// component sets it once via setOrdersTimezone() at mount, and every
// fmtDate / fmtDateLong call reads from it. This keeps date display
// consistent with the Analytics page (which also reads project.timezone
// server-side) — without this Orders shows "May 16" while Analytics
// shows "May 17" for the same order, because the browser TZ and the
// project TZ disagreed.
let __ORDERS_TZ = 'UTC';
const setOrdersTimezone = (tz) => { __ORDERS_TZ = tz || 'UTC'; };
// Prefer the structured recipient name fields when present (post
// guest-checkout migration). Falls back to the user account name,
// then to the legacy `recipient_name` freeform string, then to "—"
// for guests who never typed anything yet (shouldn't reach this).
function formatCustomerName(order) {
  const last  = (order.recipient_last_name  || '').trim();
  const first = (order.recipient_first_name || '').trim();
  if (last || first) return [first, last].filter(Boolean).join(' ');
  return (order.customer_name || order.recipient_name || '—').trim();
}

const fmtDate = ts => ts
  ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: __ORDERS_TZ })
  : '';
const fmtDateLong = ts => ts
  ? new Date(ts).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: __ORDERS_TZ })
  : '';

// ── Status selector ────────────────────────────────────────────
// Uses createPortal so the dropdown escapes overflow:hidden on prow rows.

function StatusSelect({ orderId, currentStatus, pq, onUpdated, onOpenChange }) {
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos,     setPos]     = useState(null);
  const [hovered, setHovered] = useState(null);
  const btnRef      = useRef(null);
  const indRef      = useRef(null);
  const itemRefs    = useRef({});
  const snapOnOpen = useRef(false);

  const openMenu = () => {
    snapOnOpen.current = true;
    setHovered(null);
    setOpen(true);
    onOpenChange?.(true);
  };
  const closeMenu = () => {
    setOpen(false);
    onOpenChange?.(false);
  };

  useEffect(() => {
    if (!open) return;
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
    }
    const handler = e => {
      if (btnRef.current && !btnRef.current.contains(e.target)) closeMenu();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Dynamic Block — tracks hovered ?? currentStatus; re-runs when portal mounts (pos changes)
  const cur = hovered ?? currentStatus;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = itemRefs.current[cur];
      if (!ind) return;
      if (!el) { ind.style.opacity = '0'; return; }
      if (snapOnOpen.current) {
        snapOnOpen.current = false;
        ind.style.transition = 'none';
        requestAnimationFrame(() => { if (indRef.current) indRef.current.style.transition = ''; });
      }
      ind.style.opacity   = '1';
      ind.style.transform = `translateY(${el.offsetTop}px)`;
      ind.style.height    = `${el.offsetHeight}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, currentStatus, pos]);

  const select = async status => {
    if (status === currentStatus) { setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}${pq}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) onUpdated(orderId, status);
    } finally { setLoading(false); closeMenu(); }
  };

  const m = STATUS_META[currentStatus] ?? { label: currentStatus, cls: '' };

  return (
    <>
      <button
        ref={btnRef}
        className={`ord-badge ord-badge--btn ${m.cls}`}
        onClick={e => { e.stopPropagation(); open ? closeMenu() : openMenu(); }}
        disabled={loading}
        type="button"
      >
        {loading ? '…' : m.label}
        <CaretDown className="ord-badge-caret" />
      </button>

      {open && pos && createPortal(
        <div
          className="ord-status-drop"
          style={{ top: pos.top, left: pos.left }}
          onMouseDown={e => e.stopPropagation()}
          onMouseLeave={() => setHovered(null)}
        >
          <div className="ord-status-items">
            <div className="ord-status-ind" ref={indRef} />
            {ALL_STATUSES.map(s => (
              <button
                key={s}
                ref={el => { if (el) itemRefs.current[s] = el; else delete itemRefs.current[s]; }}
                className={`ord-status-item${s === cur ? ' ord-status-item--active' : ''}`}
                onClick={e => { e.stopPropagation(); select(s); }}
                onMouseEnter={() => setHovered(s)}
                type="button"
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Sort toggle ────────────────────────────────────────────────

function OrdSortToggle({ sort, onSort }) {
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
          <button
            key={field}
            ref={el => { btnRefs.current[field] = el; }}
            className={`org-sort-btn${isCur ? ' org-sort-btn--current' : ''}`}
            style={active ? { paddingLeft: '6px' } : undefined}
            onMouseEnter={() => setHovered(field)}
            onClick={() => handleClick(field)}
            type="button"
          >
            {active && (
              <ArrowDown
                className="org-sort-icon"
                style={{ transform: sort.dir === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Status filter — Dynamic Block pill bar ────────────────────

function OrdStatusFilter({ active, counts, onChange }) {
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
        <button
          key={key}
          ref={el => { if (el) btnRefs.current[key] = el; else delete btnRefs.current[key]; }}
          className={`ord-filter-btn${cur === key ? ' ord-filter-btn--current' : ''}`}
          onClick={() => onChange(key)}
          onMouseEnter={() => setHovered(key)}
          type="button"
        >
          {label}
          {key === 'new' && counts.new > 0 && (
            <span className="ord-filter-badge">{counts.new}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Order row (table view) — InteractiveSection tilt ──────────

// Whitelist of statuses where it makes sense to print a shipping
// label. After 'shipped' the parcel is already in the courier's hands;
// 'delivered'/'cancelled'/'refunded' are terminal — reprinting a label
// at that point is almost always a mistake. Limiting the button this
// way keeps clutter down on rows where it would be a no-op.
const SHIP_LABEL_STATUSES = new Set(['new', 'confirmed']);

function OrderRow({ order, pq, onUpdated, onOpen, selected, onToggleSelect, onContextMenu, onPrintLabel }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, menuOpen);

  const handleContextMenu = (e) => {
    e.preventDefault();
    onContextMenu?.({ x: e.clientX, y: e.clientY });
  };

  const canPrint = SHIP_LABEL_STATUSES.has(order.status);

  return (
    <div
      ref={ref}
      className={`prow ord-prow${menuOpen ? ' org-list-row--frozen' : ''}${selected ? ' ord-prow--selected' : ''}`}
      onClick={() => onOpen(order)}
      onContextMenu={handleContextMenu}
      {...handlers}
    >
      <div ref={glossRef} className="org-list-gloss" />

      {/* Bulk-select checkbox — stopPropagation so clicking it doesn't open
          the order detail modal. */}
      <span className="ord-prow-check" onClick={e => e.stopPropagation()}>
        <input type="checkbox" className="cat-prod-checkbox"
          checked={!!selected}
          onChange={(e) => onToggleSelect?.(order.id, e.target.checked)} />
      </span>

      <span className="ord-prow-customer">
        <span className="ord-prow-name">
          {formatCustomerName(order)}
          {order.is_guest && <span className="ord-guest-badge">Guest</span>}
        </span>
        {order.customer_email && (
          <span className="ord-prow-email">{order.customer_email}</span>
        )}
      </span>

      <span className="prow-cell">{order.items_count} item{order.items_count !== 1 ? 's' : ''}</span>
      <span className="prow-cell" style={{ fontWeight: 600, color: 'var(--text)' }}>
        {formatMoney(order.total_amount, order.payment_currency)}
      </span>
      <span className="prow-cell">{fmtDate(order.created_at)}</span>

      {/* Status — stopPropagation so row click doesn't fire */}
      <span className="prow-cell" onClick={e => e.stopPropagation()}>
        <StatusSelect orderId={order.id} currentStatus={order.status} pq={pq} onUpdated={onUpdated} onOpenChange={setMenuOpen} />
      </span>

      {/* Print shipping label — icon-only button at the far right.
          Hidden for shipped/delivered/cancelled orders so the column
          column stays usable for new/confirmed rows that actually need
          a label. Spacer span preserves the grid track height. */}
      <span className="ord-prow-actions" onClick={e => e.stopPropagation()}>
        {canPrint ? (
          <button type="button" className="ord-prow-action-btn"
            title="Print shipping label"
            onClick={() => onPrintLabel?.(order.id)}>
            <Printer weight="bold" />
          </button>
        ) : null}
      </span>
    </div>
  );
}

// ── Order card (cards view) — InteractiveSection tilt ─────────

function OrderCard({ order, pq, onUpdated, onOpen, selected, onToggleSelect, onPrintLabel }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { ref, glossRef, handlers } = InteractiveSection(CARD_TILT, menuOpen);

  const canPrint = SHIP_LABEL_STATUSES.has(order.status);

  return (
    <div ref={ref}
      className={`ord-card${menuOpen ? ' ord-card--frozen' : ''}${selected ? ' ord-card--selected' : ''}`}
      onClick={() => onOpen(order)}
      {...handlers}>
      <div ref={glossRef} className="ord-card-gloss" />
      <div className="ord-card-main">
        <div className="ord-card-top">
          <span className="ord-card-id">
            {formatCustomerName(order)}
            {order.is_guest && <span className="ord-guest-badge">Guest</span>}
          </span>
          <span onClick={e => e.stopPropagation()}>
            <StatusSelect orderId={order.id} currentStatus={order.status} pq={pq} onUpdated={onUpdated} onOpenChange={setMenuOpen} />
          </span>
        </div>
        {order.customer_email && (
          <div className="ord-card-email">{order.customer_email}</div>
        )}
        <div className="ord-card-meta">
          <span className="ord-card-amount">{formatMoney(order.total_amount, order.payment_currency)}</span>
          <span className="ord-card-dot">·</span>
          <span>{order.items_count} item{order.items_count !== 1 ? 's' : ''}</span>
          <span className="ord-card-dot">·</span>
          <span>{fmtDate(order.created_at)}</span>
        </div>
      </div>
      {canPrint && (
        <button type="button" className="ord-card-action-btn"
          title="Print shipping label"
          onClick={(e) => { e.stopPropagation(); onPrintLabel?.(order.id); }}>
          <Printer weight="bold" />
        </button>
      )}
    </div>
  );
}

// ── Order modal — uses shared Modal component ──────────────────

function OrderModal({ order, pq, onClose, onUpdated }) {
  const [detail,  setDetail]  = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/orders/${order.id}${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setDetail(d); })
      .finally(() => setLoading(false));
  }, [order.id]);

  return (
    <Modal
      onClose={onClose}
      title={`Order #${order.id}`}
      subtitle={fmtDateLong(order.created_at)}
      extra={
        <StatusSelect
          orderId={order.id}
          currentStatus={order.status}
          pq={pq}
          onUpdated={onUpdated}
        />
      }
    >
      {loading && <div className="modal-loading">Loading…</div>}

      {!loading && !detail && (
        <div className="modal-loading">Failed to load order details.</div>
      )}

      {!loading && detail && (
        <>
          {/* Customer */}
          <div className="modal-section">
            <div className="modal-section-label">Customer</div>
            <div className="modal-section-value">{order.customer_name || order.recipient_name}</div>
            {order.customer_email && <div className="modal-section-sub">{order.customer_email}</div>}
            {detail.phone && <div className="modal-section-sub">{detail.phone}</div>}
          </div>

          {/* Delivery & Payment */}
          <div className="modal-section">
            <div className="modal-section-label">Delivery & Payment</div>
            <div className="modal-section-value">
              {detail.delivery_method === 'courier' ? 'Courier' : 'Postal'}
              {detail.address ? ` — ${detail.address}` : ''}
            </div>
            <div className="modal-section-sub">
              {detail.payment_method === 'card' ? 'Card payment' : 'Pay on Delivery'}
            </div>
            {detail.comment && (
              <div className="modal-section-sub" style={{ fontStyle: 'italic' }}>"{detail.comment}"</div>
            )}
          </div>

          {/* Items */}
          {detail.items?.length > 0 && (
            <div className="modal-section">
              <div className="modal-section-label">Items</div>
              <div className="ord-modal-items">
                {detail.items.map((item, i) => (
                  <div key={i} className="ord-modal-item">
                    {item.image_url && (
                      <img src={item.image_url} alt={item.title} className="ord-modal-img" />
                    )}
                    <div className="ord-modal-item-info">
                      <span className="ord-modal-item-name">{item.title}</span>
                      <span className="ord-modal-item-meta">
                        {item.variation_name} · {item.size_name} · ×{item.quantity}
                      </span>
                    </div>
                    <span className="ord-modal-item-price">
                      {formatMoney(item.price, detail.payment_currency || order.payment_currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Total */}
          <div className="modal-footer-row">
            <span className="modal-footer-label">Total</span>
            <span className="modal-footer-value">
              {formatMoney(order.total_amount, detail.payment_currency || order.payment_currency)}
            </span>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Top-level Orders/Returns tab switcher ─────────────────────
// Same pill switcher pattern as Authentication page. URL state via `?tab=`.

function OrdersTopTabs({ tabs, tab, setTab, returnsActionCount }) {
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
    <div className="auth-tab-wrapper">
      <div className="auth-tab-switcher" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef} className="auth-tab-indicator" />
        {tabs.map(({ key, label, Icon }) => (
          <button key={key} ref={el => { btnRefs.current[key] = el; }}
            className={`auth-tab-btn${curTab === key ? ' auth-tab-btn--active' : ''}`}
            onMouseEnter={() => setHovered(key)}
            onClick={() => setTab(key)} type="button">
            <Icon className="auth-tab-icon" />
            {label}
            {key === 'returns' && returnsActionCount > 0 && (
              <span className="ord-filter-badge" style={{ marginLeft: 4 }}>
                {returnsActionCount}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}


// ── Top-level page: Orders ↔ Returns ──────────────────────────

function Orders() {
  const { projectId, project, access } = useOutletContext();
  const canView = (p) => !access || access.is_owner || ['view', 'manage'].includes(access.permissions?.[p]);
  const orderTabs = [
    canView('orders')  && { key: 'orders',  label: 'Orders',  Icon: Receipt },
    canView('returns') && { key: 'returns', label: 'Returns', Icon: ArrowUUpLeft },
  ].filter(Boolean);
  // Keep date formatting in sync with the project's configured TZ so
  // Orders' "May 17, 2026" stays consistent with what Analytics shows
  // for the same order (both read project.timezone now).
  useEffect(() => {
    if (project?.timezone) setOrdersTimezone(project.timezone);
  }, [project?.timezone]);
  const [params, setParams] = useSearchParams();
  const initialTab = (params.get('tab') === 'returns' && canView('returns')) ? 'returns'
    : canView('orders') ? 'orders'
    : canView('returns') ? 'returns' : 'orders';
  const [topTab, setTopTab] = useState(initialTab);
  const [returnsActionCount, setReturnsActionCount] = useState(0);

  // Sync URL with tab (preserves ?open=… on Returns deep-link)
  const switchTab = (key) => {
    setTopTab(key);
    const next = new URLSearchParams(params);
    if (key === 'returns') next.set('tab', 'returns');
    else                    next.delete('tab');
    if (key === 'orders')   next.delete('open');
    setParams(next, { replace: true });
  };

  // Poll the Returns "action needed" badge while either tab is mounted.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch(`${API_BASE}/api/projects/${projectId}/returns/stats`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (!cancelled && j) setReturnsActionCount(j.action_count || 0); })
        .catch(() => {});
    };
    tick();
    const iv = setInterval(tick, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [projectId]);

  return (
    <div className="auth-page">
      {orderTabs.length > 1 && (
        <OrdersTopTabs tabs={orderTabs} tab={topTab} setTab={switchTab}
                        returnsActionCount={returnsActionCount} />
      )}
      {topTab === 'orders'  && canView('orders')  && <OrdersTab />}
      {topTab === 'returns' && canView('returns') && <Returns onActionCountChange={setReturnsActionCount} />}
    </div>
  );
}


// ── Orders tab (the original orders list) ─────────────────────

function OrdersTab() {
  const { projectId } = useOutletContext();
  const pq = `?project_id=${projectId}`;

  const [tab,       setTab]       = useState('all');
  const [search,    setSearch]    = useState('');
  const [view,      setView]      = useState('table');
  const [viewHover, setViewHover] = useState(null);
  const [sort,      setSort]      = useState({ field: 'date', dir: 'desc' });
  const [openOrder, setOpenOrder] = useState(null);
  // Bulk selection + shipping label modal state. selectedIds is a Set
  // (kept lightweight; one Set survives across infinite-scroll loads).
  // labelOrderIds drives the shipping-label modal: a single int array
  // from the per-row Print button, or many ids from the bulk action
  // bar. Same modal handles both cases.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [labelOrderIds, setLabelOrderIds] = useState(null); // [int]

  const toggleSelect = useCallback((orderId, on) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (on) next.add(orderId); else next.delete(orderId);
      return next;
    });
  }, []);

  // Infinite-scroll orders feed — 100 per page (table rows are denser than cards).
  const {
    items: orders, hasMore, loading, loadMore, reload: fetchOrders, setItems: setOrders,
  } = useInfiniteList({
    url: `${API_BASE}/api/orders${pq}`,
    pageSize: 100,
  });
  const ordersSentinelRef = useInfiniteScroll(loadMore);

  // SSE — refetch when a new order arrives (last_id increases = new row in DB)
  useEffect(() => {
    const prev = { lastId: -1 };
    const es = new EventSource(`${API_BASE}/api/orders/stream${pq}`, { withCredentials: true });
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (prev.lastId !== -1 && d.last_id > prev.lastId) fetchOrders();
        prev.lastId = d.last_id ?? 0;
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [projectId, fetchOrders]);

  const handleUpdated = useCallback((orderId, newStatus) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    setOpenOrder(prev => prev?.id === orderId ? { ...prev, status: newStatus } : prev);
  }, []);

  // Counts
  const counts = { all: orders.length };
  for (const s of ALL_STATUSES) counts[s] = 0;
  for (const o of orders) { if (counts[o.status] !== undefined) counts[o.status]++; }

  // Filter
  const q = search.toLowerCase();
  const filtered = orders.filter(o => {
    if (tab !== 'all' && o.status !== tab) return false;
    if (q) {
      const name  = (o.customer_name || o.recipient_name || '').toLowerCase();
      const email = (o.customer_email || '').toLowerCase();
      if (!name.includes(q) && !email.includes(q)) return false;
    }
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sort.field === 'name') {
      const na = (a.customer_name || a.recipient_name || '').toLowerCase();
      const nb = (b.customer_name || b.recipient_name || '').toLowerCase();
      const c  = na.localeCompare(nb);
      return sort.dir === 'asc' ? c : -c;
    }
    if (sort.field === 'amount') {
      return sort.dir === 'asc'
        ? a.total_amount - b.total_amount
        : b.total_amount - a.total_amount;
    }
    const da = new Date(a.created_at).getTime();
    const db = new Date(b.created_at).getTime();
    return sort.dir === 'asc' ? da - db : db - da;
  });

  const curView = viewHover ?? view;
  const isEmpty = !loading && sorted.length === 0;
  const emptyMsg = tab === 'all' && !search ? 'No orders yet' : 'No orders match your filter';

  return (
    <>
      <h1 className="crm-page-title">Orders</h1>

      {/* ── Toolbar ── */}
      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input
            className="org-search-input"
            placeholder="Search orders…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="ord-toolbar-right">
          <OrdSortToggle sort={sort} onSort={setSort} />
          <OrdStatusFilter active={tab} counts={counts} onChange={setTab} />

          <div className="org-view-toggle" onMouseLeave={() => setViewHover(null)}>
            <div
              className="org-view-indicator"
              style={{ transform: `translateX(${curView === 'cards' ? 30 : 0}px)` }}
            />
            <button
              className={`org-view-btn${curView === 'table' ? ' org-view-btn--current' : ''}`}
              onClick={() => setView('table')}
              onMouseEnter={() => setViewHover('table')}
              title="Table view" type="button"
            >
              <List className="org-view-icon" />
            </button>
            <button
              className={`org-view-btn${curView === 'cards' ? ' org-view-btn--current' : ''}`}
              onClick={() => setView('cards')}
              onMouseEnter={() => setViewHover('cards')}
              title="Cards view" type="button"
            >
              <SquaresFour className="org-view-icon" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Table view ── */}
      {view === 'table' && (
        <div className="prod-list">
          <div className="ord-list-head ord-list-head--bulk">
            <span className="org-list-th ord-list-th-check">
              {/* Header checkbox: tri-state. Clicking toggles ALL currently
                  filtered rows (not the entire orders list, which could be
                  hundreds). */}
              <input type="checkbox" className="cat-prod-checkbox"
                checked={sorted.length > 0 && sorted.every(o => selectedIds.has(o.id))}
                ref={el => {
                  if (!el) return;
                  const sel = sorted.filter(o => selectedIds.has(o.id)).length;
                  el.indeterminate = sel > 0 && sel < sorted.length;
                }}
                onChange={(e) => {
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    if (e.target.checked) sorted.forEach(o => next.add(o.id));
                    else                   sorted.forEach(o => next.delete(o.id));
                    return next;
                  });
                }} />
            </span>
            <span className="org-list-th">Customer</span>
            <span className="org-list-th">Items</span>
            <span className="org-list-th">Amount</span>
            <span className="org-list-th">Date</span>
            <span className="org-list-th">Status</span>
            {/* Empty header for the per-row Print-label action column. */}
            <span className="org-list-th" aria-hidden="true" />
          </div>

          {loading ? (
            <div className="crm-placeholder">Loading orders…</div>
          ) : isEmpty ? (
            <div className="ord-empty">
              <Package className="ord-empty-icon" weight="duotone" />
              <p>{emptyMsg}</p>
            </div>
          ) : (
            <div className="prod-list-block">
              {sorted.map(order => (
                <OrderRow
                  key={order.id}
                  order={order}
                  pq={pq}
                  onUpdated={handleUpdated}
                  onOpen={setOpenOrder}
                  selected={selectedIds.has(order.id)}
                  onToggleSelect={toggleSelect}
                  onPrintLabel={(id) => setLabelOrderIds([id])}
                />
              ))}
              {hasMore && <div ref={ordersSentinelRef} className="inf-sentinel">Loading more…</div>}
            </div>
          )}
        </div>
      )}

      {/* ── Cards view ── */}
      {view === 'cards' && (
        loading && orders.length === 0 ? (
          <p className="crm-placeholder">Loading orders…</p>
        ) : isEmpty ? (
          <div className="ord-empty">
            <Package className="ord-empty-icon" weight="duotone" />
            <p>{emptyMsg}</p>
          </div>
        ) : (
          <div className="ord-cards">
            {sorted.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                pq={pq}
                onUpdated={handleUpdated}
                onOpen={setOpenOrder}
                selected={selectedIds.has(order.id)}
                onToggleSelect={toggleSelect}
                onPrintLabel={(id) => setLabelOrderIds([id])}
              />
            ))}
            {hasMore && <div ref={ordersSentinelRef} className="inf-sentinel">Loading more…</div>}
          </div>
        )
      )}

      {/* Sticky bulk action bar — appears only when ≥1 row is selected.
          Mirrors the pattern used by other multi-select UIs in this CRM. */}
      {selectedIds.size > 0 && (
        <div className="ord-bulk-bar">
          <span className="ord-bulk-count">
            {selectedIds.size} order{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <button type="button" className="crm-submit-btn"
            onClick={() => setLabelOrderIds([...selectedIds])}>
            <Printer weight="bold" style={{ verticalAlign: '-3px', marginRight: 6 }} />
            Print shipping labels
          </button>
          <button type="button" className="auth-btn-check"
            onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {/* Shipping-label modal — open with either a single order id (from
          context menu) or N order ids (from bulk action bar). */}
      <PrintShippingLabelModal
        open={!!labelOrderIds}
        orderIds={labelOrderIds || []}
        onClose={() => setLabelOrderIds(null)}
      />

      {/* ── Order detail modal ── */}
      {openOrder && (
        <OrderModal
          order={openOrder}
          pq={pq}
          onClose={() => setOpenOrder(null)}
          onUpdated={handleUpdated}
        />
      )}
    </>
  );
}

export default Orders;
