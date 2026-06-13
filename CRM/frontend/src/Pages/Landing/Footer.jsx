// Plain 4-column footer with our brand mark + 3 link groups. Lives inside
// the 1400px column, separated from the rest of the page by a hairline.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLocalePath } from '../../Utils/useLocalePath.js';

export default function Footer() {
  const { t } = useTranslation();
  const lp = useLocalePath();
  const year = new Date().getFullYear();

  // Every link points to a REAL, live page (no `#` placeholders): the six
  // product feature pages, the Developers/API page, the docs surfaces, and
  // the legal pages. Dead links (About/Blog/Careers/Contact, Features/Tour)
  // were removed.
  const cols = [
    { key: 'product', links: [
      { id: 'products',    to: '/products' },
      { id: 'booking',     to: '/booking' },
      { id: 'digital',     to: '/digital' },
      { id: 'chat',        to: '/chat' },
      { id: 'email',       to: '/email' },
      { id: 'analytics',   to: '/analytics' },
      { id: 'pos',         to: '/pos' },
      { id: 'currencies',  to: '/currencies' },
      { id: 'pricing',     to: '/pricing' },
    ]},
    { key: 'developers', links: [
      { id: 'api',         to: '/developers' },
      { id: 'multistore',  to: '/multi-store' },
      { id: 'team',        to: '/team' },
      { id: 'database',    to: '/database' },
      { id: 'auth',        to: '/auth' },
      { id: 'storage',     to: '/storage' },
      { id: 'realtime',    to: '/realtime' },
      { id: 'automations', to: '/automations' },
      { id: 'accounting',  to: '/accounting' },
      { id: 'docs',        to: '/docs/getting-started?from=landing' },
      { id: 'reference',   to: '/docs/cheatsheet?from=landing' },
      { id: 'quickstart',  to: '/docs/quickstart?from=landing' },
      { id: 'frameworks',  to: '/docs/frameworks?from=landing' },
    ]},
    { key: 'legal',   links: [
      { id: 'terms',    to: '/terms' },
      { id: 'privacy',  to: '/privacy' },
      { id: 'refund',   to: '/refund' },
      { id: 'security', to: '/security' },
    ]},
  ];

  return (
    <footer className="ln-footer">
      <div className="ln-wrap">
        <div className="ln-footer-grid">
          <div className="ln-footer-brand">
            <div className="ln-footer-brand-mark">
              <svg viewBox="0 0 3070 3070" fill="currentColor" aria-hidden>
                <path d="M3061.91 1516.01C3065.95 1523.01 3067.97 1526.51 3068.76 1530.22C3069.46 1533.51 3069.46 1536.91 3068.76 1540.2C3067.97 1543.92 3065.95 1547.42 3061.91 1554.41L2316.09 2846.23C2312.05 2853.22 2310.03 2856.72 2307.2 2859.27C2304.7 2861.52 2301.76 2863.22 2298.56 2864.26C2294.94 2865.43 2290.91 2865.43 2282.83 2865.43H769.002L1503.75 1592.81C1514.66 1573.91 1520.12 1564.46 1519.3 1556.7C1518.59 1549.94 1515.04 1543.79 1509.54 1539.8C1503.23 1535.21 1492.32 1535.21 1470.49 1535.21H1.00289L757.915 224.2C761.953 217.205 763.972 213.708 766.797 211.165C769.297 208.914 772.241 207.214 775.44 206.175C779.055 205 783.093 205 791.17 205H2282.83C2290.91 205 2294.94 205 2298.56 206.175C2301.76 207.214 2304.7 208.914 2307.2 211.165C2310.03 213.708 2312.05 217.205 2316.08 224.2L3061.91 1516.01Z" />
              </svg>
              Torta CRM
            </div>
            <p>{t('landing.footer.tagline')}</p>
          </div>

          {cols.map(c => (
            <div key={c.key} className="ln-footer-col">
              <h5>{t(`landing.footer.cols.${c.key}.title`)}</h5>
              <ul>
                {c.links.map(l => {
                  const label = t(`landing.footer.cols.${c.key}.links.${l.id}`);
                  return (
                    <li key={l.id}>
                      {l.to
                        ? <Link to={lp(l.to)}>{label}</Link>
                        : <a href="#">{label}</a>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="ln-footer-bottom">
          <span>© {year} Torta CRM · tortacrm.com. {t('landing.footer.rights')}</span>
          <span>{t('landing.footer.built')}</span>
        </div>
      </div>
    </footer>
  );
}
