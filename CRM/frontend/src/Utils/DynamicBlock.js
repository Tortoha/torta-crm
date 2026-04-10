/**
 * DynamicBlock — sliding indicator that follows the active/hovered item.
 *
 * Usage:
 *   const { indRef, setItemRef } = DynamicBlock(hoveredKey ?? activeKey);
 *
 *   <div ref={indRef} className="my-indicator" />
 *   {items.map(item => (
 *     <button key={item.key} ref={setItemRef(item.key)}>...</button>
 *   ))}
 *
 * The indicator div must be position:absolute inside a position:relative container.
 * Its height and translateY are set directly via style — no state updates, zero re-renders.
 *
 * Uses offsetTop + offsetHeight (layout-relative, safe inside animated containers).
 * Never uses getBoundingClientRect() which breaks inside grid/clip transitions.
 */

import { useRef, useEffect } from 'react';

export function DynamicBlock(currentKey) {
  const indRef  = useRef(null);
  const itemEls = useRef({});

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      if (!ind) return;
      const el = currentKey != null ? itemEls.current[currentKey] : null;
      if (!el) { ind.style.opacity = '0'; return; }
      ind.style.opacity   = '1';
      ind.style.transform = `translateY(${el.offsetTop}px)`;
      ind.style.height    = `${el.offsetHeight}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [currentKey]);

  // Returns a stable ref callback for a given key
  const setItemRef = useRef({});
  const getRef = key => {
    if (!setItemRef.current[key])
      setItemRef.current[key] = el => { itemEls.current[key] = el; };
    return setItemRef.current[key];
  };

  return { indRef, setItemRef: getRef };
}
