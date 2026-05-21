import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle } from '@phosphor-icons/react';

// Right-click context menu with the same Dynamic Block sliding indicator as ProdMenu/CardMenu (org-menu-* classes).
//   1. Legacy: pass only `onSelect` → renders a single "Select" entry.
//   2. Extended: pass `items={[{label, icon, onClick, danger?}]}` → renders the full menu.
export function RowContextMenu({ pos, items, onSelect, onClose }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(null);
  const indRef   = useRef(null);
  const itemEls  = useRef({});

  useEffect(() => {
    const onKey   = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown  = (e) => { if (!e.target.closest?.('.row-ctx-menu')) onClose(); };
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

  const list = items || (onSelect ? [{
    label: t('utils.rowMenu.select'),
    icon: <CheckCircle weight="bold" className="org-card-dropdown-icon" />,
    onClick: onSelect,
  }] : []);

  // Dynamic Block: position indicator under the hovered item. Hide when nothing is hovered.
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      if (!ind) return;
      const el = hovered != null ? itemEls.current[hovered] : null;
      if (!el) { ind.style.opacity = '0'; ind.style.height = '0'; return; }
      ind.style.opacity   = '1';
      ind.style.transform = `translateY(${el.offsetTop}px)`;
      ind.style.height    = `${el.offsetHeight}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [hovered, list.length]);

  // Clamp inside viewport.
  const margin = 8;
  const width  = 220;
  const itemH  = 36;
  const height = Math.min(list.length * itemH + 12, 320);
  const left = Math.max(margin, Math.min(pos.x, window.innerWidth  - width  - margin));
  const top  = Math.max(margin, Math.min(pos.y, window.innerHeight - height - margin));

  return createPortal(
    <div className="org-card-dropdown row-ctx-menu" style={{ top, left, minWidth: width, position: 'fixed' }}
      onPointerDown={(e) => e.stopPropagation()}>
      {/* Indicator + items: same wrapper structure as ProdMenu/CardMenu */}
      <div className="org-menu-block" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef}
          className={`org-menu-indicator${hovered != null && list[hovered]?.danger ? ' org-menu-indicator--danger' : ''}`} />
        {list.map((it, i) => (
          <button key={i} type="button"
            ref={el => { if (el) itemEls.current[i] = el; else delete itemEls.current[i]; }}
            className={`org-card-dropdown-item org-menu-item${it.danger ? ' org-card-dropdown-item--danger' : ''}${hovered === i ? ' org-menu-item--current' : ''}`}
            onMouseEnter={() => setHovered(i)}
            onClick={() => { it.onClick?.(); onClose(); }}>
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
