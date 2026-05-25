import { useRef, useEffect } from 'react';

export function DynamicBlock(currentKey, resetKey) {
  const indRef  = useRef(null);
  const itemEls = useRef({});

  useEffect(() => {

    let raf1, raf2;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const ind = indRef.current;
        if (!ind) return;
        const el = currentKey != null ? itemEls.current[currentKey] : null;
        if (!el) { ind.style.opacity = '0'; return; }
        ind.style.opacity   = '1';
        ind.style.transform = `translateY(${el.offsetTop}px)`;
        ind.style.height    = `${el.offsetHeight}px`;
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [currentKey, resetKey]);

  const setItemRef = useRef({});
  const getRef = key => {
    if (!setItemRef.current[key])
      setItemRef.current[key] = el => { itemEls.current[key] = el; };
    return setItemRef.current[key];
  };

  return { indRef, setItemRef: getRef };
}
