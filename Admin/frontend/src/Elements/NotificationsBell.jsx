// Admin notifications bell — a stripped clone of CRM/frontend/src/Elements/
// NotificationsBell.jsx. Same markup + the copied Header.css / Products.css
// classes, so it looks identical. Differences vs CRM:
//   • no i18n (admin is single-locale) — labels are inline English
//   • only the admin notification types (admin_feedback / admin_inbox)
//   • same real-time pipeline: GET /api/notifications + WS /api/notifications/ws
// The admin IS a CRM user (ADMIN_LOCKED_EMAIL), so the backend pushes feedback /
// inbound-mail pings to that user via push_notification and they arrive here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Bell, X, CaretRight, ChatCircleDots, EnvelopeSimple,
} from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { InteractiveSection } from '../Utils/InteractiveSection.js';
import { PoListRow } from '../Utils/PoListRow.jsx';  // standard tilt (scale 1.052)
import '../Style/Products.css';  // .po-set-table, .po-set-row, .po-set-strong

// The admin bell is scoped to platform pings only — feedback + inbound mail.
// The backend filters the list/badge by these types; the WS (which streams ALL
// of the user's notifications) is filtered client-side to match.
const ADMIN_TYPES_QS = 'admin_feedback,admin_inbox';
const ADMIN_TYPE_SET = new Set(['admin_feedback', 'admin_inbox']);

// Dropdown rows are small, so the tilt is dialed up (scale 1.086) to read.
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

// Per-type icon. Backend `type` column maps 1:1 to keys here. Bell stays as a
// fallback so any future/unrecognised type still gets a sensible visual.
const TYPE_ICON = {
  admin_feedback: <ChatCircleDots weight="bold" />,  // bug report / idea (title says which)
  admin_inbox:    <EnvelopeSimple weight="bold" />,  // inbound platform mail
};

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const BUCKET_LABEL = {
  today: 'Today', yesterday: 'Yesterday', thisWeek: 'This week',
  thisMonth: 'This month', earlier: 'Earlier',
};

// Shared row renderer. `Row` is the tilt-wrapper — defaults to the dropdown's
// bigger-tilt NotifRow; the modal passes PoListRow for the standard tilt.
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
  if (!iso) return 'earlier';
  const d = new Date(iso), now = new Date();
  const sToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sItem  = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((sToday - sItem) / 86400000);
  if (diff <= 0)  return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7)   return 'thisWeek';
  if (diff < 30)  return 'thisMonth';
  return 'earlier';
}

const NOTIF_PAGE = 30;

function AllNotificationsModal({ onClose, onOpenItem }) {
  const [items, setItems]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]         = useState(false);
  const bodyRef     = useRef(null);
  const sentinelRef = useRef(null);
  const busyRef     = useRef(false);

  const fetchPage = useCallback(async (before) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const first = before == null;
    first ? setLoading(true) : setLoadingMore(true);
    try {
      const url = `${API_BASE}/api/notifications?limit=${NOTIF_PAGE}&types=${ADMIN_TYPES_QS}`
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

  useEffect(() => {
    fetchPage(null);
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fetchPage, onClose]);

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

  const groups = useMemo(() => {
    const out = []; let cur = null;
    for (const it of items) {
      const b = dateBucket(it.created_at);
      if (!cur || cur.label !== b) { cur = { label: b, items: [] }; out.push(cur); }
      cur.items.push(it);
    }
    return out;
  }, [items]);

  return createPortal(
    <div className="auth-modal-overlay notif-all-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal notif-all-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">All notifications</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">Everything in one place</span>
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
            <p className="crm-placeholder">No notifications</p>
          )}
          {groups.map(g => (
            <div className="notif-group" key={g.label}>
              <div className="notif-group-label">{BUCKET_LABEL[g.label] || 'Earlier'}</div>
              <div className="po-set-table notif-table">
                {g.items.map(it => (
                  <NotifItem key={it.id} it={it} onClick={() => onOpenItem(it)} Row={PoListRow} />
                ))}
              </div>
            </div>
          ))}
          {hasMore && (
            <div ref={sentinelRef} className="notif-load-sentinel">
              {loadingMore ? 'Loading…' : ''}
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
  const [open,    setOpen]    = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [pos,     setPos]     = useState(null);
  const [items,   setItems]   = useState([]);
  const [unread,  setUnread]  = useState(0);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/notifications?limit=11&types=${ADMIN_TYPES_QS}`, { credentials: 'include' });
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
          // The socket streams every notification for this user; the admin bell
          // only cares about platform pings. Ignore the rest (e.g. the admin's
          // own store notifications) so the badge can't drift from the list.
          if (!ADMIN_TYPE_SET.has(msg.type)) return;
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
              <p className="crm-placeholder">No notifications</p>
            )}
            {items.length > 0 && (
              <div className="po-set-table notif-table">
                {items.slice(0, 10).map(it => (
                  <NotifItem key={it.id} it={it} onClick={() => onItemClick(it)} />
                ))}
                {items.length > 10 && (
                  <NotifRow className="notif-row notif-viewall-row"
                    onClick={() => { setShowAll(true); setOpen(false); }}>
                    <span className="notif-viewall-inner">
                      View all
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
