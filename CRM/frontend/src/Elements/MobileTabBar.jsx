import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DotsThree } from '@phosphor-icons/react';
import '../Style/MobileTabBar.css';

/**
 * MobileTabBar — fixed bottom tab bar visible only below 640px (xxs).
 *
 * Props:
 *   items: [{ to, label, Icon, exact?, match? }] — 4 entries max (5th is "More")
 *   onMore: () => void — called when "More" tab is tapped (opens sidebar drawer)
 *
 * The bar is laid out as 5 equal columns. `to` and `exact` use react-router
 * NavLink semantics. Custom `match` (regex) overrides default isActive
 * detection — useful when a tab represents a section (e.g. /products covers
 * /products/categories, /products/inventory, etc.).
 *
 * Visibility is CSS-driven (display: none above 639px) — Layout components
 * unconditionally render this; the tab bar simply hides on larger screens.
 *
 * Touch targets are 56px tall (above iOS 44 min). Bar respects iOS safe-area.
 */
export default function MobileTabBar({ items = [], onMore }) {
  const { t }      = useTranslation();
  const location   = useLocation();

  // When onMore is provided → cap at 4 tabs and append "More" (opens sidebar).
  // When omitted → show all items (up to 5), no More button (use case: layouts
  // where the sidebar nav IS exactly the tab bar — e.g. ProductLayout's 5 flat
  // items). 0 items → render nothing (otherwise we'd show a bare More tab).
  const showMore   = typeof onMore === 'function';
  const visible    = showMore ? items.slice(0, 4) : items.slice(0, 5);
  if (visible.length === 0 && !showMore) return null;
  const colCount   = visible.length + (showMore ? 1 : 0);

  const isCurrent = ({ to, exact, match }) => {
    if (match) {
      const re = match instanceof RegExp ? match : new RegExp(match);
      return re.test(location.pathname);
    }
    if (exact) return location.pathname === to;
    return location.pathname === to || location.pathname.startsWith(to + '/');
  };

  return (
    <nav className="mtb-root" role="navigation"
         style={{ '--mtb-cols': colCount }}
         aria-label={t('nav.mobile', 'Mobile navigation')}>
      {visible.map(({ to, label, Icon, exact, match }) => {
        const current = isCurrent({ to, exact, match });
        return (
          <NavLink
            key={to}
            to={to}
            end={!!exact}
            className={`mtb-item${current ? ' mtb-item--current' : ''}`}
          >
            <Icon className="mtb-icon" weight={current ? 'fill' : 'regular'} />
            <span className="mtb-label">{label}</span>
          </NavLink>
        );
      })}
      {showMore && (
        <button
          type="button"
          className="mtb-item mtb-item--more"
          onClick={onMore}
          aria-label={t('nav.more', 'More')}
        >
          <DotsThree className="mtb-icon" weight="bold" />
          <span className="mtb-label">{t('nav.more', 'More')}</span>
        </button>
      )}
    </nav>
  );
}
