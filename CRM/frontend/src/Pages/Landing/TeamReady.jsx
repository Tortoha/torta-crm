// "Team-ready" — bento layout. One large card on the left (Custom roles
// per page) carries a small mock "role matrix" so the section reads as
// product-y, not just text. Two smaller cards stack on the right
// (Workspace + Audit log). Mirrors CustomerFirst (which inverts the
// asymmetry so the page rhythm alternates).

import { useTranslation } from 'react-i18next';
import { ShieldStar, BuildingOffice, FileText } from '@phosphor-icons/react';
import { useInView } from '../../Utils/useInView.js';

export default function TeamReady() {
  const { t } = useTranslation();
  const { ref, inView } = useInView({ threshold: 0.2 });

  return (
    <section className="ln-section">
      <div className="ln-wrap">
        <div ref={ref}
          className={`ln-section-head ln-section-head--center ln-reveal${inView ? ' ln-in' : ''}`}>
          <span className="ln-eyebrow">{t('landing.teamReady.eyebrow')}</span>
          <h2 className="ln-section-title">{t('landing.teamReady.title')}</h2>
          <p className="ln-section-sub">{t('landing.teamReady.subtitle')}</p>
        </div>

        <div className="ln-bento ln-bento--left">
          {/* Large card on the left — anchor of the layout */}
          <div className={`ln-bento-card ln-bento-card--lg ln-reveal ln-d1${inView ? ' ln-in' : ''}`}>
            <header className="ln-bento-card-head">
              <div className="ln-feature-icon">
                <ShieldStar weight="bold" />
              </div>
              <h3>{t('landing.teamReady.items.roles.title')}</h3>
            </header>
            <p>{t('landing.teamReady.items.roles.desc')}</p>

            {/* Mini role matrix — a sliver of UI that hints at how granular
                the permissions are. Static, decorative, not interactive. */}
            <div className="ln-bento-mock ln-bento-mock--roles">
              <div className="ln-bento-mock-row">
                <span>Designer</span>
                <em>Products · Bookings</em>
              </div>
              <div className="ln-bento-mock-row">
                <span>Accountant</span>
                <em>Revenue · Customers</em>
              </div>
              <div className="ln-bento-mock-row">
                <span>Ops</span>
                <em>Orders · Returns</em>
              </div>
            </div>
          </div>

          {/* Two smaller cards stacked on the right */}
          <div className={`ln-bento-card ln-reveal ln-d2${inView ? ' ln-in' : ''}`}>
            <header className="ln-bento-card-head">
              <div className="ln-feature-icon">
                <BuildingOffice weight="bold" />
              </div>
              <h3>{t('landing.teamReady.items.workspace.title')}</h3>
            </header>
            <p>{t('landing.teamReady.items.workspace.desc')}</p>
          </div>

          <div className={`ln-bento-card ln-reveal ln-d3${inView ? ' ln-in' : ''}`}>
            <header className="ln-bento-card-head">
              <div className="ln-feature-icon">
                <FileText weight="bold" />
              </div>
              <h3>{t('landing.teamReady.items.audit.title')}</h3>
            </header>
            <p>{t('landing.teamReady.items.audit.desc')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
