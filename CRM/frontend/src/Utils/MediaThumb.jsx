import { useRef, useEffect } from 'react';

// Classify a media URL by extension (mirrors External's _media_type).
const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|$)/i;
const MODEL_RE = /\.(glb|usdz|gltf)(\?|$)/i;

export function mediaKind(url) {
  const u = (url || '').toLowerCase();
  if (VIDEO_RE.test(u)) return 'video';
  if (MODEL_RE.test(u)) return 'model';
  return 'image';
}

// Lightweight inline cube glyph — used for 3D models in compact contexts (line items,
// tree avatars) where spinning up a WebGL <model-viewer> per thumbnail is wasteful.
const CUBE_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
  '<g fill="none" stroke="#9aa0a6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M24 5 L41 14.5 L41 33.5 L24 43 L7 33.5 L7 14.5 Z"/>' +
  '<path d="M7 14.5 L24 24 L41 14.5"/><path d="M24 24 L24 43"/></g></svg>'
);

function Model3D({ url }) {
  // Lazy-load the (heavy) model-viewer web component only when a live 3D model is
  // actually rendered — keeps it out of the main bundle for the common case.
  useEffect(() => { import('@google/model-viewer'); }, []);
  return (
    <model-viewer
      src={url}
      auto-rotate
      rotation-per-second="28deg"
      interaction-prompt="none"
      style={{ width: '100%', height: '100%', backgroundColor: 'transparent', pointerEvents: 'none' }}
    />
  );
}

// Universal media thumbnail. Images render as a plain <img> (existing behaviour);
// videos get a YouTube-style hover preview (paused first frame → plays muted on hover);
// 3D models render an auto-rotating <model-viewer> when `live3d` is set (big product
// cards), or a lightweight cube placeholder otherwise. `className` is applied to the
// image/video element so every call site's existing sizing keeps working.
export default function MediaThumb({ url, alt, className, live3d = false }) {
  const kind = mediaKind(url);
  const vidRef = useRef(null);

  if (kind === 'video') {
    const play = () => {
      const v = vidRef.current;
      if (!v) return;
      try { v.currentTime = 0; const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    };
    const stop = () => {
      const v = vidRef.current;
      if (!v) return;
      try { v.pause(); v.currentTime = 0; } catch { /* ignore */ }
    };
    return (
      <span className="mthumb-wrap" onMouseEnter={play} onMouseLeave={stop}>
        <video ref={vidRef} className={className} src={url} muted loop playsInline preload="metadata" />
        <span className="mthumb-badge" aria-hidden="true">▶</span>
      </span>
    );
  }

  if (kind === 'model') {
    if (live3d) {
      return (
        <span className="mthumb-wrap mthumb-wrap--model">
          <Model3D url={url} />
          <span className="mthumb-badge" aria-hidden="true">3D</span>
        </span>
      );
    }
    // Compact: a plain cube glyph sized exactly like an image — no live WebGL viewer.
    return <img className={className} src={CUBE_SVG} alt={alt || '3D model'} />;
  }

  return <img className={className} src={url} alt={alt} />;
}
