// Live presence — module-level singleton over /api/presence/ws.
//
// Why a singleton: every authenticated Layout (project / org / settings /
// product / docs) mounts the hook so presence works on EVERY page. We don't
// want a separate WebSocket per Layout component — one shared connection
// per browser tab, reused across navigations. Module-level state survives
// route changes (Layouts unmount/remount; this file does not).
//
// State shape:
//   _presence: Map<user_id, {
//     route, project_id, name, email, avatar_url,
//     last_seen (ISO), online (bool)
//   }>
//
// Public API:
//   usePresence(): React hook — opens the WS once and pushes route changes
//                  on every navigation. Call it from a Layout.
//   usePresenceMap(): hook returning the live Map<user_id, snap>. Re-renders
//                     the caller on every presence change.
//   useOnRoute(routeMatch): hook returning [snap…] of OTHER users currently
//                           on the same route as me (or a custom matcher).

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { API_BASE } from '../api.js';

// ── Module state ──────────────────────────────────────────────────────
let _ws = null;
let _reconnectTimer = null;
let _hbTimer = null;
let _backoffMs = 1000;
let _lastRoute = '';
let _started = false;          // setOpen() guarded
let _selfId = null;            // my own user_id — server tells us on connect
const _presence = new Map();   // user_id → snapshot
const _subs = new Set();       // change subscribers

// Set to true to log [presence] WS activity to the console while debugging.
const _DEBUG = false;
function _log(...args) { if (_DEBUG) console.log('[presence]', ...args); }

function _wsUrl() {
  // ws:// for localhost, wss:// for production HTTPS
  const u = new URL(API_BASE);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/api/presence/ws';
  return u.toString();
}

function _emit() {
  for (const cb of _subs) {
    try { cb(); } catch { /* swallow — one bad subscriber shouldn't kill others */ }
  }
}

function _applyFrame(frame) {
  if (!frame || typeof frame !== 'object') return;
  if (frame.type === 'me' && frame.user_id) {
    _selfId = frame.user_id;
    _emit();
    return;
  }
  if (frame.type === 'snapshot' && Array.isArray(frame.users)) {
    // The snapshot is the AUTHORITATIVE full set of who's online in our
    // orgs at connect/reconnect time. Replace the whole map with it —
    // this drops stale ghost entries left over from a previous backend
    // session (e.g. after the dev server restarts, old snaps with the old
    // data shape would otherwise linger forever). Self-healing: every
    // reconnect re-seeds clean state.
    _presence.clear();
    for (const s of frame.users) {
      if (!s?.user_id) continue;
      _presence.set(s.user_id, { ...s, online: !!s.online });
    }
    _emit();
    return;
  }
  if (frame.type === 'presence' && frame.user_id) {
    if (frame.online) {
      _presence.set(frame.user_id, { ...frame, online: true });
    } else {
      // Mark offline but keep last_seen so Team can say "online 5 min ago"
      const prev = _presence.get(frame.user_id) || {};
      _presence.set(frame.user_id, { ...prev, ...frame, online: false });
    }
    _emit();
  }
}

function _send(payload) {
  if (_ws && _ws.readyState === 1) {
    try { _ws.send(JSON.stringify(payload)); } catch { /* socket died mid-send */ }
  }
}

function _open() {
  if (_ws && (_ws.readyState === 0 || _ws.readyState === 1)) return;
  _log('open →', _wsUrl());
  try {
    _ws = new WebSocket(_wsUrl());
  } catch (e) {
    _log('constructor failed', e);
    _scheduleReconnect();
    return;
  }
  _ws.onopen = () => {
    _log('OPEN ✓ — sending hello', { route: _lastRoute });
    _backoffMs = 1000;
    _send({ type: 'hello', route: _lastRoute });
    if (_hbTimer) clearInterval(_hbTimer);
    _hbTimer = setInterval(() => _send({ type: 'hb' }), 15_000);
  };
  _ws.onmessage = (ev) => {
    try {
      const f = JSON.parse(ev.data);
      // Don't spam the console with 20Hz cursor frames.
      if (f?.type !== 'presence' || (f.cursor_x == null && f.cursor_y == null)) {
        _log('←', f?.type, f);
      }
      _applyFrame(f);
    } catch { /* ignore non-JSON */ }
  };
  _ws.onclose = (ev) => {
    _log('CLOSE', { code: ev?.code, reason: ev?.reason || '(none)', wasClean: ev?.wasClean });
    if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
    // 4401 = auth failed — don't loop: user isn't logged in (or session expired)
    if (ev?.code === 4401) { _log('auth failed (no cookie / expired) — not reconnecting'); return; }
    _scheduleReconnect();
  };
  _ws.onerror = (e) => { _log('error', e); };
}

function _scheduleReconnect() {
  if (_reconnectTimer) return;
  const delay = _backoffMs;
  _backoffMs = Math.min(_backoffMs * 2, 30_000);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _open();
  }, delay);
}

function _setRoute(route) {
  // Backend resolves project/org scope ENTIRELY from the route string
  // (it carries the api_key / slug), so route is the only thing we send.
  // Dedup on route alone — no more project_id/org_id race.
  if (route === _lastRoute) return;
  _lastRoute = route;
  _send({ type: 'route', route });
}

/** Kept for call-site compatibility — Layouts still call this after their
 *  fetch resolves, but scope now comes from the route on the backend, so
 *  this just re-asserts the current pathname (a no-op if unchanged). */
export function setPresenceContext() {
  _setRoute(typeof window !== 'undefined' ? window.location.pathname : (_lastRoute || ''));
}

// ── Hooks ──────────────────────────────────────────────────────────────

/** Mount-only hook: opens the WS once per tab and reports the current
 *  route on every navigation. Call from each Layout component. */
export function usePresence() {
  const loc = useLocation();
  useEffect(() => {
    if (!_started) {
      _started = true;
      _open();
    }
    // Don't tear down on unmount — Layouts remount on cross-section navs
    // and we want presence to stay live. Browser tab close cleans up.
  }, []);
  useEffect(() => {
    // Just report the pathname — the backend resolves project/org scope
    // from it (the URL carries the api_key / slug). No window globals,
    // no race between route and a separately-sent scope id.
    _setRoute(loc.pathname);
  }, [loc.pathname]);
}

/** Reactive snapshot of the entire presence Map. Re-renders on every
 *  presence change. Use sparingly (whole-tree updates). */
export function usePresenceMap() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const cb = () => setTick(t => t + 1);
    _subs.add(cb);
    return () => { _subs.delete(cb); };
  }, []);
  return _presence;
}

/** All OTHER users currently on the given route (self excluded). Returns
 *  array of presence snapshots — empty if alone. Exact pathname equality. */
export function useOnRoute(routePrefix) {
  const map = usePresenceMap();
  const out = [];
  for (const snap of map.values()) {
    if (!snap.online) continue;
    if (!snap.route) continue;
    if (_selfId && snap.user_id === _selfId) continue;
    if (routePrefix && snap.route !== routePrefix) continue;
    out.push(snap);
  }
  return out;
}

/** All OTHER users currently in the given project (self excluded), no matter
 *  which page of it they're on. Used by the Header avatar-stack so the user
 *  sees teammates anywhere inside the project (orders / products / settings…)
 *  rather than only the exact page they're on. */
export function useOnProject(projectId) {
  const map = usePresenceMap();
  if (!projectId) return [];
  const pid = Number(projectId);
  const out = [];
  for (const snap of map.values()) {
    if (!snap.online) continue;
    if (_selfId && snap.user_id === _selfId) continue;
    if (Number(snap.project_id) !== pid) continue;
    out.push(snap);
  }
  return out;
}

/** ROUTE-STRING based filters — the URL itself is the source of truth, so
 *  these don't depend on backend-resolved numeric project_id/org_id (which
 *  can lag or arrive empty). The api_key / slug embedded in a peer's route
 *  uniquely identifies the project / org they are in.
 *
 *  useOnProjectKey: other users in the EXACT same project (same api_key in
 *  their /project/<api_key>/… route). */
export function useOnProjectKey(apiKey) {
  const map = usePresenceMap();
  if (!apiKey) return [];
  const base = `/project/${apiKey}`;
  const out = [];
  for (const snap of map.values()) {
    if (!snap.online) continue;
    if (_selfId && snap.user_id === _selfId) continue;
    const r = snap.route || '';
    if (r === base || r.startsWith(base + '/')) out.push(snap);
  }
  return out;
}

/** useInOrgScope: other users currently inside this org — either on one of
 *  its /org/<slug>/… pages, or in a project whose api_key is in this org's
 *  project set. `apiKeySet` is a Set of the org's project api_keys. */
export function useInOrgScope(orgSlug, apiKeySet) {
  const map = usePresenceMap();
  const hasKeys = apiKeySet && apiKeySet.size > 0;
  if (!orgSlug && !hasKeys) return [];
  const orgBase = orgSlug ? `/org/${orgSlug}` : null;
  const out = [];
  for (const snap of map.values()) {
    if (!snap.online) continue;
    if (_selfId && snap.user_id === _selfId) continue;
    const r = snap.route || '';
    if (orgBase && (r === orgBase || r.startsWith(orgBase + '/'))) { out.push(snap); continue; }
    const m = r.match(/^\/project\/([^/?]+)/);
    if (m && hasKeys && apiKeySet.has(m[1])) { out.push(snap); continue; }
  }
  return out;
}

/** Every OTHER online user we currently know about (any org / project),
 *  self excluded. Powers the presence popover where we list everyone
 *  reachable and let the user click through to where they are. */
export function useAllOnline() {
  const map = usePresenceMap();
  const out = [];
  for (const snap of map.values()) {
    if (!snap.online) continue;
    if (_selfId && snap.user_id === _selfId) continue;
    out.push(snap);
  }
  return out;
}

/** Other users currently INSIDE the given org — their active scope must
 *  resolve to this org (because they're on /org/:slug/* or on a project
 *  that belongs to this org). Membership alone is NOT enough: a teammate
 *  on /dashboard, in a different org's project, or on /docs is NOT here.
 *  This is both a security gate (peers in other orgs don't leak) and the
 *  natural UX expectation — the stack shows "who's here", not "who's a
 *  member of an org that happens to include this one". */
export function useInOrg(orgId) {
  const map = usePresenceMap();
  if (!orgId) return [];
  const oid = Number(orgId);
  const out = [];
  for (const snap of map.values()) {
    if (!snap.online) continue;
    if (_selfId && snap.user_id === _selfId) continue;
    if (Number(snap.org_id) !== oid) continue;
    out.push(snap);
  }
  return out;
}

/** Quick getter (non-reactive): is this user_id online? Use for the
 *  Team-page dot when you also poll the snapshot endpoint. */
export function isUserOnline(userId) {
  const s = _presence.get(userId);
  return !!(s && s.online);
}

/** Get my own user_id (whatever the server told us on WS connect). Used by
 *  components that want to filter self out of presence lists. Returns null
 *  before the first `me` frame arrives. */
export function getSelfId() {
  return _selfId;
}

// ── Cursor reporting ──────────────────────────────────────────────────
// Active only on pages that mount <CursorOverlay/> (project + product).
// 20Hz cap, only sends when the mouse actually moved since the last tick.
//
// Two coord systems per frame:
//   (a) ELEMENT-LOCK — CSS path of the DOM node under the cursor + offset
//       inside it. Receiver finds the same node and projects → pixel-perfect
//       even when grids reflow differently (3 vs 4 cols on different
//       monitors). Path uses tag + :nth-of-type so it survives identical
//       data sets across clients without needing data-* attrs.
//   (b) CONTENT-RELATIVE pixels in .crm-main (scroll-corrected). Fallback
//       when the path doesn't resolve on the receiver (different page /
//       different data / element gone). Degrades to "roughly same place",
//       never silently drops the cursor.

let _cursorEnabled  = false;
let _cursorTimer    = null;
let _cursorMoved    = false;
let _lastCursorX    = 0;
let _lastCursorY    = 0;
let _lastCursorAnchor = '';
let _lastCursorOx   = 0;
let _lastCursorOy   = 0;
let _cursorCount    = 0;   // ref-count — multiple Layouts → one listener
// Idle-fade — after this many ms without mouse movement we send `cursor_clear`
// so peers drop our cursor. Resumes on the next mousemove. Keeps stale
// pointers from getting parked on a random spot when someone walks away.
const CURSOR_IDLE_MS = 15_000;
let _lastMoveAt = 0;
let _cursorCleared = true;   // peers currently see no cursor for us

function _cssEscape(s) {
  // Polyfill — Safari < 14 / older Edge lack CSS.escape. We only need the
  // common case (id chars), so a minimal regex-replace is enough.
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s);
  }
  return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
}

function _cssPath(el) {
  // Walk up to <body>, terminating early on the first id. Skip our own
  // cursor overlay so we never lock onto our own avatars. Capped at 12
  // levels — beyond that the selector becomes too fragile to reproduce.
  if (!el || !el.tagName) return '';
  const parts = [];
  let depth = 0;
  while (el && el !== document.body && el.tagName && depth < 12) {
    // Ignore the cursor layer itself (would target our own avatar/label).
    if (el.classList && (el.classList.contains('cur-layer') ||
                         el.classList.contains('cur-pointer'))) {
      return '';
    }
    if (el.id) {
      parts.unshift('#' + _cssEscape(el.id));
      return parts.join(' > ');
    }
    const tag = el.tagName.toLowerCase();
    let segment = tag;
    const parent = el.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter(c => c.tagName === el.tagName);
      if (sameTag.length > 1) {
        segment += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
      }
    }
    parts.unshift(segment);
    el = el.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

function _onMouseMove(e) {
  // (b) Content-relative coords inside .crm-main — fallback channel.
  const main = document.querySelector('.crm-main');
  if (main) {
    const rect = main.getBoundingClientRect();
    _lastCursorX = e.clientX - rect.left + main.scrollLeft;
    _lastCursorY = e.clientY - rect.top  + main.scrollTop;
  } else {
    _lastCursorX = e.clientX;
    _lastCursorY = e.clientY;
  }
  // (a) Element-lock anchor — DOM path + normalized offset in that node.
  _lastCursorAnchor = '';
  _lastCursorOx = 0;
  _lastCursorOy = 0;
  try {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const path = _cssPath(target);
    if (path && target) {
      const r = target.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        _lastCursorAnchor = path;
        _lastCursorOx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        _lastCursorOy = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
      }
    }
  } catch { /* DOM API failed — ship without anchor, fallback handles it */ }
  _cursorMoved = true;
  _lastMoveAt  = Date.now();
  _cursorCleared = false;   // a real frame is about to ship, peers will render
}

function _cursorTick() {
  if (_cursorMoved) {
    _cursorMoved = false;
    _send({
      type:   'cursor',
      x:      _lastCursorX,
      y:      _lastCursorY,
      anchor: _lastCursorAnchor,
      ox:     _lastCursorOx,
      oy:     _lastCursorOy,
    });
    return;
  }
  // No new movement — check the idle timer. After CURSOR_IDLE_MS without
  // movement, ask peers to drop our cursor (one-shot, until we move again).
  if (!_cursorCleared && _lastMoveAt && (Date.now() - _lastMoveAt) >= CURSOR_IDLE_MS) {
    _cursorCleared = true;
    _send({ type: 'cursor_clear' });
  }
}

/** Begin reporting mouse position as `{type:'cursor', x, y}` frames over the
 *  presence WS. x/y are normalized viewport coords [0..1]. 50 ms throttle
 *  (= 20 Hz) — Figma-feel without flooding. Ref-counted: safe to call from
 *  multiple components; one mousemove listener total. */
export function startCursorReporting() {
  _cursorCount++;
  if (_cursorEnabled) return;
  _cursorEnabled = true;
  window.addEventListener('mousemove', _onMouseMove, { passive: true });
  _cursorTimer = setInterval(_cursorTick, 50);
}

/** Stop reporting and tell peers to drop our cursor from their overlay. */
export function stopCursorReporting() {
  _cursorCount = Math.max(0, _cursorCount - 1);
  if (_cursorCount > 0) return;
  if (!_cursorEnabled) return;
  _cursorEnabled = false;
  window.removeEventListener('mousemove', _onMouseMove);
  if (_cursorTimer) { clearInterval(_cursorTimer); _cursorTimer = null; }
  _send({ type: 'cursor_clear' });
}
