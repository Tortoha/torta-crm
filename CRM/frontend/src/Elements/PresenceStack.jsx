// Avatar stack in Header — pill button → popover modeled 1:1 on
// NotificationsBell:
//   • Same .notif-popover dropdown chrome
//   • Same InteractiveSection tilt rows (.po-set-row inside .po-set-table)
//   • 10 rows shown in the dropdown, an 11th "View all" row when there's
//     more, opening a full-list modal (same .notif-all-modal chrome)
//
// Stack icons themselves stay project-scoped (≤5 avatars + "+N");
// the popover/modal list everyone online org-wide so the viewer can
// jump to teammates working on other projects.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { User, X, CaretRight } from '@phosphor-icons/react';
import { API_BASE } from '../api.js';
import { InteractiveSection } from '../Utils/InteractiveSection.js';
import { PoListRow } from '../Utils/PoListRow.jsx';
import { useOnProjectKey, useInOrgScope, useAllOnline,
         useOnRoute, useChat, sendChat, useMyRoute } from '../Utils/usePresence.js';
import { PaperPlaneTilt, ChatTeardropText } from '@phosphor-icons/react';
import '../Style/Products.css';   // .po-set-table / .po-set-row / .po-set-strong
import '../Style/Authentication.css';   // .auth-toast (bottom-pill notice)
import '../Style/PresenceStack.css';

// Cache layout-bundle (which includes RBAC access info) per project, so
// repeat clicks on the same peer don't re-fetch. Same TTL as Layout.jsx
// uses for its own bundle cache.
const _ACCESS_CACHE = new Map();   // apiKey → { data, expiresAt }
const _ACCESS_TTL   = 60_000;

// Cache the project list per org (api_keys + names). One cheap fetch when
// the user opens an org page — reused for presence filtering + row labels.
const _ORG_PROJECTS_CACHE = new Map();   // orgId → { keys:Set, nameByKey:Map, expiresAt }
const _ORG_PROJECTS_TTL = 60_000;

// Same page → permission-key map the backend uses in _page_from_route.
const PAGE_PERM = {
  '': 'overview', overview: 'overview',
  products: 'products', orders: 'orders', customers: 'customers',
  booking: 'booking', bookings: 'booking', chat: 'chat',
  analytics: 'analytics', alerts: 'alerts', targets: 'goals', goals: 'goals',
  emails: 'emails',
  authentication: 'auth_providers', integrations: 'integrations',
  documents: 'documents', settings: 'settings', api: 'api',
};

async function _checkProjectAccess(apiKey, page) {
  if (!apiKey) return true;
  const now = Date.now();
  const hit = _ACCESS_CACHE.get(apiKey);
  let bundle;
  if (hit && hit.expiresAt > now) {
    bundle = hit.data;
  } else {
    try {
      const r = await fetch(
        `${API_BASE}/api/projects/by-key/${apiKey}/layout-bundle`,
        { credentials: 'include' }
      );
      if (!r.ok) return false;
      bundle = await r.json();
      _ACCESS_CACHE.set(apiKey, { data: bundle, expiresAt: now + _ACCESS_TTL });
    } catch {
      return false;
    }
  }
  const access = bundle?.access;
  if (!access) return false;
  if (access.is_owner) return true;
  const key = PAGE_PERM[page] || page || 'overview';
  const level = access.permissions?.[key];
  return level === 'view' || level === 'manage';
}

const MAX_VISIBLE   = 5;          // avatars in the Header stack
const POPOVER_LIMIT = 10;         // rows in the dropdown — 11th = "View all"

// Same tilt config as NotificationsBell.NotifRow — small rows need an
// amped-up scale (1.086) to read.
const PRESENCE_TILT = {
  maxAngleX: 10, maxAngleY: 4, lerp: 0.05, lerpOut: 0.07,
  scale: 1.086, perspective: 900,
  gloss: { opacity: 0.14, spread: 40 },
};

// Tilt wrapper for the dropdown rows — copy of NotifRow.
function PresenceTiltRow({ className = '', children, ...rest }) {
  const { ref, glossRef, handlers } = InteractiveSection(PRESENCE_TILT, false);
  return (
    <div ref={ref} className={`po-set-row ${className}`.trim()} {...handlers} {...rest}>
      <div ref={glossRef} className="po-set-row-gloss" />
      {children}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────
function initialsOf(name, email) {
  const seed = (name || email || '').trim();
  if (!seed) return '';
  return seed.split(/[\s@.]+/).filter(Boolean)
    .map(w => w[0].toUpperCase()).slice(0, 2).join('');
}

function colourFor(seed) {
  const palette = ['#0071E3', '#8b5cf6', '#06b6d4', '#f97316', '#f43f5e', '#d946ef', '#10b981'];
  const code = (seed || 'a').charCodeAt(0) || 0;
  return palette[code % palette.length];
}

// /project/abc/orders → "Orders" via the existing sidebar nav i18n keys.
function pageLabelFromRoute(route, t) {
  if (!route) return '';
  // Match /product/ anywhere — covers both the real /product/<hash> route and
  // the synthetic /project/<apiKey>/product/<hash> presence route.
  const prodM = route.match(/\/product\/[^/?]+\/?([^/?]*)/);
  if (prodM) {
    const key = prodM[1] || '';
    const navKey = ({
      '': 'productOverview', overview: 'productOverview',
      reviews: 'reviews', settings: 'settings',
      'edit-history': 'editHistory', 'api-preview': 'apiPreview',
    })[key] || 'productOverview';
    return t(`nav.${navKey}`, { defaultValue: key || 'Overview' });
  }
  const projM = route.match(/^\/project\/[^/]+\/?([^/?]*)/);
  if (projM) {
    const key = projM[1] || 'overview';
    const navKey = ({
      '': 'projectOverview', overview: 'projectOverview',
      products: 'products', orders: 'orders', customers: 'customers',
      bookings: 'bookings', booking: 'bookings', chat: 'chat',
      analytics: 'analytics', alerts: 'alerts', targets: 'targets',
      authentication: 'authentication', emails: 'emails',
      integrations: 'integrations', documents: 'documents',
      settings: 'settings', api: 'api',
    })[key] || 'projectOverview';
    return t(`nav.${navKey}`, { defaultValue: key });
  }
  const orgM = route.match(/^\/org\/[^/]+\/?([^/?]*)/);
  if (orgM) {
    const key = orgM[1] || '';
    const navKey = ({
      '': 'projects', analytics: 'analytics', team: 'team',
      payments: 'payments', billing: 'billing', settings: 'settings',
    })[key] || 'projects';
    return t(`nav.${navKey}`, { defaultValue: key || 'projects' });
  }
  if (route.startsWith('/dashboard')) return t('nav.dashboard', { defaultValue: 'Dashboard' });
  if (route.startsWith('/settings'))  return t('nav.settings',  { defaultValue: 'Settings' });
  if (route.startsWith('/docs'))      return t('docs.title',    { defaultValue: 'Docs' });
  return '';
}

// Rebuild route with the peer's project api_key so clicking actually
// opens THEIR project, not whatever :apiKey we're currently in.
function targetRoute(snap) {
  if (!snap.route) return null;
  // Synthetic product route (/project/<apiKey>/product/<hash>/…) → the REAL
  // product URL, which lives at the top level (/product/<hash>/…).
  const prod = snap.route.match(/(\/product\/.+)$/);
  if (prod) return prod[1];
  if (snap.project_api_key && snap.route.startsWith('/project/')) {
    return snap.route.replace(/^\/project\/[^/]+/, `/project/${snap.project_api_key}`);
  }
  return snap.route;
}

// Single 28px avatar circle — image, initials, or User icon fallback.
// referrerPolicy="no-referrer" is REQUIRED for Google photos: lh3.googleusercontent.com
// returns 403 when a Referer is sent (hotlink protection, esp. from localhost),
// so without it the image silently breaks. onError falls back to initials if the
// photo still fails (rate-limit 429, expired URL).
function PresenceAvatar({ snap, size = 28 }) {
  const seed  = snap.name || snap.email || '';
  const title = snap.name || snap.email || '';
  const inits = initialsOf(snap.name, snap.email);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [snap.avatar_url]);
  if (snap.avatar_url && !imgFailed) {
    return <img className="pst-avatar pst-avatar--lg" src={snap.avatar_url} alt=""
      title={title} referrerPolicy="no-referrer"
      style={{ width: size, height: size }}
      onError={() => setImgFailed(true)} />;
  }
  return (
    <span className="pst-avatar pst-avatar--lg pst-avatar--initials"
      title={title}
      style={{
        width: size, height: size,
        background: colourFor(seed || String(snap.user_id || 'a')),
        fontSize: Math.round(size * 0.42),
      }}>
      {inits || <User weight="bold" className="pst-avatar-icon"
        style={{ width: Math.round(size * 0.55), height: Math.round(size * 0.55) }} />}
    </span>
  );
}

// ── Single row inside the popover / modal ───────────────────────────
//
// Layout copied from NotifItem: notif-row-body grid (icon | text) + a
// right-column notif-row-time (used here for the page label).
function PresenceItem({ snap, onPick, showProject = false, projectName, Row = PresenceTiltRow }) {
  const { t } = useTranslation();
  const proj  = projectName ?? (snap.project_name || '');
  const page  = pageLabelFromRoute(snap.route, t);
  const product = snap.product_name || '';   // set for peers on /product/<hash>
  // Hierarchy label. Org-scoped lists prefix the project so you can tell which
  // one a peer is in. Product pages insert the product between project & page:
  //   org level    → "Tortoly · Polo Sweater · Product Overview"
  //   project level → "Polo Sweater · Product Overview"
  const where = (showProject
    ? [proj, product, page]
    : [product, page]
  ).filter(Boolean).join(' · ');
  return (
    <Row className="notif-row notif-row--clickable pst-presence-row"
      onClick={() => onPick(snap)}>
      <span className="notif-row-body">
        <span className="notif-row-icon pst-row-icon">
          <PresenceAvatar snap={snap} size={32} />
        </span>
        <span className="notif-row-text">
          <span className="po-set-strong notif-row-title">
            {snap.name || snap.email || `User ${snap.user_id}`}
          </span>
          {where && <span className="notif-row-message">{where}</span>}
        </span>
      </span>
    </Row>
  );
}

// ── Full-list modal (.notif-all-modal chrome, PoListRow tilt rows) ──
function AllPresenceModal({ onClose, onPick, showProject = false }) {
  const { t }   = useTranslation();
  const items   = useAllOnline();
  const sorted  = [...items].sort((a, b) =>
    (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="auth-modal-overlay notif-all-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal notif-all-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">
                {t('header.presence.allTitle', { defaultValue: 'Everyone online' })}
              </div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {t('header.presence.allSubtitle', {
                    defaultValue: 'Teammates currently signed in to the workspace.',
                  })}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body notif-all-body">
          {sorted.length === 0 && (
            <p className="crm-placeholder">
              {t('header.presence.empty', { defaultValue: 'No teammates online' })}
            </p>
          )}
          {sorted.length > 0 && (
            <div className="po-set-table notif-table">
              {sorted.map(s => (
                <PresenceItem key={s.user_id} snap={s} onPick={onPick}
                  showProject={showProject} Row={PoListRow} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Cursor-chat composer — small modal to type an ephemeral message ──
function ChatComposer({ onClose }) {
  const { t } = useTranslation();
  const { cooldownMs, canSend } = useChat();
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    if (!canSend) return;
    if (sendChat(text)) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') onClose();
  };
  const secs = Math.ceil(cooldownMs / 1000);

  return createPortal(
    <div className="auth-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal pst-chat-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">
                {t('header.presence.chatTitle', { defaultValue: 'Quick message' })}
              </div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {t('header.presence.chatSubtitle', {
                    defaultValue: 'Shows by your cursor to everyone on this page for 5 seconds.',
                  })}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>
        <div className="auth-modal-body pst-chat-body">
          <input
            ref={inputRef}
            className="crm-input pst-chat-input"
            maxLength={120}
            placeholder={canSend
              ? t('header.presence.chatPlaceholder', { defaultValue: 'Type a message…' })
              : t('header.presence.chatCooldown', { defaultValue: 'Wait {{secs}}s…', secs })}
            value={text}
            disabled={!canSend}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <button
            className="crm-submit-btn pst-chat-send"
            type="button"
            disabled={!canSend || !text.trim()}
            onClick={submit}>
            <PaperPlaneTilt weight="fill" />
            {canSend
              ? t('header.presence.chatSend', { defaultValue: 'Send' })
              : `${secs}s`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Header pill + popover (copy of NotificationsBell pattern) ───────
export default function PresenceStack({ project, org }) {
  const { t }    = useTranslation();
  const navigate = useNavigate();
  const btnRef   = useRef(null);
  const [open,    setOpen]    = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [pos,     setPos]     = useState(null);
  const [toast,   setToast]   = useState('');
  const toastRef = useRef(null);
  const showToast = (m) => {
    setToast(m);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 3200);
  };

  // Scope identifiers come straight from MY OWN pathname — the exact string
  // peers also report — so filtering never depends on backend-resolved numeric
  // ids that can lag. orgId (numeric, for the project-list fetch) comes from
  // the org prop.
  const loc = useLocation();
  const projMatch = loc.pathname.match(/^\/project\/([^/?]+)/);
  const orgMatch  = loc.pathname.match(/^\/org\/([^/?]+)/);
  const projectKey = projMatch ? projMatch[1] : (project?.api_key ?? null);
  const orgSlug    = orgMatch  ? orgMatch[1]  : (org?.slug ?? null);
  const orgId      = org?.id ?? null;

  // On an org page, fetch the org's project list once (cached 60s) so we can
  // (a) tell which /project/<key> routes belong to this org, and
  // (b) label rows with the project name. Cheap + reused.
  const [orgProjects, setOrgProjects] = useState(() => _ORG_PROJECTS_CACHE.get(orgId) || null);
  useEffect(() => {
    if (!orgId || projectKey) return;   // only needed on org pages
    const cached = _ORG_PROJECTS_CACHE.get(orgId);
    if (cached && cached.expiresAt > Date.now()) { setOrgProjects(cached); return; }
    fetch(`${API_BASE}/api/orgs/${orgId}/projects`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        const keys = new Set();
        const nameByKey = new Map();
        for (const p of (Array.isArray(list) ? list : [])) {
          if (p?.api_key) { keys.add(p.api_key); nameByKey.set(p.api_key, p.name || ''); }
        }
        const entry = { keys, nameByKey, expiresAt: Date.now() + _ORG_PROJECTS_TTL };
        _ORG_PROJECTS_CACHE.set(orgId, entry);
        setOrgProjects(entry);
      })
      .catch(() => { /* offline — filter falls back to org-route matches only */ });
  }, [orgId, projectKey]);

  const apiKeySet = orgProjects?.keys || null;

  // Route-string filters (both called unconditionally; we pick by scope).
  const onProject   = useOnProjectKey(projectKey);
  const inOrg       = useInOrgScope(orgSlug, apiKeySet);
  const stackOthers = projectKey ? onProject : inOrg;
  // Cursor-chat is only meaningful when someone else is on the EXACT same
  // page AND that page renders cursors (project / product / org pages, where
  // CursorOverlay is mounted). Keep this regex in sync with the Layouts that
  // mount <CursorOverlay/> — otherwise cursors show but the chat row / Ctrl+M
  // stay disabled (the bubble would have no cursor to ride and no audience).
  const samePagePeers = useOnRoute(useMyRoute());
  const cursorPage = /^\/(project|product|org)\//.test(loc.pathname);
  const canChat = cursorPage && samePagePeers.length > 0;

  // Ctrl+M opens the quick-message composer (only where chat is available).
  // Ctrl (not Cmd) on all platforms — Cmd+M minimises the window on macOS.
  // Match by e.code ('KeyM') — the PHYSICAL key — so it works regardless of
  // keyboard layout (a Cyrillic layout makes e.key 'ь', not 'm'). Fall back
  // to e.key for the rare case code is unavailable.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const isM = e.code === 'KeyM' || (e.key || '').toLowerCase() === 'm';
      if (!isM) return;
      if (!canChat || chatOpen) return;
      e.preventDefault();
      setOpen(false);
      setChatOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canChat, chatOpen]);
  // Org scope → rows say "Tortoly · Analytics" so you know which project
  // each peer is in. Project scope → just "Analytics" (project is implicit).
  const showProject = !projectKey && !!orgId;
  // Resolve a peer's project name from its route's api_key (org page has the
  // name map; otherwise fall back to the backend-sent project_name).
  const projectNameFor = (snap) => {
    const m = (snap.route || '').match(/^\/project\/([^/?]+)/);
    if (m && orgProjects?.nameByKey?.has(m[1])) return orgProjects.nameByKey.get(m[1]);
    return snap.project_name || '';
  };

  // Popover positioning + outside-click + Escape — copied from NotificationsBell.
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

  // Need a scope (project or org) — without one there's nothing meaningful
  // to show. Also bail when nothing's online in scope and the popover is shut.
  if (!projectKey && !orgId) return null;
  if (stackOthers.length === 0 && !open && !showAll) return null;

  // Stack visibility rule: max 5 circles, 6+ collapses last slot to "+N".
  const sorted = [...stackOthers].sort((a, b) =>
    (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  let shown, extra;
  if (sorted.length <= MAX_VISIBLE) { shown = sorted; extra = 0; }
  else { shown = sorted.slice(0, MAX_VISIBLE - 1); extra = sorted.length - (MAX_VISIBLE - 1); }

  // Popover list = the SAME scoped set as the stack (org → everyone in this
  // org; project → everyone in this project), so the dropdown matches the
  // avatars. "View all" opens the full cross-org modal (allOthers).
  const popoverList = sorted;

  const onPick = async (snap) => {
    const target = targetRoute(snap);
    if (!target) return;
    // RBAC click-gate — only project routes are role-gated. Org / settings
    // / dashboard / docs are open to all members. Check the viewer's
    // access (cached) before navigating; on miss, show a toast and stay.
    const projM = target.match(/^\/project\/([^/]+)\/?([^/?]*)/);
    if (projM) {
      const ok = await _checkProjectAccess(projM[1], projM[2] || 'overview');
      if (!ok) {
        showToast(t('header.presence.noAccess', {
          defaultValue: 'You don’t have access to that page',
        }));
        return;
      }
    }
    setOpen(false);
    setShowAll(false);
    navigate(target);
  };

  return (
    <>
      <button ref={btnRef} type="button" className="pst-stack"
        onClick={() => setOpen(v => !v)}
        title={t('header.presence.title', { defaultValue: 'Who is here' })}>
        {shown.length === 0 && (
          <span className="pst-avatar pst-avatar--initials"
            style={{ background: 'rgba(var(--fg-rgb), 0.18)' }}>
            <User weight="bold" className="pst-avatar-icon" />
          </span>
        )}
        {shown.map(s => <PresenceAvatar key={s.user_id} snap={s} size={22} />)}
        {extra > 0 && (
          <span className="pst-avatar pst-avatar--more">+{extra}</span>
        )}
      </button>

      {open && pos && createPortal(
        <div className="notif-popover" style={{ top: pos.top, left: pos.left }}>
          <div className="notif-list">
            {popoverList.length === 0 && (
              <p className="crm-placeholder">
                {t('header.presence.empty', { defaultValue: 'No teammates online' })}
              </p>
            )}
            {popoverList.length > 0 && (
              <div className="po-set-table notif-table">
                {popoverList.slice(0, POPOVER_LIMIT).map(s => (
                  <PresenceItem key={s.user_id} snap={s} onPick={onPick}
                    showProject={showProject} projectName={projectNameFor(s)} />
                ))}
                {popoverList.length > POPOVER_LIMIT && (
                  <PresenceTiltRow className="notif-row notif-viewall-row"
                    onClick={() => { setShowAll(true); setOpen(false); }}>
                    <span className="notif-viewall-inner">
                      {t('header.presence.viewAll', { defaultValue: 'View all teammates' })}
                      <CaretRight weight="bold" />
                    </span>
                  </PresenceTiltRow>
                )}
                {/* Cursor-chat trigger — an IS row in the list (only when
                    someone else is on this exact page). */}
                {canChat && (
                  <PresenceTiltRow className="notif-row notif-viewall-row pst-chat-row"
                    onClick={() => { setChatOpen(true); setOpen(false); }}>
                    <span className="notif-viewall-inner">
                      <ChatTeardropText weight="bold" />
                      {t('header.presence.write', { defaultValue: 'Send a quick message' })}
                      <kbd className="pst-kbd">Ctrl+M</kbd>
                    </span>
                  </PresenceTiltRow>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {chatOpen && <ChatComposer onClose={() => setChatOpen(false)} />}

      {showAll && (
        <AllPresenceModal
          onClose={() => setShowAll(false)}
          onPick={onPick}
          showProject={showProject}
        />
      )}

      {toast && createPortal(
        <div className="auth-toast auth-toast--err">{toast}</div>,
        document.body,
      )}
    </>
  );
}
