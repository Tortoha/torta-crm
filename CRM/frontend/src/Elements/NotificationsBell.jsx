import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCircle, Trash, Warehouse, ShoppingBag, Calendar, Lightning,
  Target, ChatCircleDots, ArrowUUpLeft, Warning, X, CaretRight,
} from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { InteractiveSection } from '../Utils/InteractiveSection.js';
import { PoListRow } from '../Utils/PoListRow.jsx';  // standard Inventory/Promo tilt (scale 1.052)
import '../Style/Products.css';  // .po-set-table, .po-set-row, .po-set-row--head, .po-set-strong

// Dropdown rows are small, so the tilt is dialed up (scale 1.086) to read.
// The modal uses the standard PoListRow (scale 1.052) since its cards are
// full-width — same IS feel as Inventory / Promo codes.
const NOTIF_TILT = {
  maxAngleX: 10, maxAngleY: 4, lerp: 0.05, lerpOut: 0.07,
  scale: 1.086, perspective: 900,
  gloss: { opacity: 0.14, spread: 40 },
};

function NotifRow({ className = '', children, ...rest }) {
  const { ref, glossRef, handlers } = InteractiveSection(NOTIF_TILT, false);
  return (
    <div ref={ref} className={`po-set-row ${className}`.trim()} {...handlers} {...rest}>
      <div ref={glossRef} className="po-set-row-gloss" />
      {children}
    </div>
  );
}

// Bell with unread badge + dropdown notifications panel. Real-time via WebSocket /api/notifications/ws.
// Per-notification-type icon. Backend `type` column maps 1:1 to keys here.
// Keep `Bell` as a fallback in render() so unrecognised types still get a
// sensible visual rather than no icon.
const TYPE_ICON = {
  low_stock:     <Warehouse weight="bold" />,
  new_order:     <ShoppingBag weight="bold" />,
  new_booking:   <Calendar weight="bold" />,
  webhook_failed:<Lightning weight="bold" />,
  // New types wired this pass:
  alert:         <Warning weight="bold" />,         // alerts evaluator firing
  goal:          <Target weight="bold" />,          // target hit
  chat:          <ChatCircleDots weight="bold" />,  // new chat message
  return:        <ArrowUUpLeft weight="bold" />,    // return state change
};

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60)    return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)    return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)    return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Shared row renderer. `Row` is the tilt-wrapper component — defaults to the
// dropdown's bigger-tilt NotifRow; the modal passes PoListRow for the standard
// Inventory-grade tilt on its full-width cards.
function NotifItem({ it, onClick, Row = NotifRow }) {
  return (
    <Row
      className={`notif-row notif-row--clickable${it.is_read ? '' : ' notif-row--unread'}`}
      onClick={onClick}>
      <span className="notif-row-body">
        <span className="notif-row-icon">{TYPE_ICON[it.type] || <Bell weight="bold" />}</span>
        <span className="notif-row-text">
          <span className="po-set-strong notif-row-title">{it.title}</span>
          <span className="notif-row-message">{it.message}</span>
        </span>
      </span>
      <span className="notif-row-time">{timeAgo(it.created_at)}</span>
    </Row>
  );
}

// Bucket a timestamp into a date group label for the "all" modal.
function dateBucket(iso) {
  if (!iso) return 'Earlier';
  const d = new Date(iso), now = new Date();
  const sToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sItem  = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((sToday - sItem) / 86400000);
  if (diff <= 0)  return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)   return 'This week';
  if (diff < 30)  return 'This month';
  return 'Earlier';
}

// Full-history modal — every notification grouped by date, rendered as the
// Products-page list style (po-set-table rows). Loads 30 at a time via a
// keyset cursor (infinite scroll) so a year of history isn't fetched at once.
const NOTIF_PAGE = 30;

function AllNotificationsModal({ onClose, onOpenItem }) {
  const [items, setItems]             = useState([]);
  const [loading, setLoading]         = useState(true);   // first page
  const [loadingMore, setLoadingMore] = useState(false);  // subsequent pages
  const [hasMore, setHasMore]         = useState(false);
  const bodyRef     = useRef(null);
  const sentinelRef = useRef(null);
  const busyRef     = useRef(false);    // guards against double-fire

  const fetchPage = useCallback(async (before) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const first = before == null;
    first ? setLoading(true) : setLoadingMore(true);
    try {
      const url = `${API_BASE}/api/notifications?limit=${NOTIF_PAGE}`
        + (before != null ? `&before=${before}` : '');
      const res  = await fetch(url, { credentials: 'include' });
      const data = res.ok ? await res.json() : { items: [], has_more: false };
      setItems(prev => first ? (data.items || []) : [...prev, ...(data.items || [])]);
      setHasMore(!!data.has_more);
    } catch {
      setHasMore(false);
    } finally {
      busyRef.current = false;
      first ? setLoading(false) : setLoadingMore(false);
    }
  }, []);

  // Initial page + Escape-to-close.
  useEffect(() => {
    fetchPage(null);
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fetchPage, onClose]);

  // Infinite scroll: load the next page when the sentinel nears the viewport.
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !busyRef.current && items.length) {
        fetchPage(items[items.length - 1].id);
      }
    }, { root: bodyRef.current, rootMargin: '160px' });
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, items, fetchPage]);

  // Items arrive newest-first, so contiguous buckets group cleanly in one pass.
  const groups = useMemo(() => {
    const out = []; let cur = null;
    for (const it of items) {
      const b = dateBucket(it.created_at);
      if (!cur || cur.label !== b) { cur = { label: b, items: [] }; out.push(cur); }
      cur.items.push(it);
    }
    return out;
  }, [items]);

  // Window chrome copied from the New-promo-code modal (auth-modal / cpm-modal).
  // notif-all-overlay drops the overlay's backdrop-filter blur: with the
  // InteractiveSection tilt-cards animating inside, the blur forces a full
  // re-composite every frame → the tilt lerp visibly lags (unlike Promo /
  // Inventory rows which sit on the page with no blur). Dim stays for focus.
  return createPortal(
    <div className="auth-modal-overlay notif-all-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal notif-all-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">All notifications</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">Everything you've received, grouped by date.</span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body notif-all-body" ref={bodyRef}>
          {loading && <p className="crm-placeholder">Loading…</p>}
          {!loading && items.length === 0 && (
            <p className="crm-placeholder">No notifications yet</p>
          )}
          {groups.map(g => (
            <div className="notif-group" key={g.label}>
              <div className="notif-group-label">{g.label}</div>
              <div className="po-set-table notif-table">
                {g.items.map(it => (
                  <NotifItem key={it.id} it={it} onClick={() => onOpenItem(it)} Row={PoListRow} />
                ))}
              </div>
            </div>
          ))}
          {hasMore && (
            <div ref={sentinelRef} className="notif-load-sentinel">
              {loadingMore ? 'Loading more…' : ''}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function NotificationsBell() {
  const navigate = useNavigate();
  const btnRef   = useRef(null);
  const [open,        setOpen]        = useState(false);
  const [showAll,     setShowAll]     = useState(false);
  const [pos,         setPos]         = useState(null);
  const [items,       setItems]       = useState([]);
  const [unread,      setUnread]      = useState(0);
  const [loading,     setLoading]     = useState(false);
  const wsRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      // Only 11 — 10 to show + 1 to know whether the "View all" card is needed.
      // The full history is paginated lazily inside the modal, not loaded here.
      const res = await fetch(`${API_BASE}/api/notifications?limit=11`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items || []);
      setUnread(data.unread || 0);
    } finally { setLoading(false); }
  };

  // Initial fetch + WebSocket subscribe — auto-reconnect every 5s if it drops.
  useEffect(() => {
    let alive = true;
    load();

    const connect = () => {
      if (!alive) return;
      const url = API_BASE.replace(/^http/, 'ws') + '/api/notifications/ws';
      let ws;
      try { ws = new WebSocket(url); } catch { setTimeout(connect, 5000); return; }
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          setItems(prev => [msg, ...prev].slice(0, 50));
          setUnread(c => c + 1);
        } catch {}
      };
      ws.onclose = () => { if (alive) setTimeout(connect, 5000); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };
    connect();
    return () => {
      alive = false;
      try { wsRef.current?.close(); } catch {}
    };
  }, []);

  const POPOVER_W = 400;
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 16, left: Math.max(8, r.right - POPOVER_W) });
    const onDown = e => {
      if (!e.target.closest?.('.notif-popover') && !btnRef.current?.contains(e.target))
        setOpen(false);
    };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = async (id) => {
    setItems(prev => prev.map(x => x.id === id ? { ...x, is_read: true } : x));
    setUnread(c => Math.max(0, c - 1));
    await fetch(`${API_BASE}/api/notifications/${id}/read`, {
      method: 'POST', credentials: 'include',
    });
  };

  const markAllRead = async () => {
    setItems(prev => prev.map(x => ({ ...x, is_read: true })));
    setUnread(0);
    await fetch(`${API_BASE}/api/notifications/read-all`, {
      method: 'POST', credentials: 'include',
    });
  };

  const onItemClick = (it) => {
    if (!it.is_read) markRead(it.id);
    setOpen(false);
    if (it.link) navigate(it.link);
  };

  return (
    <>
      <button ref={btnRef} className="hdr-bell-btn" type="button"
        onClick={() => { setOpen(v => !v); if (!open) load(); }}
        title="Notifications">
        <Bell weight={unread ? 'fill' : 'regular'} />
        {unread > 0 && <span className="hdr-bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && pos && createPortal(
        <div className="notif-popover" style={{ top: pos.top, left: pos.left }}>
          {unread > 0 && (
            <div className="notif-head">
              <button className="notif-mark-all" type="button" onClick={markAllRead}>
                Mark all read
              </button>
            </div>
          )}

          <div className="notif-list">
            {loading && <p className="crm-placeholder">Loading…</p>}
            {!loading && items.length === 0 && (
              <p className="crm-placeholder">No notifications yet</p>
            )}
            {items.length > 0 && (
              <div className="po-set-table notif-table">
                {/* Cap the dropdown at 10; the 11th card is the "View all" CTA
                    (same card style, inside the same stack — not a separate
                    block). The rest live in the modal. */}
                {items.slice(0, 10).map(it => (
                  <NotifItem key={it.id} it={it} onClick={() => onItemClick(it)} />
                ))}
                {items.length > 10 && (
                  <NotifRow className="notif-row notif-viewall-row"
                    onClick={() => { setShowAll(true); setOpen(false); }}>
                    <span className="notif-viewall-inner">
                      View all notifications
                      <CaretRight weight="bold" />
                    </span>
                  </NotifRow>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {showAll && (
        <AllNotificationsModal
          onClose={() => setShowAll(false)}
          onOpenItem={(it) => { onItemClick(it); setShowAll(false); }}
        />
      )}
    </>
  );
}
