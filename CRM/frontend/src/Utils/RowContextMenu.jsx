import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle } from '@phosphor-icons/react';

// Right-click context menu with a single "Select" action that enters bulk-mode for the caller's scope.
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

  // Clamp inside viewport.
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
