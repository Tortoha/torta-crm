// Live cursors — renders the other users' mouse pointers as fixed-position
// SVG arrows over the page. Mounted by Layouts that want collaborative
// cursors (project + product pages). Self is auto-excluded by useOnRoute.
//
// Coords are CONTENT-relative pixels (scroll-corrected) inside .crm-main —
// the scroll container shared by every authenticated CRM layout. A peer
// pointing at the "Polo Sweater" card lands on the same card for receivers
// regardless of their monitor size or scroll position. When viewports
// differ enough that responsive layout reflows differently, the cursor
// drifts; full element-locked tracking would need a DOM-selector exchange
// (Figma-style) which we skip for now.

import { useEffect, useReducer } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import {
  useOnRoute,
  startCursorReporting,
  stopCursorReporting,
} from '../Utils/usePresence.js';
import '../Style/CursorOverlay.css';

function colourFor(seed) {
  const palette = ['#0071E3', '#8b5cf6', '#06b6d4', '#f97316', '#f43f5e', '#d946ef', '#10b981'];
  const code = (String(seed) || 'a').charCodeAt(0) || 0;
  return palette[code % palette.length];
}

// Read the receiver-side .crm-main offset + scroll. Used to project a
// peer's content-relative coords back to viewport pixels.
function readContentFrame() {
  const main = typeof document !== 'undefined'
    ? document.querySelector('.crm-main')
    : null;
  if (!main) return { left: 0, top: 0, scrollLeft: 0, scrollTop: 0 };
  const rect = main.getBoundingClientRect();
  return {
    left:       rect.left,
    top:        rect.top,
    scrollLeft: main.scrollLeft,
    scrollTop:  main.scrollTop,
  };
}

function Cursor({ snap, frame }) {
  // Two-tier resolution:
  // (a) Element-lock — find the same DOM node the sender was over and
  //     project the offset inside it. This survives grid reflow (4-col on
  //     wide screen vs 3-col on narrow): the "Polo Sweater" card lives in
  //     a different column but the selector resolves to the same DOM node.
  // (b) Fallback to content-relative pixels (already scroll-corrected) so
  //     the cursor still shows when the selector doesn't resolve (e.g.
  //     receiver is on a slightly different sub-page).
  let x, y;
  if (snap.cursor_anchor) {
    try {
      const el = document.querySelector(snap.cursor_anchor);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          x = r.left + r.width  * (snap.cursor_ox || 0);
          y = r.top  + r.height * (snap.cursor_oy || 0);
        }
      }
    } catch { /* invalid selector — drop through to fallback */ }
  }
  if (x === undefined) {
    x = (snap.cursor_x || 0) + frame.left - frame.scrollLeft;
    y = (snap.cursor_y || 0) + frame.top  - frame.scrollTop;
  }
  const colour = colourFor(snap.email || snap.name || String(snap.user_id));
  const label  = snap.name || snap.email || '';
  return (
    <div className="cur-pointer" style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}>
      <svg className="cur-arrow" viewBox="0 0 18 18" width="18" height="18">
        {/* Figma-style pointer — each corner of the path itself is rounded
            with a quadratic curve (Q) instead of the previous sharp L
            joins. The round stroke joins + caps still soften the outline,
            but the fill no longer has hard points so the silhouette reads
            smoother at any zoom. */}
        <path
          d="M 3 2.5
             L 14 9
             Q 14.6 9.3 14 9.8
             L 9.6 10.1
             Q 8.8 10.3 8.5 11
             L 6.8 15.2
             Q 6.1 16.2 5.6 15.1
             Z"
          fill={colour}
          stroke="#fff"
          strokeWidth="1"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {label && (
        <span className="cur-label" style={{ background: colour }}>
          {label}
        </span>
      )}
    </div>
  );
}

export default function CursorOverlay() {
  const loc = useLocation();
  // forceTick re-renders the overlay when scroll / resize changes our
  // .crm-main frame — no need to memoise the frame object itself.
  const [, forceTick] = useReducer(n => n + 1, 0);

  useEffect(() => {
    let raf = 0;
    const tick = () => { raf = 0; forceTick(); };
    const onChange = () => {
      // Coalesce bursts (scroll fires 100s/sec) into one repaint per frame.
      if (!raf) raf = requestAnimationFrame(tick);
    };
    // Listen on .crm-main (the actual scroll container in CRM layouts) and
    // window for resize. Capture-phase catches scroll on the inner element
    // because scroll events don't bubble.
    const main = document.querySelector('.crm-main');
    main?.addEventListener('scroll', onChange, { passive: true });
    window.addEventListener('resize', onChange, { passive: true });
    return () => {
      main?.removeEventListener('scroll', onChange);
      window.removeEventListener('resize', onChange);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    startCursorReporting();
    return stopCursorReporting;
  }, []);

  const others = useOnRoute(loc.pathname);
  const cursors = others.filter(
    s => typeof s.cursor_x === 'number' && typeof s.cursor_y === 'number'
  );
  if (cursors.length === 0) return null;
  const frame = readContentFrame();
  return createPortal(
    <div className="cur-layer">
      {cursors.map(s => <Cursor key={s.user_id} snap={s} frame={frame} />)}
    </div>,
    document.body,
  );
}
