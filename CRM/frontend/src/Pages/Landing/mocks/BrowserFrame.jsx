// A rounded "screenshot" frame that wraps a full-size CRM page mock and scales
// it down to a crisp render that fits the available width. The mock is authored
// at DESIGN_W (real console width); we measure the slot and apply a transform
// scale, then size the viewport to the scaled content height so there's no crop
// or empty gap. Pure DOM/text scales sharp (no raster blur).

import { useEffect, useRef, useState } from 'react';

const DESIGN_W = 1120;

export default function BrowserFrame({ children, screenHeight = null }) {
  const screenRef = useRef(null);
  const pageRef = useRef(null);
  const [dims, setDims] = useState({ scale: 0.5, h: screenHeight || 320 });

  useEffect(() => {
    const screen = screenRef.current;
    const page = pageRef.current;
    if (!screen || !page) return;
    // Fixed screenHeight → crop mode (constant frame height, so a switcher
    // doesn't jump). Otherwise auto-size the viewport to the scaled content.
    const measure = () => {
      const scale = screen.clientWidth / DESIGN_W;
      setDims({ scale, h: screenHeight != null ? screenHeight : page.scrollHeight * scale });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(screen);
    measure();
    // Re-measure once webfonts settle (metrics shift the content height).
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [children, screenHeight]);

  return (
    <div className="mk-frame">
      <div className="mk-screen" ref={screenRef} style={{ height: `${dims.h}px` }}>
        <div className="mk-page" ref={pageRef}
          style={{ width: `${DESIGN_W}px`, transform: `scale(${dims.scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
