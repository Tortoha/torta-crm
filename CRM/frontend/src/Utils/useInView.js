import { useEffect, useRef, useState } from 'react';

/* Tiny IntersectionObserver hook. Attach the ref to any DOM node;
   `inView` flips to true once the element crosses the threshold.
   With `once: true` (default) the observer disconnects after the first hit —
   reveal-on-scroll fires once and stays revealed, which is what every section
   on the landing wants. Set `{ once: false }` for scrollytelling steps that
   need to react to both entering and leaving the viewport. */
export function useInView({ threshold = 0.2, rootMargin = '0px', once = true } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reduced-motion users: don't gate visuals on scroll — show immediately.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            if (once) io.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { threshold, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, inView };
}
