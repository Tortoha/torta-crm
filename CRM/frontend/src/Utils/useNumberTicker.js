import { useEffect, useState } from 'react';

/* Eased number tween from 0 → target, kicked off when `active` flips true.
   Cheaper than a CSS counter trick and lets us format the number however we want
   (e.g. "5+", "100 ms"). Idles at 0 until the consumer (usually a useInView ref)
   says "go". */
export function useNumberTicker(target, { active = true, duration = 1200 } = {}) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return;
    // Reduced-motion: snap to final value, no animation.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = now => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out cubic — quick start, soft landing on the target.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration]);

  return value;
}
