import { useEffect, useRef } from 'react';
import { API_BASE } from '../api.js';

// useProjectEvents — subscribe to live project event stream over WebSocket.
//
// Usage:
//   useProjectEvents(projectId, (event) => {
//     if (event.type === 'order_created') refetch();
//   });
//
// Why a hook (not a context provider): each consumer cares about a
// different subset of event types and triggers its own refetch /
// invalidation. A single context with one global handler would force us
// to fan out from one giant switch statement; per-hook subscription
// keeps each section self-contained.
//
// Connection lifecycle:
//   • Opens one WebSocket per projectId on mount
//   • Reconnects with exponential backoff (cap 30 s) on close
//   • Closes on unmount / projectId change
//
// All consumers of the SAME projectId share one underlying WebSocket
// via the module-level registry — Browsers cap WebSocket connections
// per origin (Firefox: ~200), and a busy Analytics page with 15+
// sections each subscribing would burn through that fast.

// Per-projectId registry: { ws, listeners: Set<fn>, retryDelay, alive }
const registry = new Map();

function open(projectId) {
  const entry = registry.get(projectId);
  if (entry && entry.alive) return entry;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host  = new URL(API_BASE).host;
  const ws = new WebSocket(`${proto}//${host}/api/projects/${projectId}/events/ws`);
  const rec = {
    ws,
    listeners: entry?.listeners || new Set(),
    retryDelay: entry?.retryDelay || 1000,
    alive: true,
  };
  registry.set(projectId, rec);
  ws.onmessage = (e) => {
    let event = null;
    try { event = JSON.parse(e.data); } catch { return; }
    for (const fn of rec.listeners) {
      try { fn(event); } catch (err) { console.error('[useProjectEvents] listener error', err); }
    }
  };
  ws.onopen = () => { rec.retryDelay = 1000; };
  ws.onclose = (ev) => {
    rec.alive = false;
    // Don't reconnect on auth failure (4401 / 4403) — pointless, will
    // just bounce again. Wait for the page to refresh / re-auth.
    if (ev.code === 4401 || ev.code === 4403) {
      registry.delete(projectId);
      return;
    }
    // No listeners left → don't bother reconnecting.
    if (rec.listeners.size === 0) {
      registry.delete(projectId);
      return;
    }
    const delay = Math.min(rec.retryDelay, 30000);
    rec.retryDelay = Math.min(rec.retryDelay * 2, 30000);
    setTimeout(() => {
      // Only reconnect if listeners are still registered.
      const current = registry.get(projectId);
      if (current && current.listeners.size > 0 && current === rec) {
        open(projectId);
      }
    }, delay);
  };
  ws.onerror = () => { /* close handler picks up */ };
  return rec;
}

export function useProjectEvents(projectId, handler) {
  // Stable handler ref so callers don't have to memoise their callback.
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; }, [handler]);
  useEffect(() => {
    if (!projectId) return;
    const rec = open(projectId);
    const fn = (event) => { ref.current?.(event); };
    rec.listeners.add(fn);
    return () => {
      rec.listeners.delete(fn);
      if (rec.listeners.size === 0) {
        try { rec.ws.close(); } catch { /* noop */ }
        registry.delete(projectId);
      }
    };
  }, [projectId]);
}
