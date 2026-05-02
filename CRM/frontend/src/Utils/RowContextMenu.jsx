import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle } from '@phosphor-icons/react';

// Right-click row/card context menu — single "Select" action that drops the
// row into the page-wide bulk-selection scope. Reuses the existing
// `.org-card-dropdown` visual language so the dropdown blends with the rest
// of the CRM (rounded card, soft shadow, accent-tint hover). Closes on Esc,
// click-outside, or window scroll.
//
// Caller manages the open-state:
//   const [ctx, setCtx] = useState(null); // { x, y, id }
//   <div onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, id }); }} />
//   {ctx && <RowContextMenu pos={ctx} onSelect={() => addToBulk(ctx.id)} onClose={() => setCtx(null)} />}
export function RowContextMenu({ pos, onSelect, onClose }) {
  useEffect(() => {
    const onKey   = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown  = (e) => {
      if (!e.target.closest?.('.row-ctx-menu')) onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  // Clamp inside the viewport so a right-click near the bottom/right edge
  // doesn't push the menu offscreen.
  const margin = 8;
  const width  = 200;
  const height = 60;
  const left = Math.max(margin, Math.min(pos.x, window.innerWidth  - width  - margin));
  const top  = Math.max(margin, Math.min(pos.y, window.innerHeight - height - margin));

  return createPortal(
    <div className="org-card-dropdown row-ctx-menu" style={{ top, left, minWidth: width }}
      onPointerDown={(e) => e.stopPropagation()}>
      <button type="button"
        className="org-card-dropdown-item"
        onClick={() => { onSelect(); onClose(); }}>
        <CheckCircle weight="bold" className="org-card-dropdown-icon" />
        Select
      </button>
    </div>,
    document.body
  );
}
