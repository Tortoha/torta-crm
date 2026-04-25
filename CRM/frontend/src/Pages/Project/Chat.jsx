import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  Plug, X, XCircle, CaretRight, CaretDown, CheckCircle, ChatCircleDots,
  PaperPlaneRight, ChatsCircle, ArrowCounterClockwise,
  Copy, Trash, CircleNotch,
} from '@phosphor-icons/react';
import { Icon as IconifyIcon } from '@iconify/react';
import { API_BASE } from '../../api.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import '../../Style/Authentication.css';
import '../../Style/Chat.css';

// ─── Brand icons ──────────────────────────────────────────────────────────────
//
// Real multi-color brand SVGs from Iconify's `logos` collection. WebChat keeps
// the generic Phosphor chat bubble since it isn't a brand.

// Adapter: Iconify uses width/height; existing call sites pass `size` — convert.
// `color` is applied for monochrome icons (simple-icons) so they render in brand colors,
// not the inherited text color.
const iconifyChannel = (name, color) => ({ size = 24, className, style }) => (
  <IconifyIcon icon={name} width={size} height={size} className={className}
    style={{ ...style, ...(color ? { color } : null) }} />
);

const TelegramIcon  = iconifyChannel('logos:telegram');
const DiscordIcon   = iconifyChannel('logos:discord-icon');
const WhatsAppIcon  = iconifyChannel('simple-icons:whatsapp', '#25D366');
const InstagramIcon = iconifyChannel('simple-icons:instagram', '#E4405F');
const FacebookIcon  = iconifyChannel('logos:facebook');
const XIcon         = iconifyChannel('simple-icons:x',     '#000000');
const VkIcon        = iconifyChannel('simple-icons:vk',    '#0077FF');
const ViberIcon     = iconifyChannel('simple-icons:viber', '#7360F2');

// WebChat — generic chat icon (Phosphor, blue accent).
const WebChatIcon = props => <ChatCircleDots weight="fill" {...props} />;

// ─── Channels catalogue ───────────────────────────────────────────────────────
//
// `realtime`   — works on localhost without HTTPS (poller-based)
// `webhook`    — needs public HTTPS for inbound (Meta family + Viber + X)
// `fields[]`   — config form schema. Each field is rendered in ChannelModal.
//
const CHANNELS = [
  {
    id: 'webchat', label: 'Web Chat', Icon: WebChatIcon,
    desc: 'Embed a support widget on your website. Customers chat anonymously.',
    realtime: true, configurable: true,
    fields: [],
  },
  {
    id: 'telegram', label: 'Telegram', Icon: TelegramIcon,
    desc: 'Connect a Telegram bot to receive direct messages from customers.',
    realtime: true, configurable: true,
    fields: [
      { key: 'bot_token', label: 'Bot token', placeholder: '123456789:AA…',
        hint: 'Talk to @BotFather on Telegram, create a bot, then paste the token here.' },
    ],
  },
  {
    id: 'discord', label: 'Discord', Icon: DiscordIcon,
    desc: 'Connect a Discord bot to receive direct messages from users.',
    realtime: true, configurable: true,
    fields: [
      { key: 'bot_token', label: 'Bot token', placeholder: 'MTI3O…',
        hint: 'Discord Developer Portal → Applications → New App → Bot → Reset Token. Enable Privileged Gateway Intent: MESSAGE CONTENT.' },
    ],
  },
  {
    id: 'vk', label: 'VK', Icon: VkIcon,
    desc: 'Connect a VK community to receive messages sent to the group.',
    realtime: true, configurable: true,
    fields: [
      { key: 'group_id',     label: 'Community ID', placeholder: '123456789',
        hint: 'Numeric ID of your VK community.' },
      { key: 'access_token', label: 'Group access token', placeholder: 'vk1.a.…',
        hint: 'Group → Settings → API usage → Create token (scopes: messages, manage). Then enable Long Poll API in Community settings.' },
    ],
  },
  {
    id: 'whatsapp', label: 'WhatsApp', Icon: WhatsAppIcon,
    desc: 'Receive customer messages via the WhatsApp Cloud API.',
    realtime: false, configurable: true, webhook: true,
    fields: [
      { key: 'phone_number_id', label: 'Phone number ID', placeholder: '123456789012345',
        hint: 'From Meta for Developers → WhatsApp → API Setup.' },
      { key: 'access_token', label: 'Permanent access token', placeholder: 'EAA…',
        hint: 'System User token with whatsapp_business_messaging scope.' },
      { key: 'verify_token', label: 'Webhook verify token', placeholder: 'pick-any-string',
        hint: 'Make up any string. Paste the same string into Meta when subscribing the webhook.' },
      { key: 'app_secret',   label: 'App secret', placeholder: 'optional but recommended',
        hint: 'From your Meta App → Settings → Basic. Used to verify X-Hub-Signature-256.' },
    ],
  },
  {
    id: 'instagram', label: 'Instagram', Icon: InstagramIcon,
    desc: 'Receive Instagram Direct messages from your business profile.',
    realtime: false, configurable: true, webhook: true,
    fields: [
      { key: 'page_id', label: 'Instagram page ID', placeholder: '17841…',
        hint: 'The IG Business Account ID linked to a Facebook Page.' },
      { key: 'access_token', label: 'Page access token', placeholder: 'EAA…',
        hint: 'Long-lived Page token with instagram_manage_messages scope.' },
      { key: 'verify_token', label: 'Webhook verify token', placeholder: 'pick-any-string',
        hint: 'Used during the Meta subscription handshake.' },
      { key: 'app_secret',   label: 'App secret', placeholder: 'optional but recommended',
        hint: 'From your Meta App → Settings → Basic.' },
    ],
  },
  {
    id: 'facebook', label: 'Facebook', Icon: FacebookIcon,
    desc: 'Receive Facebook Messenger conversations from your Page.',
    realtime: false, configurable: true, webhook: true,
    fields: [
      { key: 'page_id', label: 'Facebook Page ID', placeholder: '1234567890',
        hint: 'Numeric ID of your Page.' },
      { key: 'access_token', label: 'Page access token', placeholder: 'EAA…',
        hint: 'Long-lived Page token with pages_messaging scope.' },
      { key: 'verify_token', label: 'Webhook verify token', placeholder: 'pick-any-string',
        hint: 'Used during the Meta subscription handshake.' },
      { key: 'app_secret',   label: 'App secret', placeholder: 'optional but recommended',
        hint: 'From your Meta App → Settings → Basic.' },
    ],
  },
  {
    id: 'viber', label: 'Viber', Icon: ViberIcon,
    desc: 'Receive customer messages from your Viber bot.',
    realtime: false, configurable: true, webhook: true,
    fields: [
      { key: 'auth_token', label: 'Auth token', placeholder: '4dd…',
        hint: 'Viber Admin Panel → Account info → Authentication token. Webhook URL is registered automatically when you have HTTPS.' },
    ],
  },
  {
    id: 'x', label: 'X (Twitter)', Icon: XIcon,
    desc: 'Receive Direct Messages from your X account.',
    realtime: false, configurable: true, webhook: true,
    fields: [
      { key: 'bearer_token', label: 'OAuth 2.0 Bearer token', placeholder: 'AAAAAAAA…',
        hint: 'X Developer Portal → Project → Keys and Tokens → Bearer Token. Requires Elevated access for DM endpoints.' },
      { key: 'handle',       label: 'Account handle', placeholder: '@yourbrand',
        hint: 'For display only — used to label this integration.' },
      { key: 'app_secret',   label: 'App secret', placeholder: 'optional',
        hint: 'Consumer secret used to verify webhook signatures.' },
    ],
  },
];

const ROW_TILT = {
  maxAngleX: 8, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.10, spread: 40 },
};

// ─── Utils ────────────────────────────────────────────────────────────────────

const fmtTime = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diff = (now - d) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
};

const channelMeta = id => CHANNELS.find(c => c.id === id) || CHANNELS[0];

// ─── Tab Switcher (mirrors Authentication) ────────────────────────────────────

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
    { key: 'chats',    label: 'Chats',    Icon: ChatsCircle },
    { key: 'channels', label: 'Channels', Icon: Plug },
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

// ─── Conversation Folder (Sidebar NavSection-style + Dynamic Block) ───────────

function ConvFolder({ title, count, conversations, selectedId, onSelect, open, onToggle, emptyHint }) {
  const itemsEl = useRef(null);
  const itemEls = useRef({});
  const [hovered, setHovered] = useState(null);
  const [ind, setInd] = useState({ opacity: 0, y: 0, h: 0 });

  const currentKey = hovered ?? (selectedId && conversations.some(c => c.id === selectedId) ? selectedId : null);

  useLayoutEffect(() => {
    const container = itemsEl.current;
    const el = currentKey ? itemEls.current[currentKey] : null;
    if (!container || !el || !open) { setInd(p => ({ ...p, opacity: 0 })); return; }
    setInd({ opacity: 1, y: el.offsetTop, h: el.offsetHeight });
  }, [currentKey, open, conversations.length]);

  return (
    <div className="chat-folder">
      <button type="button" className="chat-folder-header" onClick={onToggle}>
        <CaretDown className={`chat-folder-chevron${open ? ' chat-folder-chevron--open' : ''}`} />
        <span className="chat-folder-label">{title}</span>
        <span className="chat-folder-count">{count}</span>
      </button>
      <div className={`chat-folder-body${open ? ' chat-folder-body--open' : ''}`}>
        <div className="chat-folder-items" ref={itemsEl} onMouseLeave={() => setHovered(null)}>
          <div className="chat-folder-indicator"
            style={{ opacity: ind.opacity, height: `${ind.h}px`, transform: `translateY(${ind.y}px)` }} />
          {conversations.length === 0 ? (
            <div className="chat-folder-empty">{emptyHint}</div>
          ) : conversations.map(c => {
            const meta = channelMeta(c.channel);
            const ChannelIcon = meta.Icon;
            const active = currentKey === c.id;
            return (
              <div key={c.id}
                ref={el => { if (el) itemEls.current[c.id] = el; else delete itemEls.current[c.id]; }}
                className={`chat-conv-row${active ? ' chat-conv-row--current' : ''}`}
                onMouseEnter={() => setHovered(c.id)}
                onClick={() => onSelect(c.id)}
              >
                <div className="chat-conv-avatar">
                  <ChannelIcon size={20} />
                </div>
                <div className="chat-conv-text">
                  <div className="chat-conv-top">
                    <span className="chat-conv-uid">{c.contact_uid}</span>
                    <span className="chat-conv-time">{fmtTime(c.last_message_at)}</span>
                  </div>
                  <div className="chat-conv-bottom">
                    <span className="chat-conv-preview">{c.last_message_preview || '—'}</span>
                    {c.unread_count > 0 && <span className="chat-conv-unread">{c.unread_count}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Message Thread ───────────────────────────────────────────────────────────

function MessageThread({ projectId, conversation, onClosed, onReopened, onSent }) {
  const [messages, setMessages] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [text,     setText]     = useState('');
  const [sending,  setSending]  = useState(false);
  const [err,      setErr]      = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [copied,    setCopied]      = useState(false);
  const scrollRef = useRef(null);
  const pq = `?project_id=${projectId}`;

  useEffect(() => {
    if (!conversation) return;
    let stop = false;
    setLoading(true); setErr('');
    fetch(`${API_BASE}/api/chat/conversations/${conversation.id}/messages${pq}`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => { if (!stop) { setMessages(j.messages || []); setLoading(false); } })
      .catch(() => { if (!stop) { setLoading(false); setErr('Failed to load messages'); } });
    fetch(`${API_BASE}/api/chat/conversations/${conversation.id}/read${pq}`,
          { method: 'POST', credentials: 'include' }).catch(() => {});
    return () => { stop = true; };
  }, [conversation?.id, projectId]);

  // Subscribe to WS events scoped to this thread
  useEffect(() => {
    if (!conversation) return;
    const handler = e => {
      const data = e.detail;
      if (!data) return;
      if (data.type === 'message.created') {
        const cid = data.conversation_id ?? data.conversation?.id;
        if (cid !== conversation.id) return;
        setMessages(prev => prev.some(m => m.id === data.message.id) ? prev : [...prev, data.message]);
      }
    };
    window.addEventListener('chat:event', handler);
    return () => window.removeEventListener('chat:event', handler);
  }, [conversation?.id]);

  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [messages.length, conversation?.id]);

  if (!conversation) {
    return (
      <div className="chat-thread chat-thread--empty">
        <ChatCircleDots size={56} weight="thin" className="chat-thread-empty-icon" />
        <div className="chat-thread-empty-title">Select a conversation</div>
        <div className="chat-thread-empty-desc">Choose a chat from the list to view messages.</div>
      </div>
    );
  }

  const meta = channelMeta(conversation.channel);
  const ChannelIcon = meta.Icon;

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/chat/conversations/${conversation.id}/messages${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      });
      const json = await res.json();
      if (res.ok) {
        setText('');
        setMessages(prev => prev.some(m => m.id === json.message.id) ? prev : [...prev, json.message]);
        onSent?.(conversation.id, t);
      } else {
        setErr(json.detail || 'Failed to send');
      }
    } catch { setErr('Network error'); }
    finally { setSending(false); }
  };

  const close = async () => {
    setActionBusy(true);
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${conversation.id}/close${pq}`,
                  { method: 'POST', credentials: 'include' });
      onClosed?.(conversation.id);
    } finally { setActionBusy(false); }
  };

  const reopen = async () => {
    setActionBusy(true);
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${conversation.id}/reopen${pq}`,
                  { method: 'POST', credentials: 'include' });
      onReopened?.(conversation.id);
    } finally { setActionBusy(false); }
  };

  const copyUid = () => {
    navigator.clipboard.writeText(conversation.contact_uid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="chat-thread">
      <div className="chat-thread-header">
        <div className="chat-thread-avatar">
          <ChannelIcon size={20} />
        </div>
        <div className="chat-thread-id-block">
          <button type="button" className="chat-thread-uid" onClick={copyUid} title="Copy ID">
            {conversation.contact_uid}
            {copied ? <CheckCircle weight="fill" size={13} /> : <Copy size={13} />}
          </button>
          <div className="chat-thread-channel">via {meta.label}</div>
        </div>
        {conversation.is_active ? (
          <button type="button" className="chat-thread-action chat-thread-action--danger"
            onClick={close} disabled={actionBusy}>
            <XCircle size={15} /> Close chat
          </button>
        ) : (
          <button type="button" className="chat-thread-action"
            onClick={reopen} disabled={actionBusy}>
            <ArrowCounterClockwise size={15} /> Reopen
          </button>
        )}
      </div>

      <div className="chat-thread-scroll" ref={scrollRef}>
        {loading ? (
          <div className="chat-thread-loading"><CircleNotch className="chat-spin" size={20} /></div>
        ) : messages.length === 0 ? (
          <div className="chat-thread-empty-msgs">No messages yet.</div>
        ) : messages.map(m => (
          <div key={m.id} className={`chat-msg chat-msg--${m.direction}`}>
            <div className="chat-msg-bubble">
              <div className="chat-msg-text">{m.text}</div>
              <div className="chat-msg-time">{fmtTime(m.created_at)}</div>
            </div>
          </div>
        ))}
      </div>

      {conversation.is_active ? (
        <div className="chat-composer">
          <input type="text" className="chat-composer-input" placeholder="Type a message…"
            value={text} onChange={e => { setText(e.target.value); setErr(''); }}
            onKeyDown={e => e.key === 'Enter' && send()}
            disabled={sending} maxLength={4000} />
          <button type="button" className="chat-composer-send"
            onClick={send} disabled={sending || !text.trim()} aria-label="Send">
            <PaperPlaneRight weight="fill" size={16} />
          </button>
        </div>
      ) : (
        <div className="chat-composer chat-composer--closed">
          This chat is closed. Reopen it to reply.
        </div>
      )}

      {err && <div className="chat-thread-err">{err}</div>}
    </div>
  );
}

// ─── Chat Panel (the WhatsApp-style two-column layout) ────────────────────────

function ChatPanel({ projectId }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [openFolders, setOpenFolders] = useState({ active: true, inactive: false });
  const [filter, setFilter] = useState('');

  const pq = `?project_id=${projectId}`;

  const reload = async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/chat/conversations${pq}`, { credentials: 'include' });
      const json = await res.json();
      setConversations(json.conversations || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, [projectId]);

  // WebSocket subscription
  useEffect(() => {
    const wsBase = API_BASE.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsBase}/api/chat/ws?project_id=${projectId}`);
    ws.onmessage = e => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent('chat:event', { detail: data }));
        if (data.type === 'message.created') {
          const incoming = data.conversation;
          const cid = data.conversation_id ?? incoming?.id;
          if (cid == null) return;
          setConversations(prev => {
            const idx = prev.findIndex(c => c.id === cid);
            // Brand-new conversation: prepend if we have its row, otherwise just skip
            // (the next load() will pick it up).
            if (idx === -1) return incoming ? [incoming, ...prev] : prev;
            const existing = prev[idx];
            const updated  = [...prev];
            updated[idx] = {
              ...existing,
              last_message_at:      data.message?.created_at || existing.last_message_at,
              last_message_preview: data.message?.text?.slice(0, 200) || existing.last_message_preview,
              unread_count: data.message?.direction === 'in' && cid !== selectedId
                              ? (existing.unread_count + 1)
                              : (cid === selectedId ? 0 : existing.unread_count),
              is_active: incoming?.is_active ?? existing.is_active,
            };
            updated.sort((a, b) => (new Date(b.last_message_at || 0)) - (new Date(a.last_message_at || 0)));
            return updated;
          });
        } else if (data.type === 'conversation.closed') {
          setConversations(prev => prev.map(c => c.id === data.conversation_id ? { ...c, is_active: false } : c));
        } else if (data.type === 'conversation.reopened') {
          setConversations(prev => prev.map(c => c.id === data.conversation_id ? { ...c, is_active: true } : c));
        }
      } catch {}
    };
    return () => { try { ws.close(); } catch {} };
  }, [projectId, selectedId]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return conversations;
    return conversations.filter(c =>
      c.contact_uid.toLowerCase().includes(f) ||
      (c.last_message_preview || '').toLowerCase().includes(f)
    );
  }, [conversations, filter]);

  const active   = filtered.filter(c => c.is_active);
  const inactive = filtered.filter(c => !c.is_active);

  const selected = conversations.find(c => c.id === selectedId) || null;

  const handleSelect = id => {
    setSelectedId(id);
    fetch(`${API_BASE}/api/chat/conversations/${id}/read${pq}`,
          { method: 'POST', credentials: 'include' }).catch(() => {});
    setConversations(prev => prev.map(c => c.id === id ? { ...c, unread_count: 0 } : c));
  };

  const handleClosed = id => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, is_active: false } : c));
    setOpenFolders(prev => ({ ...prev, inactive: true }));
  };

  const handleReopened = id => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, is_active: true } : c));
  };

  const handleSent = (id, t) => {
    setConversations(prev => {
      const updated = prev.map(c => c.id === id
        ? { ...c, last_message_at: new Date().toISOString(), last_message_preview: t.slice(0, 200) }
        : c);
      updated.sort((a, b) => (new Date(b.last_message_at || 0)) - (new Date(a.last_message_at || 0)));
      return updated;
    });
  };

  return (
    <div className="chat-shell">
      <aside className="chat-aside">
        <div className="chat-aside-search">
          <input className="crm-input chat-search-input" placeholder="Search…"
            value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <div className="chat-aside-scroll">
          {loading ? (
            <div className="chat-aside-loading"><CircleNotch className="chat-spin" size={20} /></div>
          ) : (
            <>
              <ConvFolder title="Active" count={active.length}
                conversations={active} selectedId={selectedId} onSelect={handleSelect}
                open={openFolders.active}
                onToggle={() => setOpenFolders(p => ({ ...p, active: !p.active }))}
                emptyHint="No active chats yet" />
              <ConvFolder title="Inactive" count={inactive.length}
                conversations={inactive} selectedId={selectedId} onSelect={handleSelect}
                open={openFolders.inactive}
                onToggle={() => setOpenFolders(p => ({ ...p, inactive: !p.inactive }))}
                emptyHint="Closed chats appear here" />
            </>
          )}
        </div>
      </aside>
      <MessageThread projectId={projectId} conversation={selected}
        onClosed={handleClosed} onReopened={handleReopened} onSent={handleSent} />
    </div>
  );
}

// ─── Channel Modal — generic per-channel config form ──────────────────────────

function ChannelModal({ channel, projectId, integration, onClose, onSaved }) {
  const meta = channelMeta(channel);
  const Icon = meta.Icon;
  const fields = meta.fields || [];

  // separate state object for the form values (one key per field)
  const [values,   setValues]   = useState(() =>
    Object.fromEntries(fields.map(f => [f.key, '']))
  );
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');
  const [toast,    setToast]    = useState('');
  const [removing, setRemoving] = useState(false);
  const [savedExtra, setSavedExtra] = useState(null);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const showToast = msg => {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  };

  const required = fields.filter(f => !f.key.endsWith('app_secret'));
  const canSave  = required.every(f => (values[f.key] || '').trim());

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const config = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, (v || '').trim()])
                              .filter(([, v]) => v)
      );
      const res  = await fetch(`${API_BASE}/api/chat/integrations?project_id=${projectId}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, config, is_active: true }),
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Connected.');
        setValues(Object.fromEntries(fields.map(f => [f.key, ''])));
        setSavedExtra(json);
        onSaved?.({ channel, bot_username: json.bot_username });
      } else {
        setErr(json.detail || 'Failed to save');
      }
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await fetch(`${API_BASE}/api/chat/integrations/${channel}?project_id=${projectId}`,
                  { method: 'DELETE', credentials: 'include' });
      onSaved?.({ channel, bot_username: null, removed: true });
      onClose();
    } finally { setRemoving(false); }
  };

  // Resolve webhook hint: either freshly-returned from POST or computed from API_BASE
  const webhookUrl = meta.webhook
    ? (savedExtra?.webhook_url || `${API_BASE}/api/chat/webhook/${channel}/${projectId}`)
    : null;

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div className="auth-modal-icon-wrap">
              <Icon size={24} />
            </div>
            <div>
              <div className="auth-modal-title">{meta.label}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">{meta.desc}</span>
                {integration && (
                  <span className="auth-badge-enabled">
                    <CheckCircle weight="fill" size={11} /> Connected
                  </span>
                )}
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          <div className="chat-modal-form">
            {integration?.bot_username && (
              <div className="chat-modal-info">
                Connected as <strong>{integration.bot_username}</strong>
              </div>
            )}

            {webhookUrl && (
              <div className="chat-modal-webhook">
                <div className="chat-modal-webhook-title">Webhook URL</div>
                <div className="chat-modal-webhook-url">{webhookUrl}</div>
                <div className="chat-modal-webhook-hint">
                  Paste this into the platform's webhook settings.
                  Requires public HTTPS — works in production, not on localhost.
                </div>
              </div>
            )}

            {fields.length === 0 && !integration && (
              <div className="chat-modal-empty">
                <div className="chat-modal-empty-title">No setup required</div>
                <div className="chat-modal-empty-desc">
                  Web Chat uses your project's existing API credentials. Click Connect
                  and the support widget will appear on every page of your storefront.
                </div>
              </div>
            )}

            {fields.map(f => (
              <div key={f.key} className="chat-modal-field">
                <label className="chat-modal-label">{f.label}</label>
                <input className="crm-input" placeholder={f.placeholder || ''}
                  value={values[f.key] || ''}
                  onChange={e => { setValues(v => ({ ...v, [f.key]: e.target.value })); setErr(''); }}
                  autoComplete="off" />
                {f.hint && <p className="chat-modal-hint">{f.hint}</p>}
              </div>
            ))}

            {err && <p className="auth-msg auth-msg--err">{err}</p>}

            <div className="auth-actions">
              <button className="crm-submit-btn" onClick={save}
                disabled={saving || !canSave} type="button">
                {saving ? 'Saving…' : (integration ? 'Update' : 'Connect')}
              </button>
              {integration && (
                <button className="auth-btn-danger" onClick={remove}
                  disabled={removing} type="button">
                  <Trash size={13} /> {removing ? 'Removing…' : 'Disconnect'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </div>,
    document.body
  );
}

// ─── Channel Row & Disabled Row (mirrors Authentication ProviderRow) ──────────

function ChannelRow({ channel, integration, onClick, first, last }) {
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, false);
  const Icon = channel.Icon;
  const cls = [
    'auth-provider-row',
    first && 'auth-provider-row--first',
    last  && 'auth-provider-row--last',
  ].filter(Boolean).join(' ');

  const desc = integration?.bot_username
    ? `Connected as ${integration.bot_username}`
    : channel.desc;

  return (
    <div ref={ref} className={cls} onClick={onClick} {...handlers}>
      <div ref={glossRef} className="auth-provider-gloss" />
      <div className="auth-provider-icon-wrap">
        <Icon className="auth-provider-icon" />
      </div>
      <span className="auth-provider-name">{channel.label}</span>
      <span className="auth-provider-desc">{desc}</span>
      {integration
        ? <span className="auth-badge-enabled"><CheckCircle weight="fill" size={11} /> Connected</span>
        : <span className="auth-badge-disabled">{channel.realtime ? 'Real-time' : 'Webhook'}</span>}
      <CaretRight className="auth-provider-chevron" />
    </div>
  );
}

// ─── Channels Panel ───────────────────────────────────────────────────────────

function ChannelsPanel({ projectId, onIntegrationsChange }) {
  const [integrations, setIntegrations] = useState([]);
  const [modal, setModal] = useState(null);

  const reload = async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/chat/integrations?project_id=${projectId}`,
                              { credentials: 'include' });
      const json = await res.json();
      setIntegrations(json.integrations || []);
      onIntegrationsChange?.(json.integrations || []);
    } catch {}
  };
  useEffect(() => { reload(); }, [projectId]);

  const byChannel = id => integrations.find(i => i.channel === id) || null;

  return (
    <>
      <h1 className="crm-page-title">Channels</h1>
      <p className="auth-page-subtitle">
        Connect messaging channels to receive customer messages right inside your CRM.
      </p>

      <div className="auth-providers-list">
        {CHANNELS.map((channel, idx) => (
          <ChannelRow key={channel.id} channel={channel}
            integration={byChannel(channel.id)}
            first={idx === 0} last={idx === CHANNELS.length - 1}
            onClick={() => setModal(channel.id)} />
        ))}
      </div>

      {modal && (
        <ChannelModal channel={modal} projectId={projectId}
          integration={byChannel(modal)}
          onClose={() => setModal(null)}
          onSaved={() => { reload(); }} />
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Chat() {
  const { projectId } = useOutletContext();
  const [tab, setTab] = useState('chats');

  return (
    <>
      <div className="auth-tab-wrapper">
        <TabSwitcher tab={tab} setTab={setTab} />
      </div>

      <div className="auth-page chat-page">
        {tab === 'chats' ? (
          <ChatPanel projectId={projectId} />
        ) : (
          <ChannelsPanel projectId={projectId} />
        )}
      </div>
    </>
  );
}
