import { useCallback, useEffect, useRef } from 'react';

/* Magnetic-button hook — the element drifts toward the cursor while the cursor
   is within `radius` px of its centre. On leave we lerp back to neutral.
   We write `transform` directly via rAF instead of useState to keep the hover
   re-render-free (one button shouldn't be repainting React on every mouse-move).
   Returns a ref to spread onto the element. */
export function useMagnetic({ radius = 90, strength = 0.32 } = {}) {
  const ref     = useRef(null);
  const curRef  = useRef({ x: 0, y: 0 });
  const tgtRef  = useRef({ x: 0, y: 0 });
  const rafRef  = useRef(0);

  const loop = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const c = curRef.current, tgt = tgtRef.current;
    c.x += (tgt.x - c.x) * 0.18;
    c.y += (tgt.y - c.y) * 0.18;
    el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0)`;
    if (Math.abs(tgt.x - c.x) + Math.abs(tgt.y - c.y) > 0.1) {
      rafRef.current = requestAnimationFrame(loop);
    } else {
      // settled — drop the loop until next move
      el.style.transform = `translate3d(${tgt.x}px, ${tgt.y}px, 0)`;
      rafRef.current = 0;
    }
  }, []);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const move = e => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width  / 2;
      const cy = r.top  + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) {
        if (tgtRef.current.x === 0 && tgtRef.current.y === 0) return;
        tgtRef.current = { x: 0, y: 0 };
      } else {
        tgtRef.current = { x: dx * strength, y: dy * strength };
      }
      if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
    };
    const leave = () => {
      tgtRef.current = { x: 0, y: 0 };
      if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
    };
    window.addEventListener('mousemove', move, { passive: true });
    window.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseleave', leave);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [radius, strength, loop]);

  return ref;
}
