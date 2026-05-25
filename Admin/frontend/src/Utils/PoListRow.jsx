// Reusable list-row wrapper with InteractiveSection tilt+gloss; one component per row so the hook works inside .map().

import { InteractiveSection } from './InteractiveSection.js';

const ROW_TILT = {
  maxAngleX: 10, maxAngleY: 4, lerp: 0.05, lerpOut: 0.07,
  scale: 1.052, perspective: 900,
  gloss: { opacity: 0.14, spread: 40 },
};

export function PoListRow({ className = '', children, frozen = false, ...rest }) {
  const { ref, glossRef, handlers } = InteractiveSection(ROW_TILT, frozen);
  // Frozen class suppresses :hover styles in Products.css while a row-level menu is open.
  const cls = `po-set-row ${className}${frozen ? ' po-set-row--frozen' : ''}`.trim();
  return (
    <div ref={ref}
      className={cls}
      {...handlers}
      {...rest}>
      <div ref={glossRef} className="po-set-row-gloss" />
      {children}
    </div>
  );
}
