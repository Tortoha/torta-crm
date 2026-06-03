// Verbatim copy of the CRM 'Revenue over time' chart (Pages/Project/Analytics.jsx)
// so the Admin Signups chart is pixel-identical to the page the user pointed at.
// Always pass formatValue/valueKey/dateKey — the in-CRM default used a currency
// helper (fmtMoney) that isn't present in the Admin app.
import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';

export function LineChart({
  data = [],            // history slice, [{bucket, revenue, ...}, ...]
  compareData = [],     // optional second series rendered as a dashed line
  viewportBuckets = 30, // how many buckets fit in the visible viewport (zoom)
  height = 320,
  valueKey = 'revenue',
  dateKey = 'bucket',
  // Default formatter uses fmtMoney (module-level, currency-aware).
  // Cents are preserved when the value has a non-zero fractional
  // part вЂ” Order #74 totalling $1,336.33 should NOT round down to
  // $1,336 on the tooltip; that misleads the merchant about real
  // revenue. Round only the trailing `.00` (whole dollars) for
  // chart readability.
  formatValue = (v) => fmtMoney(+v || 0).replace(/[.,]00\b/, ''),
  onZoom,
  onLoadMore,           // called when scroll approaches the left edge
  loadingMore = false,  // true while a prepend fetch is in flight
  onBucketClick,        // (bucket, data) вЂ” fired on click (not drag)
}) {
  const wrapperRef     = useRef(null);
  const scrollGroupRef = useRef(null);
  const scrollXRef     = useRef(0);  // mutable scroll position (px translation)
  const dragRef        = useRef({ active: false, startX: 0, startScrollX: 0 });
  const prevDataLenRef = useRef(0);  // for prepend-detection
  const prevViewportRef = useRef(viewportBuckets); // for zoom-change detection
  // Once the user manually drags, we stop auto-anchoring to rightmost
  // on resize so we don't yank them out of the history view they were
  // looking at. Reset on (initial load, zoom change, granularity change).
  const userScrolledRef = useRef(false);

  const [wrapperW, setWrapperW] = useState(1000);
  const [hover,    setHover]    = useState(null);
  const [version,  setVersion]  = useState(0); // bump to force re-render after commit

  // Responsive width вЂ” recompute layout when the wrapper resizes.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const sync = () => setWrapperW(wrapperRef.current?.clientWidth || 1000);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  const h = height;
  const padL = 24, padR = 72, padT = 28, padB = 38;
  const innerH = h - padT - padB;
  const innerW = Math.max(50, wrapperW - padL - padR);
  // 1 bucket = innerW / viewportBuckets pixels (always, regardless of
  // data length вЂ” keeps the per-bucket scale consistent at a chosen zoom).
  const bucketPx   = innerW / Math.max(1, viewportBuckets);
  const dataWidthPx = data.length * bucketPx;
  // Scroll position where the LAST data point sits at the right edge:
  // scrollX + padL + (data.length - 0.5) * bucketPx = wrapperW - padR
  const scrollAtRightmost = innerW - (data.length - 0.5) * bucketPx;
  // Scroll position where the FIRST data point sits at the left edge:
  // scrollX + padL + 0.5 * bucketPx = padL  в†’  scrollX = -0.5 * bucketPx
  const scrollAtLeftmost  = -0.5 * bucketPx;
  const canScroll = dataWidthPx > innerW;
  // Drag clamp range (min = most-negative, max = least-negative).
  const minScroll = canScroll ? scrollAtRightmost : scrollAtRightmost;
  const maxScroll = canScroll ? scrollAtLeftmost  : scrollAtRightmost;

  // Layout-effect helper вЂ” write scroll position to DOM WITHOUT firing
  // the lazy-load trigger. Used for programmatic re-anchoring (initial
  // load, resize re-anchor, prepend compensation). The user-driven
  // writeScroll wrapper (defined below for drag handlers) adds the
  // load-more side-effect on top.
  const writeScrollPosition = (x) => {
    scrollXRef.current = x;
    if (scrollGroupRef.current) {
      scrollGroupRef.current.setAttribute('transform', `translate(${x}, 0)`);
    }
  };

  // Layout effect вЂ” runs synchronously BEFORE paint so the user never
  // sees a frame with old scroll position + new data. Five cases:
  //   (1) Initial load: snap to rightmost (latest data on screen).
  //   (2) Prepend (lazy load): keep visual anchor by shifting scrollX
  //       by -N*bucketPx where N is the prepended bucket count.
  //   (3) Zoom change: viewportBuckets shifted вЂ” user picked a new
  //       scale, snap back to rightmost (their reference frame moved).
  //   (4) Resize before user has scrolled: re-anchor to rightmost so
  //       the initial dimension (default wrapperW=1000) doesn't leave
  //       the chart sitting in the middle of history after the
  //       ResizeObserver lands the real width.
  //   (5) Resize after user has scrolled: just clamp to the new range.
  useLayoutEffect(() => {
    const prev           = prevDataLenRef.current;
    const cur            = data.length;
    const viewportChanged = prevViewportRef.current !== viewportBuckets;
    prevViewportRef.current = viewportBuckets;

    if (prev === 0 && cur > 0) {
      // (1) initial load
      userScrolledRef.current = false;
      writeScrollPosition(scrollAtRightmost);
      setHover(null);
    } else if (prev > 0 && cur > prev) {
      // (2) prepend
      const added = cur - prev;
      writeScrollPosition(scrollXRef.current - added * bucketPx);
      setHover(h => h != null ? h + added : null);
    } else if (cur > 0 && viewportChanged) {
      // (3) zoom change вЂ” explicit reset
      userScrolledRef.current = false;
      writeScrollPosition(scrollAtRightmost);
    } else if (cur > 0 && !userScrolledRef.current) {
      // (4) resize / layout shift, user hasn't scrolled вЂ” re-anchor
      writeScrollPosition(scrollAtRightmost);
    } else if (cur > 0) {
      // (5) resize after user-scroll вЂ” clamp to valid range
      const clamped = Math.max(scrollAtRightmost,
                       Math.min(scrollAtLeftmost, scrollXRef.current));
      if (clamped !== scrollXRef.current) writeScrollPosition(clamped);
    }
    prevDataLenRef.current = cur;
  }, [data.length, scrollAtRightmost, scrollAtLeftmost, bucketPx, viewportBuckets]);

  // Y-axis: range across BOTH series so the scale fits the larger
  // of current vs comparison. Stable as the user pans.
  const allVals = [
    ...data.map(d => +d[valueKey] || 0),
    ...compareData.map(d => +d[valueKey] || 0),
  ];
  const maxRaw  = Math.max(1, ...allVals);
  const minRaw  = Math.min(0, ...allVals);
  const max = maxRaw + (maxRaw - minRaw) * 0.1;
  const min = minRaw;

  // X position of bucket i (in chart coordinate space вЂ” the scrolling
  // group will translate this whole space by scrollX on the screen).
  const xScale = (i) => padL + (i + 0.5) * bucketPx;
  const yScale = (v) => {
    const range = max - min || 1;
    return padT + innerH * (1 - (v - min) / range);
  };

  // Catmull-Rom path with sampled-and-clamped polyline output (no
  // sub-baseline dips, smooth shoulders, fat enough to look natural
  // around isolated peaks).
  const yTop = padT, yBot = padT + innerH;
  const SAMPLES = 16;
  const clampY = (y) => Math.max(yTop, Math.min(yBot, y));
  // Build a Catmull-Rom-sampled SVG path string for an arbitrary data
  // series. Extracted so both the primary chart line and the optional
  // comparison overlay can share the math.
  const buildPath = useCallback((series) => {
    if (series.length < 2) {
      if (series.length === 1) {
        return `M${xScale(0).toFixed(1)},${clampY(yScale(+series[0][valueKey] || 0)).toFixed(1)}`;
      }
      return '';
    }
    const pts = series.map((d, i) => [xScale(i), yScale(+d[valueKey] || 0)]);
    let p = `M${pts[0][0].toFixed(1)},${clampY(pts[0][1]).toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      for (let s = 1; s <= SAMPLES; s++) {
        const t = s / SAMPLES;
        const u = 1 - t;
        const u3 = u*u*u, u2t = 3*u*u*t, ut2 = 3*u*t*t, t3 = t*t*t;
        const x = u3*p1[0] + u2t*cp1x + ut2*cp2x + t3*p2[0];
        const y = u3*p1[1] + u2t*cp1y + ut2*cp2y + t3*p2[1];
        p += ` L${x.toFixed(1)},${clampY(y).toFixed(1)}`;
      }
    }
    return p;
  }, [bucketPx, max, min, padL, padT, innerH, valueKey]);
  const pathD        = useMemo(() => buildPath(data),        [buildPath, data]);
  const comparePathD = useMemo(() => buildPath(compareData), [buildPath, compareData]);

  // Y-axis ticks вЂ” 5 evenly spaced.
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const v = max - ((max - min) * i) / (tickCount - 1);
    return { v, y: padT + (innerH * i) / (tickCount - 1) };
  });

  // X-axis label density вЂ” ~one label per 100 px.
  const labelStep = Math.max(1, Math.round(100 / Math.max(1, bucketPx)));
  const fmtX = (val) => {
    if (!val) return '';
    try {
      const d = new Date(val);
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    } catch { return String(val); }
  };
  const fmtXFull = (val) => {
    if (!val) return '';
    try {
      const d = new Date(val);
      return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch { return String(val); }
  };
  const fmtY = (v) => {
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
    return v.toFixed(v > 10 ? 0 : 1);
  };

  // Drag handlers вЂ” write directly to the DOM, no React re-render until
  // gesture ends. setVersion bump at release forces ONE final re-render
  // so React JSX (e.g. transform="translate(...)") stays in sync with
  // the imperative scroll position (otherwise the next React render
  // would clobber our DOM mutation with the stale JSX value).
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Drag-driven scroll write вЂ” same as writeScrollPosition plus the
  // lazy-load trigger. The split lets the layout-effect re-anchor
  // programmatically without spamming onLoadMore as it touches the
  // left edge mathematically.
  const writeScroll = (x) => {
    writeScrollPosition(x);
    if (onLoadMore && !loadingMore && canScroll) {
      const range            = scrollAtLeftmost - scrollAtRightmost;
      const distFromLeftmost = scrollAtLeftmost - x;
      if (range > 0 && distFromLeftmost / range < 0.25) {
        onLoadMore();
      }
    }
  };
  // Pointer events handle mouse + touch + pen with one code path. `e.pointerType`
  // tells us which kind ("mouse" / "touch" / "pen") so hover can be mouse-only
  // (touch has no concept of hover вЂ” finger leaves screen в†’ no fired moves).
  // setPointerCapture keeps the move events flowing to the wrapper even when
  // the user's finger drags outside its bounds.
  const handlePointerDown = (e) => {
    // Ignore non-primary mouse buttons (right-click etc.) вЂ” only main
    // button or first touch contact drives the pan.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startScrollX: scrollXRef.current,
      // Track travel so handlePointerUp can distinguish click vs drag.
      // Anything under ~5 px = click (open drill-down), more = pan.
      moved: 0,
    };
    setHover(null);
    if (wrapperRef.current) {
      wrapperRef.current.style.cursor = 'grabbing';
      try { wrapperRef.current.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    }
    userScrolledRef.current = true;
  };
  const handlePointerMove = (e) => {
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      // Track total motion so we can tell a click from a drag on
      // pointer-up. Use raw dx вЂ” even slight horizontal motion past
      // the threshold means the user is panning.
      if (Math.abs(dx) > Math.abs(dragRef.current.moved)) {
        dragRef.current.moved = dx;
      }
      writeScroll(clamp(dragRef.current.startScrollX + dx, minScroll, maxScroll));
      return;
    }
    // Hover crosshair is for pointing devices (mouse / pen) only вЂ” touch
    // has no "hover" semantics, and a sticky tooltip after every tap
    // reads like a bug.
    if (e.pointerType === 'touch') return;
    if (!data.length || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const xScreen = e.clientX - rect.left;
    const i = Math.floor((xScreen - scrollXRef.current - padL) / bucketPx);
    if (i >= 0 && i < data.length) setHover(i);
    else setHover(null);
  };
  // Click threshold вЂ” drag of <5 px on release counts as a click rather
  // than a pan. Big enough to absorb hand jitter on touchscreens, small
  // enough that a deliberate swipe still registers as pan.
  const CLICK_THRESHOLD_PX = 5;
  const endDrag = (e) => {
    const wasActive = dragRef.current.active;
    const movedPx   = Math.abs(dragRef.current.moved || 0);
    if (wasActive) {
      dragRef.current.active = false;
      // Force one re-render so the React-managed transform attribute on
      // the scrolling group matches the imperative DOM position. Without
      // this, the next state-driven re-render (e.g. on hover) would
      // reset the transform back to whatever JSX last wrote.
      setVersion(v => v + 1);
    }
    if (wrapperRef.current) {
      wrapperRef.current.style.cursor = 'grab';
      if (e?.pointerId != null) {
        try { wrapperRef.current.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      }
    }
    // Click detection вЂ” pointer-up after barely any movement = open
    // drill-down for the bucket under the cursor. Resolves the bucket
    // from the up-event's screen position so it works even for touch
    // taps that never fired a hover.
    if (wasActive && movedPx < CLICK_THRESHOLD_PX && onBucketClick && e && data.length) {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        const xScreen = e.clientX - rect.left;
        const i = Math.floor((xScreen - scrollXRef.current - padL) / bucketPx);
        if (i >= 0 && i < data.length) {
          onBucketClick(data[i][dateKey], data[i]);
        }
      }
    }
  };
  const handlePointerUp     = (e) => endDrag(e);
  const handlePointerLeave  = (e) => { endDrag(e); setHover(null); };
  const handlePointerCancel = (e) => endDrag(e);
  const handleWheel         = (e) => {
    if (!onZoom || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    onZoom(e.deltaY > 0 ? +1 : -1);
  };

  // Hover point in CHART coords (still inside the scrolling group, so
  // crosshair tracks the data when the group translates).
  const hoverPt = hover != null && data[hover] ? {
    x: xScale(hover),
    y: yScale(+data[hover][valueKey] || 0),
    val: +data[hover][valueKey] || 0,
    date: data[hover][dateKey],
  } : null;

  // Unique clip-path id so multiple charts on a page don't collide.
  const clipId = `an-chart-clip-${valueKey}`;

  // Wrapper: overflow:hidden creates the viewport. The SVG is sized to
  // the wrapper width (no viewBox stretch). The scrolling group inside
  // the SVG is the ONLY element we translate вЂ” Y-axis labels sit at
  // fixed positions outside that group so they stay put while the user
  // pans through history.
  return (
    <div ref={wrapperRef}
         className="an-chart-wrap"
         onPointerDown={handlePointerDown}
         onPointerMove={handlePointerMove}
         onPointerUp={handlePointerUp}
         onPointerLeave={handlePointerLeave}
         onPointerCancel={handlePointerCancel}
         onWheel={handleWheel}
         style={{
           overflow: 'hidden',
           cursor: canScroll ? 'grab' : 'default',
           // Disable browser horizontal pan-scroll so our drag handler
           // owns horizontal gestures. Vertical scroll (pan-y) still
           // works so users can scroll the page through the chart on
           // mobile вЂ” only horizontal swipes are intercepted.
           touchAction: 'pan-y',
           userSelect: 'none',
           width: '100%',
           position: 'relative',
         }}>
    <svg className="an-chart" width={wrapperW} height={h}
         style={{ display: 'block', width: '100%' }}>
      <defs>
        <clipPath id={clipId}>
          {/* Clip HORIZONTALLY only вЂ” keep the full chart height so the
              x-axis date labels (rendered at y = h - 14, below the data
              area) stay visible. Previously height was `innerH + 32`
              which capped at y = padT + innerH + 16, hiding the date
              labels at y = 306 (chart height 320). */}
          <rect x={padL} y={0}
                width={wrapperW - padL - padR} height={h} />
        </clipPath>
      </defs>

      {/* Fixed: Y grid lines + labels (right side). Do NOT scroll. */}
      {ticks.map((t, i) => (
        <g key={`tick-${i}`}>
          <line x1={padL} x2={wrapperW - padR} y1={t.y} y2={t.y}
                stroke="var(--chart-grid)" strokeWidth="1" />
          <text x={wrapperW - padR + 8} y={t.y + 4} textAnchor="start"
                fontSize="11" fill="#9a9aa0" fontFamily="inherit">
            {fmtY(t.v)}
          </text>
        </g>
      ))}

      {/* Scrollable group вЂ” path + X labels + hover crosshair live
          inside, all share the same translate(scrollX, 0). */}
      <g clipPath={`url(#${clipId})`}>
        <g ref={scrollGroupRef}
           transform={`translate(${scrollXRef.current}, 0)`}
           data-version={version}>
          {/* X-axis labels вЂ” auto-thinned so they don't overlap.
             First/last labels anchor to start/end respectively so they
             don't spill off the chart on narrow viewports (was getting
             cut to "r 25" / "Ma" on mobile when textAnchor was middle). */}
          {data.map((d, i) => {
            if (i % labelStep !== 0 && i !== data.length - 1) return null;
            const anchor = i === 0
              ? 'start'
              : i === data.length - 1
                ? 'end'
                : 'middle';
            return (
              <text key={`xlabel-${i}`}
                    x={xScale(i)} y={h - 14}
                    textAnchor={anchor} fontSize="11"
                    fill="#9a9aa0" fontFamily="inherit">
                {fmtX(d[dateKey])}
              </text>
            );
          })}

          {/* Comparison series вЂ” drawn FIRST so the main line stays
              on top. Dashed + thinner + 50 % opacity so it reads as
              "supporting context", not competing with the primary
              metric. */}
          {comparePathD && (
            <path d={comparePathD} fill="none"
                  stroke="var(--accent)" strokeWidth="1.8"
                  strokeDasharray="6 4"
                  strokeLinecap="round" strokeLinejoin="round"
                  opacity="0.45" />
          )}
          {/* Data path вЂ” solid accent line. */}
          <path d={pathD} fill="none"
                stroke="var(--accent)" strokeWidth="2.6"
                strokeLinecap="round" strokeLinejoin="round" />

          {/* Hover crosshair + dot вЂ” inside the scrolling group so they
              follow data when the user pans. Hidden during drag. */}
          {hoverPt && !dragRef.current.active && (
            <g>
              <line x1={hoverPt.x} x2={hoverPt.x}
                    y1={padT} y2={padT + innerH}
                    stroke="var(--chart-grid-strong)" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={hoverPt.x} cy={hoverPt.y} r="6"
                      fill="var(--accent)" stroke="#fff" strokeWidth="2" />
            </g>
          )}
        </g>
      </g>

      {/* Tooltip bubble вЂ” OUTSIDE the scrolling group so it isn't
          clipped or translated. Its screen x is the chart-x plus the
          current scrollX. Hidden during drag. */}
      {hoverPt && !dragRef.current.active && (() => {
        const screenX = hoverPt.x + scrollXRef.current;
        if (screenX < padL || screenX > wrapperW - padR) return null;
        const valStr = formatValue(hoverPt.val);
        const bw = Math.max(60, valStr.length * 7 + 16);
        const bx = Math.max(padL, Math.min(wrapperW - padR - bw, screenX - bw / 2));
        const by = Math.max(padT, hoverPt.y - 38);
        return (
          <g pointerEvents="none">
            <rect x={bx} y={by} width={bw} height="24" rx="6"
                  fill="var(--accent)" />
            <text x={bx + bw / 2} y={by + 16} textAnchor="middle"
                  fontSize="12" fontWeight="600" fill="#fff"
                  fontFamily="inherit">
              {valStr}
            </text>
            <text x={screenX} y={Math.max(padT - 6, hoverPt.y - 44)}
                  textAnchor="middle" fontSize="11" fill="var(--muted)"
                  fontFamily="inherit">
              {fmtXFull(hoverPt.date)}
            </text>
          </g>
        );
      })()}
    </svg>
    </div>
  );
}
