import { useRef, useCallback, useEffect } from 'react';

export function InteractiveSection(config, frozen = false) {
  const ref      = useRef(null);
  const glossRef = useRef(null);
  const rafRef   = useRef(null);
  const cur      = useRef({ rx: 0, ry: 0, x: 0, y: 0, scale: 1 });
  const tgt      = useRef({ rx: 0, ry: 0, x: 0, y: 0, scale: 1, hovered: false });
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const cfgRef = useRef(config);

  const loop = useCallback(() => {
    const cfg = cfgRef.current;
    const c = cur.current, t = tgt.current;
    const lf = t.hovered ? cfg.lerp : cfg.lerpOut;

    c.rx    += (t.rx    - c.rx)    * lf;
    c.ry    += (t.ry    - c.ry)    * lf;
    c.x     += (t.x     - c.x)     * lf;
    c.y     += (t.y     - c.y)     * lf;
    c.scale += (t.scale - c.scale) * lf;

    const el = ref.current;
    if (!el) return;
    el.style.transform =
      `perspective(${cfg.perspective}px) rotateX(${c.rx}deg) rotateY(${c.ry}deg) scale(${c.scale})`;

    if (glossRef.current) {
      glossRef.current.style.opacity = t.hovered ? '1' : '0';
      glossRef.current.style.backgroundImage =
        `radial-gradient(circle at ${50 + c.x * cfg.gloss.spread}% ${50 + c.y * cfg.gloss.spread}%,` +
        ` rgba(255,255,255,${cfg.gloss.opacity}) 0%, transparent 70%)`;
    }

    // Stop the loop when close enough to neutral
    if (!t.hovered && Math.abs(c.rx) + Math.abs(c.ry) + Math.abs(c.scale - 1) * 20 < 0.05) {
      el.style.transform = '';
      cur.current = { rx: 0, ry: 0, x: 0, y: 0, scale: 1 };
      rafRef.current = null;
      return;
    }

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // Smoothly return to neutral when frozen (e.g. menu opened)
  useEffect(() => {
    if (!frozen) return;
    Object.assign(tgt.current, { hovered: false, rx: 0, ry: 0, x: 0, y: 0, scale: 1 });
    if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
  }, [frozen, loop]);

  const onMouseEnter = useCallback(() => {
    if (frozenRef.current) return;
    tgt.current.hovered = true;
    tgt.current.scale   = cfgRef.current.scale;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const onMouseMove = useCallback(e => {
    if (frozenRef.current) return;
    const el = ref.current;
    if (!el) return;
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = (e.clientX - left) / width  - 0.5;
    const y = (e.clientY - top)  / height - 0.5;
    const cfg = cfgRef.current;
    tgt.current.rx = -y * (cfg.maxAngleX ?? cfg.maxAngle);
    tgt.current.ry =  x * (cfg.maxAngleY ?? cfg.maxAngle);
    tgt.current.x  = x;
    tgt.current.y  = y;
  }, []);

  const onMouseLeave = useCallback(() => {
    Object.assign(tgt.current, { hovered: false, rx: 0, ry: 0, x: 0, y: 0, scale: 1 });
  }, []);

  return {
    ref,
    glossRef,
    handlers: { onMouseEnter, onMouseMove, onMouseLeave },
  };
}
