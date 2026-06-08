import { useState } from 'react';
import MediaThumb, { mediaKind } from './MediaThumb.jsx';

// Real raster/vector image extensions — distinct from mediaKind()'s catch-all
// 'image' default (which also swallows PDFs, archives, .blend, … that must NOT be
// shoved into an <img>). Only these get a live thumbnail; everything else gets a
// neutral file chip stamped with its extension.
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|svg|bmp|ico|heic|heif)(\?|#|$)/i;

// Pull the extension (lowercase, no dot) from a URL, ignoring any ?query / #hash.
export function fileExt(url) {
  const clean = (url || '').split('?')[0].split('#')[0];
  const name  = clean.split('/').pop() || '';
  const dot   = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// True when MediaThumb can render the URL without a broken <img> — i.e. it's a
// video, a 3D model, or a genuine image.
export function isPreviewable(url) {
  return mediaKind(url) !== 'image' || IMAGE_RE.test((url || '').toLowerCase());
}

// A neutral "file chip" — a page-shaped tile (dog-eared corner) with the extension
// stamped on it. Used for anything that can't be shown directly (PDF, ZIP, BLEND,
// DOC …). Deliberately monochrome so it sits inside the console's restrained
// palette; real media is what brings colour to the list.
function FileChip({ ext }) {
  const label = (ext || 'file').toUpperCase().slice(0, 4);
  return (
    <span className="po-files-chip" aria-hidden="true">
      <span className="po-files-chip-ext">{label}</span>
    </span>
  );
}

// Universal digital-file preview. Images/video/3D render a live thumbnail; an image
// that fails to load (e.g. a private object that 403s) gracefully degrades to the
// file chip rather than a broken-image glyph. `className` is forwarded to the media
// element so the call site's sizing keeps working.
export default function FilePreview({ url, alt, className }) {
  const [imgFailed, setImgFailed] = useState(false);
  const kind = mediaKind(url);

  if (kind === 'video' || kind === 'model') {
    return <MediaThumb url={url} alt={alt} className={className} />;
  }

  if (IMAGE_RE.test((url || '').toLowerCase()) && !imgFailed) {
    return (
      <img className={className} src={url} alt={alt} loading="lazy"
        onError={() => setImgFailed(true)} />
    );
  }

  return <FileChip ext={fileExt(url)} />;
}
