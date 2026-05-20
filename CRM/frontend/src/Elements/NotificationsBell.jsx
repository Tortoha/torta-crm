import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCircle, Trash, Warehouse, ShoppingBag, Calendar, Lightning,
  Target, ChatCircleDots, ArrowUUpLeft, Warning,
} from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { InteractiveSection } from '../Utils/InteractiveSection.js';
import '../Style/Products.css';  // .po-set-table, .po-set-row, .po-set-row--head, .po-set-strong

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

export default function NotificationsBell() {
  const navigate = useNavigate();
  const btnRef   = useRef(null);
  const [open,        setOpen]        = useState(false);
  const [pos,         setPos]         = useState(null);
  const [items,       setItems]       = useState([]);
  const [unread,      setUnread]      = useState(0);
  const [loading,     setLoading]     = useState(false);
  const wsRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/notifications?limit=20`, { credentials: 'include' });
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
                {items.map(it => (
                  <NotifRow key={it.id}
                    className={`notif-row notif-row--clickable${it.is_read ? '' : ' notif-row--unread'}`}
                    onClick={() => onItemClick(it)}>
                    <span className="notif-row-body">
                      <span className="notif-row-icon">
                        {TYPE_ICON[it.type] || <Bell weight="bold" />}
                      </span>
                      <span className="notif-row-text">
                        <span className="po-set-strong notif-row-title">{it.title}</span>
                        <span className="notif-row-message">{it.message}</span>
                      </span>
                    </span>
                    <span className="notif-row-time">{timeAgo(it.created_at)}</span>
                  </NotifRow>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
