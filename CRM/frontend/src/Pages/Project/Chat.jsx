import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plug, X, XCircle, CaretRight, CaretLeft, CaretDown, CheckCircle, ChatCircleDots,
  PaperPlaneRight, ChatsCircle, ArrowCounterClockwise,
  Copy, Trash, CircleNotch, MagnifyingGlass, FileText, Microphone, Play,
  Pause, DownloadSimple, MagnifyingGlassPlus, MagnifyingGlassMinus, Eye,
  PencilSimple, Envelope, Warning,
} from '@phosphor-icons/react';
import { Icon as IconifyIcon } from '@iconify/react';
import { useTabParam } from '../../Utils/useTabParam.js';
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
const ViberIcon     = iconifyChannel('simple-icons:viber', '#7360F2');
// Mirror the Auth Providers Email row — same Phosphor Envelope, same accent
// blue. The channel is "email" not "Gmail specifically", so a generic envelope
// reads better than a vendor logo.
const EmailIcon     = ({ size = 22, ...rest }) => (
  <Envelope size={size} color="#0071E3" weight="regular" {...rest} />
);

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
  {
    // Reuses the merchant's verified email domain from Authentication →
    // Email (DKIM-signed). Postfix on the SES VPS pipes parsed mail to a
    // backend webhook which routes by destination domain → project. Outbound
    // replies go back through SES with In-Reply-To/References for threading.
    id: 'email', label: 'Email', Icon: EmailIcon,
    desc: 'Receive customer emails sent to any address @your-verified-domain. Replies are threaded.',
    realtime: false, configurable: true, webhook: true,
    fields: [
      // `domain` is locked to the verified Auth Providers domain (handled
      // specially in ChannelModal — merchant can't type to spy on others).
      { key: 'domain', label: 'Verified email domain', placeholder: 'support.merchant-store.com',
        hint: 'Must be a domain you\'ve already verified in Authentication → Email (DKIM/SPF/DMARC). Any address at this domain will be routed to this chat.' },
      // Reply identity — independent from the Auth Providers OTP from-address
      // so chats can come from support@ while OTPs come from noreply@.
      { key: 'reply_local', label: 'Reply-from address', placeholder: 'support',
        hint: 'Local part only. Customer replies will land in the same chat regardless of this — this only controls what they see in the From field.' },
      { key: 'reply_name',  label: 'Reply-from display name', placeholder: 'Acme Support',
        hint: 'Shown as the sender name in the customer\'s inbox. Leave blank to reuse the Auth Providers display name.' },
    ],
  },
];

const ROW_TILT = {
  maxAngleX: 8, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.10, spread: 40 },
};

// i18n helpers — the CHANNELS catalogue keeps English strings as fallback
// defaults; these resolve the localized copy at render time.
const channelDesc  = (t, id, fallback) =>
  t(`comms.chat.channel.${id}.desc`, { defaultValue: fallback });
const fieldLabel   = (t, id, key, fallback) =>
  t(`comms.chat.channel.${id}.field.${key}.label`, { defaultValue: fallback });
const fieldHint    = (t, id, key, fallback) =>
  t(`comms.chat.channel.${id}.field.${key}.hint`, { defaultValue: fallback });

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

// ─── Conversation Folder (Sidebar NavSection-style + Dynamic Block) ───────────

function ConvFolder({ title, count, conversations, selectedId, onSelect, open, onToggle,
                       emptyHint, onCloseConv, onReopenConv, onMarkRead, showToast }) {
  return (
    <div className="chat-folder">
      <button type="button" className="chat-folder-header" onClick={onToggle}>
        <CaretDown className={`chat-folder-chevron${open ? ' chat-folder-chevron--open' : ''}`} />
        <span className="chat-folder-label">{title}</span>
        <span className="chat-folder-count">{count}</span>
      </button>
      <div className={`chat-folder-body${open ? ' chat-folder-body--open' : ''}`}>
        <div className="chat-folder-items">
          {conversations.length === 0 ? (
            <div className="chat-folder-empty">{emptyHint}</div>
          ) : conversations.map(c => (
            <ConvRow key={c.id} c={c} active={selectedId === c.id} onSelect={onSelect}
              onCloseConv={onCloseConv} onReopenConv={onReopenConv}
              onMarkRead={onMarkRead} showToast={showToast} />
          ))}
        </div>
      </div>
    </div>
  );
}

// One conversation row — InteractiveSection 3D tilt (Products-row style) + right-click context menu.
const ROW_TILT_CONV = {
  maxAngleX: 6, maxAngleY: 3, lerp: 0.05, lerpOut: 0.07,
  scale: 1.03, perspective: 900,
  gloss: { opacity: 0.10, spread: 40 },
};

function ConvRow({ c, active, onSelect, onCloseConv, onReopenConv, onMarkRead, showToast }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(null);
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT_CONV, !!menu);
  const meta = channelMeta(c.channel);
  const ChannelIcon = meta.Icon;

  const items = [
    ...(c.unread_count > 0 ? [{ icon: Eye, label: t('comms.chat.markAsRead'), onClick: () => onMarkRead?.(c.id) }] : []),
    { icon: Copy, label: t('comms.chat.copyId'), onClick: () => {
        navigator.clipboard?.writeText(c.contact_uid);
        showToast?.(t('comms.chat.idCopied'));
      } },
    'sep',
    c.is_active
      ? { icon: XCircle, label: t('comms.chat.closeChat'),  onClick: () => onCloseConv?.(c.id),  danger: true }
      : { icon: ArrowCounterClockwise, label: t('comms.chat.reopenChat'), onClick: () => onReopenConv?.(c.id) },
  ];

  return (
    <>
      <div ref={ref}
        className={`chat-conv-row${active ? ' chat-conv-row--current' : ''}`}
        onClick={() => onSelect(c.id)}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
        {...handlers}>
        <div ref={glossRef} className="chat-conv-gloss" />
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
      {menu && <ContextMenu pos={menu} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}

// Generic right-click menu — items: [{ icon, label, onClick, danger? }, ...].
function ContextMenu({ pos, items, onClose }) {
  useEffect(() => {
    const onKey   = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown  = (e) => { if (!e.target.closest?.('.chat-ctx-menu')) onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  // Clamp inside viewport.
  const margin = 8;
  const width  = 200;
  const height = 30 + items.length * 36;
  const left = Math.max(margin, Math.min(pos.x, window.innerWidth  - width  - margin));
  const top  = Math.max(margin, Math.min(pos.y, window.innerHeight - height - margin));

  return createPortal(
    <div className="org-card-dropdown chat-ctx-menu"
      style={{ top, left, minWidth: width }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it === 'sep'
        ? <div key={`sep-${i}`} className="org-card-dropdown-sep" />
        : (
          <button key={i} type="button"
            className={`org-card-dropdown-item${it.danger ? ' org-card-dropdown-item--danger' : ''}`}
            onClick={() => { it.onClick(); onClose(); }}>
            <it.icon weight="bold" className="org-card-dropdown-icon" />
            {it.label}
          </button>
        )
      )}
    </div>,
    document.body,
  );
}

// Deterministic pseudo-random waveform — 32 bar heights (15..100) seeded by msgId+idx so each voice msg gets a stable visual.
function generateWaveform(seed) {
  const bars = 32;
  const out = new Array(bars);
  let s = (seed || 1) >>> 0;
  for (let i = 0; i < bars; i++) {
    s = (s * 9301 + 49297) % 233280;
    out[i] = 15 + Math.floor((s / 233280) * 85);
  }
  return out;
}

// Instagram-style voice/audio player — purple gradient pill with play button + waveform + duration. Bars fill white as audio plays.
function VoicePlayer({ src, duration, msgId, idx }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);   // 0..1
  const [actualDur, setActualDur] = useState(duration || 0);
  const audioRef = useRef(null);
  const bars = useMemo(() => generateWaveform((msgId || 0) * 31 + (idx || 0)), [msgId, idx]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onMeta = () => { if (a.duration && !duration) setActualDur(a.duration); };
    const onEnd  = () => { setPlaying(false); setProgress(0); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
    };
  }, [src, duration]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().catch(() => {}); setPlaying(true); }
    else          { a.pause();                setPlaying(false); }
  };

  const seek = (e) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    a.currentTime = Math.max(0, Math.min(a.duration, pct * a.duration));
  };

  const fmt = (sec) => {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const remaining = playing && actualDur ? actualDur - actualDur * progress : actualDur;

  return (
    <div className="chat-voice">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button type="button" className="chat-voice-btn" onClick={toggle}
              aria-label={playing ? t('comms.chat.pause') : t('comms.chat.play')}>
        {playing ? <Pause weight="fill" size={16} /> : <Play weight="fill" size={16} />}
      </button>
      <div className="chat-voice-bars" onClick={seek}>
        {bars.map((h, i) => {
          const filled = (i / bars.length) <= progress;
          return (
            <span key={i}
              className={`chat-voice-bar${filled ? ' chat-voice-bar--filled' : ''}`}
              style={{ height: `${h}%` }} />
          );
        })}
      </div>
      <span className="chat-voice-time">{fmt(remaining)}</span>
    </div>
  );
}

// WhatsApp/Telegram-style image lightbox — wheel to zoom, drag to pan, download/close buttons.
function ImageLightbox({ src, alt, filename, onClose }) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const [pan,   setPan]   = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onWheel = (e) => {
    e.preventDefault();
    setScale(s => Math.max(0.5, Math.min(5, s - e.deltaY * 0.002)));
  };

  const onMouseDown = (e) => {
    if (scale <= 1) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    setPan({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) });
  };
  const onMouseUp = () => { dragRef.current = null; };

  const downloadAs = async (ext) => {
    try {
      const r = await fetch(src);
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (filename || `image.${ext}`).replace(/\.[^.]+$/, '') + `.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {}
  };

  return createPortal(
    <div className="chat-lightbox"
      onMouseDown={(e) => e.target.classList.contains('chat-lightbox') && onClose()}
      onWheel={onWheel}>
      <div className="chat-lightbox-toolbar" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setScale(s => Math.max(0.5, s - 0.25))} title={t('comms.chat.zoomOut')}>
          <MagnifyingGlassMinus weight="bold" size={18} />
        </button>
        <span className="chat-lightbox-zoom">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => setScale(s => Math.min(5, s + 0.25))} title={t('comms.chat.zoomIn')}>
          <MagnifyingGlassPlus weight="bold" size={18} />
        </button>
        <button type="button" onClick={() => downloadAs('png')} title={t('comms.chat.downloadPng')}>
          <DownloadSimple weight="bold" size={18} /> PNG
        </button>
        <button type="button" onClick={onClose} title={t('comms.chat.close')} className="chat-lightbox-close">
          <X weight="bold" size={18} />
        </button>
      </div>
      <img src={src} alt={alt || ''}
        className="chat-lightbox-img"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          cursor: scale > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'zoom-in',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={(e) => { if (scale === 1) { setScale(2); e.stopPropagation(); } }} />
    </div>,
    document.body,
  );
}

// Backend always sets att.url — either direct CDN (Discord/Meta/Viber) or a signed CRM proxy URL (Telegram/WhatsApp/Email).

// Session-wide cache of media URLs that failed to load. The realtime poller re-renders
// the message list every few seconds; failed responses are NOT HTTP-cached, so without
// this every broken attachment would re-hit the backend on every render (and each
// Telegram/WhatsApp proxy miss re-calls the external API — brutal at scale). Once a URL
// lands here we render a static placeholder and never request it again this session.
const _failedMedia = new Set();

function AttachmentItem({ msg, idx, att, onImageClick }) {
  const { t } = useTranslation();
  const src = att.url;
  const [failed, setFailed] = useState(() => !!src && _failedMedia.has(src));
  if (!src) return null;

  const markFailed = () => { _failedMedia.add(src); setFailed(true); };

  if (failed) {
    // Broken/unavailable media — render a static placeholder, issue no further requests.
    return (
      <div className="chat-att chat-att--file" style={{ opacity: 0.55 }} title={att.filename || ''}>
        <FileText size={20} weight="duotone" />
        <span className="chat-att-name">{att.filename || t('comms.chat.attachment')}</span>
      </div>
    );
  }

  if (att.type === 'image') {
    return (
      <button type="button" className="chat-att chat-att--image"
        onClick={() => onImageClick?.(src, att.filename)}>
        <img src={src} alt={att.filename || t('comms.chat.image')} loading="lazy" onError={markFailed} />
      </button>
    );
  }
  if (att.type === 'video') {
    return <video controls preload="metadata" className="chat-att chat-att--video"
                  poster={att.thumb || undefined} src={src} onError={markFailed} />;
  }
  if (att.type === 'voice' || att.type === 'audio') {
    return <VoicePlayer src={src} duration={att.duration} msgId={msg.id} idx={idx} />;
  }
  // Files / unknown — download link with icon + filename + size.
  const sizeKb = att.size ? `${Math.round(att.size / 1024)} KB` : '';
  return (
    <a href={src} target="_blank" rel="noreferrer" download={att.filename || true}
       className="chat-att chat-att--file">
      <FileText size={20} weight="duotone" />
      <span className="chat-att-name">{att.filename || t('comms.chat.attachment')}</span>
      {sizeKb && <span className="chat-att-size">{sizeKb}</span>}
      <DownloadSimple size={14} />
    </a>
  );
}

function MessageAttachments({ msg, onImageClick }) {
  const atts = msg.attachments || [];
  if (atts.length === 0) return null;
  return (
    <div className="chat-msg-attachments">
      {atts.map((a, i) => <AttachmentItem key={i} msg={msg} idx={i} att={a} onImageClick={onImageClick} />)}
    </div>
  );
}

// One message bubble — handles its own right-click menu (Copy/Download/Delete).
function MessageBubble({ msg, onImageClick, onDelete, onDownloadPng, showToast }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(null);

  const firstImg = (msg.attachments || []).find(a => a.type === 'image');
  const items = [
    ...(msg.text ? [{
      icon: Copy, label: t('comms.chat.copyText'), onClick: () => {
        navigator.clipboard?.writeText(msg.text);
        showToast?.(t('comms.chat.copied'));
      }
    }] : []),
    ...(firstImg ? [{
      icon: DownloadSimple, label: t('comms.chat.downloadPng'),
      onClick: () => onDownloadPng?.(firstImg.url, firstImg.filename),
    }] : []),
    ...(msg.attachments?.length ? [{
      icon: DownloadSimple, label: t('comms.chat.openOriginal'),
      onClick: () => window.open(msg.attachments[0].url, '_blank'),
    }] : []),
    'sep',
    { icon: Trash, label: t('common.delete'), onClick: () => onDelete?.(msg.id), danger: true },
  ];

  return (
    <>
      <div className={`chat-msg chat-msg--${msg.direction}`}>
        <div className="chat-msg-bubble"
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
          <MessageAttachments msg={msg} onImageClick={onImageClick} />
          {msg.text && <div className="chat-msg-text">{msg.text}</div>}
          <div className="chat-msg-time">{fmtTime(msg.created_at)}</div>
        </div>
      </div>
      {menu && <ContextMenu pos={menu} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}

// ─── Message Thread ───────────────────────────────────────────────────────────

function MessageThread({ projectId, conversation, onClosed, onReopened, onSent, showToast, onBack }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [text,     setText]     = useState('');
  const [sending,  setSending]  = useState(false);
  const [err,      setErr]      = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [copied,    setCopied]      = useState(false);
  const [lightbox,  setLightbox]    = useState(null);   // { src, filename }
  const scrollRef = useRef(null);
  const pq = `?project_id=${projectId}`;

  useEffect(() => {
    if (!conversation) return;
    let stop = false;
    setLoading(true); setErr('');
    fetch(`${API_BASE}/api/chat/conversations/${conversation.id}/messages${pq}`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => { if (!stop) { setMessages(j.messages || []); setLoading(false); } })
      .catch(() => { if (!stop) { setLoading(false); setErr(t('comms.chat.failedLoad')); } });
    fetch(`${API_BASE}/api/chat/conversations/${conversation.id}/read${pq}`,
          { method: 'POST', credentials: 'include' }).catch(() => {});
    return () => { stop = true; };
  }, [conversation?.id, projectId]);

  // Subscribe to WS events scoped to this thread (created + deleted).
  useEffect(() => {
    if (!conversation) return;
    const handler = e => {
      const data = e.detail;
      if (!data) return;
      if (data.type === 'message.created') {
        const cid = data.conversation_id ?? data.conversation?.id;
        if (cid !== conversation.id) return;
        setMessages(prev => prev.some(m => m.id === data.message.id) ? prev : [...prev, data.message]);
      } else if (data.type === 'message.deleted') {
        if (data.conversation_id !== conversation.id) return;
        setMessages(prev => prev.filter(m => m.id !== data.message_id));
      }
    };
    window.addEventListener('chat:event', handler);
    return () => window.removeEventListener('chat:event', handler);
  }, [conversation?.id]);

  const deleteMessage = async (msgId) => {
    if (!confirm(t('comms.chat.deleteMsgConfirm'))) return;
    try {
      const r = await fetch(`${API_BASE}/api/chat/messages/${msgId}${pq}`,
                            { method: 'DELETE', credentials: 'include' });
      if (r.ok) setMessages(prev => prev.filter(m => m.id !== msgId));
      else      showToast?.(t('comms.chat.failedDelete'));
    } catch { showToast?.(t('common.networkError')); }
  };

  const downloadImageAsPng = async (src, filename) => {
    try {
      const blob = await (await fetch(src)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (filename || 'image').replace(/\.[^.]+$/, '') + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch { showToast?.(t('comms.chat.downloadFailed')); }
  };

  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [messages.length, conversation?.id]);

  if (!conversation) {
    return (
      <div className="chat-thread chat-thread--empty">
        <ChatCircleDots size={56} weight="thin" className="chat-thread-empty-icon" />
        <div className="chat-thread-empty-title">{t('comms.chat.selectConversation')}</div>
        <div className="chat-thread-empty-desc">{t('comms.chat.selectConversationDesc')}</div>
      </div>
    );
  }

  const meta = channelMeta(conversation.channel);
  const ChannelIcon = meta.Icon;

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setErr('');
    try {
      const res  = await fetch(`${API_BASE}/api/chat/conversations/${conversation.id}/messages${pq}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body }),
      });
      const json = await res.json();
      if (res.ok) {
        setText('');
        setMessages(prev => prev.some(m => m.id === json.message.id) ? prev : [...prev, json.message]);
        onSent?.(conversation.id, body);
      } else {
        setErr(json.detail || t('comms.chat.failedSend'));
      }
    } catch { setErr(t('common.networkError')); }
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
        {/* Mobile-only back arrow — returns to the conversation list (master).
            CSS hides this on desktop (≥768px) since both panels are visible. */}
        {onBack && (
          <button type="button" className="chat-thread-back"
                  onClick={onBack} aria-label={t('common.back', 'Back')}>
            <CaretLeft size={20} weight="bold" />
          </button>
        )}
        <div className="chat-thread-avatar">
          <ChannelIcon size={20} />
        </div>
        <div className="chat-thread-id-block">
          <button type="button" className="chat-thread-uid" onClick={copyUid} title={t('comms.chat.copyId')}>
            {conversation.contact_uid}
            {copied ? <CheckCircle weight="fill" size={13} /> : <Copy size={13} />}
          </button>
          <div className="chat-thread-channel">{t('comms.chat.via', { channel: meta.label })}</div>
        </div>
        {conversation.is_active ? (
          <button type="button" className="chat-thread-action chat-thread-action--danger"
            onClick={close} disabled={actionBusy}>
            <XCircle size={15} /> {t('comms.chat.closeChat')}
          </button>
        ) : (
          <button type="button" className="chat-thread-action"
            onClick={reopen} disabled={actionBusy}>
            <ArrowCounterClockwise size={15} /> {t('comms.chat.reopen')}
          </button>
        )}
      </div>

      <div className="chat-thread-scroll" ref={scrollRef}>
        {loading ? (
          <div className="chat-thread-loading"><CircleNotch className="chat-spin" size={20} /></div>
        ) : messages.length === 0 ? (
          <div className="chat-thread-empty-msgs">{t('comms.chat.noMessages')}</div>
        ) : messages.map(m => (
          <MessageBubble key={m.id} msg={m}
            onImageClick={(src, filename) => setLightbox({ src, filename })}
            onDelete={deleteMessage}
            onDownloadPng={downloadImageAsPng}
            showToast={showToast} />
        ))}
      </div>

      {conversation.is_active ? (
        <div className="chat-composer">
          <input type="text" className="chat-composer-input" placeholder={t('comms.chat.typeMessage')}
            value={text} onChange={e => { setText(e.target.value); setErr(''); }}
            onKeyDown={e => e.key === 'Enter' && send()}
            disabled={sending} maxLength={4000} />
          <button type="button" className="chat-composer-send"
            onClick={send} disabled={sending || !text.trim()} aria-label={t('comms.chat.send')}>
            <PaperPlaneRight weight="fill" size={16} />
          </button>
        </div>
      ) : (
        <div className="chat-composer chat-composer--closed">
          {t('comms.chat.chatClosed')}
        </div>
      )}

      {err && <div className="chat-thread-err">{err}</div>}

      {lightbox && (
        <ImageLightbox src={lightbox.src} filename={lightbox.filename}
          onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

// ─── Chat Panel (the WhatsApp-style two-column layout) ────────────────────────

function ChatPanel({ projectId }) {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  // Mobile master-detail: when true, the .chat-shell flips to show only the
  // thread (list hidden). Set when a conversation is tapped, cleared by the
  // back arrow in the thread header. Desktop ignores this — CSS at ≥768px
  // always shows both panels regardless of the modifier class.
  const [mobileShowingThread, setMobileShowingThread] = useState(false);
  const [openFolders, setOpenFolders] = useState({ active: true, inactive: false });
  const [filter, setFilter] = useState('');
  const [toast, setToast] = useState('');

  const pq = `?project_id=${projectId}`;
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); };

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
    setMobileShowingThread(true);   // mobile: flip to thread view
    fetch(`${API_BASE}/api/chat/conversations/${id}/read${pq}`,
          { method: 'POST', credentials: 'include' }).catch(() => {});
    setConversations(prev => prev.map(c => c.id === id ? { ...c, unread_count: 0 } : c));
  };

  // Mobile back arrow in the thread header → return to the conversation list.
  // Keeps selectedId so when desktop user resizes back to wide, the previously
  // selected conversation is still highlighted in the list.
  const handleBackToList = () => setMobileShowingThread(false);

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

  // Context-menu actions on a conversation row.
  const closeConv = async (id) => {
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${id}/close${pq}`,
                  { method: 'POST', credentials: 'include' });
      handleClosed(id);
      showToast(t('comms.chat.chatClosedToast'));
    } catch { showToast(t('comms.chat.failed')); }
  };
  const reopenConv = async (id) => {
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${id}/reopen${pq}`,
                  { method: 'POST', credentials: 'include' });
      handleReopened(id);
      showToast(t('comms.chat.chatReopenedToast'));
    } catch { showToast(t('comms.chat.failed')); }
  };
  const markRead = async (id) => {
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${id}/read${pq}`,
                  { method: 'POST', credentials: 'include' });
      setConversations(prev => prev.map(c => c.id === id ? { ...c, unread_count: 0 } : c));
    } catch {}
  };

  return (
    <>
      <h1 className="crm-page-title">{t('comms.chat.pageTitle')}</h1>
      <div className={`chat-shell${mobileShowingThread ? ' chat-shell--show-thread' : ''}`}>
        <aside className="chat-aside">
          <div className="chat-aside-search">
            <MagnifyingGlass className="chat-search-icon" weight="bold" />
            <input className="chat-search-input" placeholder={t('comms.chat.searchConversations')}
              value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
          <div className="chat-aside-scroll">
            {loading ? (
              <div className="chat-aside-loading"><CircleNotch className="chat-spin" size={20} /></div>
            ) : (
              <>
                <ConvFolder title={t('comms.chat.active')} count={active.length}
                  conversations={active} selectedId={selectedId} onSelect={handleSelect}
                  open={openFolders.active}
                  onToggle={() => setOpenFolders(p => ({ ...p, active: !p.active }))}
                  emptyHint={t('comms.chat.noActiveChats')}
                  onCloseConv={closeConv} onReopenConv={reopenConv}
                  onMarkRead={markRead} showToast={showToast} />
                <ConvFolder title={t('comms.chat.inactive')} count={inactive.length}
                  conversations={inactive} selectedId={selectedId} onSelect={handleSelect}
                  open={openFolders.inactive}
                  onToggle={() => setOpenFolders(p => ({ ...p, inactive: !p.inactive }))}
                  emptyHint={t('comms.chat.closedChatsAppear')}
                  onCloseConv={closeConv} onReopenConv={reopenConv}
                  onMarkRead={markRead} showToast={showToast} />
              </>
            )}
          </div>
        </aside>
        <MessageThread projectId={projectId} conversation={selected}
          onClosed={handleClosed} onReopened={handleReopened} onSent={handleSent}
          onBack={handleBackToList}
          showToast={showToast} />
      </div>
      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}

// ─── Channel Modal — generic per-channel config form ──────────────────────────

function ChannelModal({ channel, projectId, integration, onClose, onSaved }) {
  const { t } = useTranslation();
  const meta = channelMeta(channel);
  const Icon = meta.Icon;
  const fields = meta.fields || [];
  const isEmail = channel === 'email';

  // separate state object for the form values (one key per field)
  const [values,   setValues]   = useState(() =>
    Object.fromEntries(fields.map(f => [f.key, '']))
  );
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');
  const [toast,    setToast]    = useState('');
  const [removing, setRemoving] = useState(false);
  const [savedExtra, setSavedExtra] = useState(null);

  // Email-channel only: fetch the project's verified email domain so we can
  // (a) lock the domain field to that value (prevents merchant from typing a
  //     domain they don't own to spy on someone else's mail), and
  // (b) show a warning + deep-link to Authentication when no domain is set.
  // Also fetch any existing chat-integration row so we can pre-fill the
  // editable reply_local / reply_name fields.
  const [emailDomainState, setEmailDomainState] = useState(null);  // null = loading
  useEffect(() => {
    if (!isEmail) return;
    let cancelled = false;
    (async () => {
      try {
        const [domRes, intRes] = await Promise.all([
          fetch(`${API_BASE}/api/email-domain?project_id=${projectId}`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/chat/integrations/email?project_id=${projectId}`, { credentials: 'include' }),
        ]);
        const dom = domRes.ok ? await domRes.json() : { configured: false };
        const int = intRes.ok ? await intRes.json() : { configured: false, config: {} };
        if (cancelled) return;
        setEmailDomainState(dom);
        // Pre-fill all 3 fields from existing row if present; otherwise just
        // lock the domain to the verified one.
        const existing = int?.config || {};
        setValues(v => ({
          ...v,
          domain:      existing.domain      || dom.domain || '',
          reply_local: existing.reply_local || '',
          reply_name:  existing.reply_name  || '',
        }));
      } catch {
        if (!cancelled) setEmailDomainState({ configured: false });
      }
    })();
    return () => { cancelled = true; };
  }, [isEmail, projectId, integration]);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const showToast = msg => {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  };

  // Fields the merchant MUST fill before we can save. `app_secret` is
  // optional for Meta webhook channels; `reply_local` + `reply_name` are
  // optional polish for the Email channel (fall back to Auth Providers
  // defaults when blank).
  const OPTIONAL_KEYS = new Set(['app_secret', 'reply_local', 'reply_name']);
  const required = fields.filter(f => !OPTIONAL_KEYS.has(f.key));
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
        showToast(t('comms.chat.connectedToast'));
        setValues(Object.fromEntries(fields.map(f => [f.key, ''])));
        setSavedExtra(json);
        onSaved?.({ channel, bot_username: json.bot_username });
      } else {
        setErr(json.detail || t('comms.chat.failedSave'));
      }
    } catch { setErr(t('common.networkError')); }
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

  // Resolve webhook hint: either freshly-returned from POST or computed from API_BASE.
  // Email channel is special — receiving happens via Postfix MX, not an HTTPS
  // webhook the merchant pastes anywhere; we show DNS instructions instead.
  const webhookUrl = (meta.webhook && !isEmail)
    ? (savedExtra?.webhook_url || `${API_BASE}/api/chat/webhook/${channel}/${projectId}`)
    : null;
  const emailDomain = isEmail
    ? (emailDomainState?.configured && emailDomainState?.dkim_ok ? emailDomainState.domain : '')
    : '';
  // Domain isn't ready for Email channel until Auth Providers → Email shows a
  // verified domain. Without this, the Connect button writes nothing useful.
  const emailReady = !isEmail || (emailDomainState?.configured && emailDomainState?.dkim_ok);
  const emailLoading = isEmail && emailDomainState === null;

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
                <span className="auth-modal-subtitle">{channelDesc(t, meta.id, meta.desc)}</span>
                {integration && (
                  <span className="auth-badge-enabled">
                    <CheckCircle weight="fill" size={11} /> {t('comms.chat.connected')}
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
                {t('comms.chat.connectedAs')} <strong>{integration.bot_username}</strong>
              </div>
            )}

            {webhookUrl && (
              <div className="chat-modal-webhook">
                <div className="chat-modal-webhook-title">{t('comms.chat.webhookUrl')}</div>
                <div className="chat-modal-webhook-url">{webhookUrl}</div>
                <div className="chat-modal-webhook-hint">
                  {t('comms.chat.webhookHint')}
                </div>
              </div>
            )}

            {isEmail && emailLoading && (
              <p className="chat-modal-hint">{t('comms.chat.checkingDomain')}</p>
            )}

            {isEmail && !emailLoading && !emailReady && (
              <div className="chat-modal-warn">
                <Warning weight="fill" size={16} />
                <div>
                  <div className="chat-modal-warn-title">{t('comms.chat.noVerifiedDomain')}</div>
                  <div className="chat-modal-warn-body">
                    {t('comms.chat.noVerifiedDomainBody1')} <a href={`/project/${projectId}/authentication`}>{t('comms.chat.authEmailLink')}</a> {t('comms.chat.noVerifiedDomainBody2')}
                  </div>
                </div>
              </div>
            )}

            {isEmail && emailReady && (
              <div className="chat-modal-webhook">
                <div className="chat-modal-webhook-title">{t('comms.chat.dnsMxTitle')}</div>
                <div className="chat-modal-webhook-url">
                  {emailDomain}.&nbsp;&nbsp;MX&nbsp;&nbsp;10&nbsp;&nbsp;mail.tortacrm.com.
                </div>
                <div className="chat-modal-webhook-hint">
                  {t('comms.chat.dnsMxHint1')} (<code>support@</code>,
                  <code> hello@</code>, <code>info@</code>, …) {t('comms.chat.dnsMxHint2')}
                </div>
              </div>
            )}

            {fields.length === 0 && !integration && !isEmail && (
              <div className="chat-modal-empty">
                <div className="chat-modal-empty-title">{t('comms.chat.noSetup')}</div>
                <div className="chat-modal-empty-desc">
                  {t('comms.chat.noSetupDesc')}
                </div>
              </div>
            )}

            {fields.map(f => {
              // Email channel has 3 special-cased renders.
              if (isEmail) {
                // 1. Domain — locked to the verified value (merchant cannot
                //    type someone else's domain to spy on it).
                if (f.key === 'domain') {
                  if (!emailReady) return null;
                  return (
                    <div key={f.key} className="chat-modal-field">
                      <label className="chat-modal-label">{fieldLabel(t, meta.id, f.key, f.label)}</label>
                      <div className="chat-modal-locked-input">
                        <input className="crm-input" value={`@${emailDomain}`}
                          readOnly disabled
                          title={t('comms.chat.lockedToDomain')} />
                        <span className="chat-modal-lock-badge">
                          <CheckCircle weight="fill" size={11} /> {t('authConfig.verified')}
                        </span>
                      </div>
                      <p className="chat-modal-hint">
                        {t('comms.chat.lockedHint1')} <a href={`/project/${projectId}/authentication`}>{t('comms.chat.authEmailLink')}</a> {t('comms.chat.lockedHint2')}
                      </p>
                    </div>
                  );
                }
                // 2. reply_local — input on the left, `@domain` suffix glued
                //    to the right so the merchant sees the full address form live.
                if (f.key === 'reply_local') {
                  if (!emailReady) return null;
                  return (
                    <div key={f.key} className="chat-modal-field">
                      <label className="chat-modal-label">{fieldLabel(t, meta.id, f.key, f.label)}</label>
                      <div className="chat-modal-split-input">
                        <input className="crm-input chat-modal-split-input__left"
                          placeholder={f.placeholder || 'support'}
                          value={values[f.key] || ''}
                          onChange={e => {
                            // Lowercase + strip @-suffix if the merchant pastes a full email.
                            const v = (e.target.value || '').toLowerCase().split('@')[0].trim();
                            setValues(vs => ({ ...vs, [f.key]: v })); setErr('');
                          }}
                          autoComplete="off" maxLength={64} />
                        <span className="chat-modal-split-input__suffix">@{emailDomain}</span>
                      </div>
                      {f.hint && <p className="chat-modal-hint">{fieldHint(t, meta.id, f.key, f.hint)}</p>}
                    </div>
                  );
                }
                // 3. reply_name — regular input but only show when emailReady
                if (f.key === 'reply_name' && !emailReady) return null;
              }
              return (
                <div key={f.key} className="chat-modal-field">
                  <label className="chat-modal-label">{fieldLabel(t, meta.id, f.key, f.label)}</label>
                  <input className="crm-input" placeholder={f.placeholder || ''}
                    value={values[f.key] || ''}
                    onChange={e => { setValues(v => ({ ...v, [f.key]: e.target.value })); setErr(''); }}
                    autoComplete="off" />
                  {f.hint && <p className="chat-modal-hint">{fieldHint(t, meta.id, f.key, f.hint)}</p>}
                </div>
              );
            })}

            {/* Live preview — shows what the customer will see in their inbox
                From field. Updates as the merchant types reply_local / reply_name. */}
            {isEmail && emailReady && (values.reply_local || values.reply_name) && (
              <div className="chat-modal-preview">
                <div className="chat-modal-preview-label">{t('comms.chat.customerWillSee')}</div>
                <div className="chat-modal-preview-from">
                  <strong>{values.reply_name?.trim() || 'Support'}</strong>
                  &nbsp;&lt;{(values.reply_local?.trim() || 'support')}@{emailDomain}&gt;
                </div>
              </div>
            )}

            {err && <p className="auth-msg auth-msg--err">{err}</p>}

            <div className="auth-actions">
              <button className="crm-submit-btn" onClick={save}
                disabled={saving || !canSave || !emailReady} type="button">
                {saving ? t('authConfig.saving') : (integration ? t('comms.chat.update') : t('comms.chat.connect'))}
              </button>
              {integration && (
                <button className="auth-btn-danger" onClick={remove}
                  disabled={removing} type="button">
                  <Trash size={13} /> {removing ? t('comms.chat.removing') : t('comms.chat.disconnect')}
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
  const { t } = useTranslation();
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, false);
  const Icon = channel.Icon;
  const cls = [
    'auth-provider-row',
    first && 'auth-provider-row--first',
    last  && 'auth-provider-row--last',
  ].filter(Boolean).join(' ');

  const desc = integration?.bot_username
    ? t('comms.chat.connectedAsName', { name: integration.bot_username })
    : channelDesc(t, channel.id, channel.desc);

  return (
    <div ref={ref} className={cls} onClick={onClick} {...handlers}>
      <div ref={glossRef} className="auth-provider-gloss" />
      <div className="auth-provider-icon-wrap">
        <Icon className="auth-provider-icon" />
      </div>
      <span className="auth-provider-name">{channel.label}</span>
      <span className="auth-provider-desc">{desc}</span>
      {integration
        ? <span className="auth-badge-enabled"><CheckCircle weight="fill" size={11} /> {t('comms.chat.connected')}</span>
        : <span className="auth-badge-disabled">{channel.realtime ? t('comms.chat.realtime') : t('comms.chat.webhook')}</span>}
      <CaretRight className="auth-provider-chevron" />
    </div>
  );
}

// ─── Channels Panel ───────────────────────────────────────────────────────────

function ChannelsPanel({ projectId, onIntegrationsChange }) {
  const { t } = useTranslation();
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
      <h1 className="crm-page-title">{t('comms.chat.channels')}</h1>
      <p className="auth-page-subtitle">
        {t('comms.chat.channelsSubtitle')}
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
  const { t } = useTranslation();
  const { projectId, access } = useOutletContext();
  const canView = (p) => !access || access.is_owner || ['view', 'manage'].includes(access.permissions?.[p]);
  const chatTabs = [
    canView('chat')     && { key: 'chats',    label: t('comms.chat.tabChats'),    Icon: ChatsCircle },
    canView('channels') && { key: 'channels', label: t('comms.chat.tabChannels'), Icon: Plug },
  ].filter(Boolean);
  const [tab, setTab] = useTabParam(chatTabs[0]?.key || 'chats');

  return (
    <>
      {chatTabs.length > 1 && (
        <div className="auth-tab-wrapper">
          <TabSwitcher tabs={chatTabs} tab={tab} setTab={setTab} />
        </div>
      )}

      <div className="auth-page chat-page">
        {tab === 'chats' && canView('chat') ? (
          <ChatPanel projectId={projectId} />
        ) : tab === 'channels' && canView('channels') ? (
          <ChannelsPanel projectId={projectId} />
        ) : null}
      </div>
    </>
  );
}
