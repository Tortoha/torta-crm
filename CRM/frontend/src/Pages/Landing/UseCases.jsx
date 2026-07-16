// 3 use-case tabs — exact mirror of the CRM's Authentication-page tab
// pattern (.auth-tab-*). Indicator slides via direct DOM mutation inside
// requestAnimationFrame, tracks `hovered ?? active`, and the active text
// flips to var(--accent). Same timing (0.55s var(--ease-smooth)), same
// per-button refs, same opacity-fade-in trick to avoid the flicker on
// first paint.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Person, UsersThree, Buildings, CheckCircle,
} from '@phosphor-icons/react';
import { useInView } from '../../Utils/useInView.js';

const CASES = [
  { key: 'solo',   Icon: Person,     tiles: ['$24.8k', '32 SKU', '4.8★'] },
  { key: 'agency', Icon: UsersThree, tiles: ['7 clients', '+18%', '92% SLA'] },
  { key: 'market', Icon: Buildings,  tiles: ['5 stores', '12.4k orders', '$182k GMV'] },
];

export default function UseCases() {
  const { t } = useTranslation();
  const [active, setActive]   = useState('solo');
  const [hovered, setHovered] = useState(null);
  const indRef  = useRef(null);
  const btnRefs = useRef({});

  // Hover takes priority; falls back to the active tab when the cursor leaves.
  const curTab = hovered ?? active;

  // Slide the indicator via direct DOM mutation inside rAF — same approach
  // the CRM's auth-tab uses. Avoids extra React re-renders and means the
  // indicator opacity stays at 0 until the first measurement, so there's no
  // first-paint flicker at x:0 / w:0.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = btnRefs.current[curTab];
      if (!ind || !el) return;
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curTab, active]);

  const curCase = CASES.find(c => c.key === active);
  const bullets = t(`landing.useCases.items.${active}.bullets`, { returnObjects: true });
  const bulletList = Array.isArray(bullets) ? bullets : [];

  const { ref: secRef, inView } = useInView({ threshold: 0.2 });

  return (
    <section className="ln-section">
      <div className="ln-wrap">
        <div ref={secRef} className={`ln-section-head ln-section-head--center ln-reveal${inView ? ' ln-in' : ''}`}>
          <span className="ln-eyebrow">{t('landing.useCases.eyebrow')}</span>
          <h2 className="ln-section-title">{t('landing.useCases.title')}</h2>
          <p className="ln-section-sub">{t('landing.useCases.subtitle')}</p>
        </div>

        <div className="ln-usecases-tabs" onMouseLeave={() => setHovered(null)}>
          <div ref={indRef} className="ln-usecases-ind" />
          {CASES.map(({ key, Icon }) => (
            <button key={key}
              ref={el => { btnRefs.current[key] = el; }}
              className={`ln-usecases-tab${curTab === key ? ' ln-usecases-tab--active' : ''}`}
              onMouseEnter={() => setHovered(key)}
              onClick={() => setActive(key)}
              type="button">
              <Icon className="ln-usecases-tab-icon" weight="bold" />
              {t(`landing.useCases.items.${key}.tab`)}
            </button>
          ))}
        </div>

        <div key={active} className="ln-usecase-card">
          <div>
            <h3 className="ln-usecase-title">{t(`landing.useCases.items.${active}.headline`)}</h3>
            <p className="ln-usecase-body">{t(`landing.useCases.items.${active}.body`)}</p>
            <ul className="ln-usecase-list">
              {bulletList.map((b, i) => (
                <li key={i}>
                  <CheckCircle weight="bold" /> <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="ln-usecase-art">
            <div className="ln-usecase-art-tile ln-usecase-art-tile--1">
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>{t(`landing.useCases.items.${active}.tiles.0.label`)}</span>
              <b>{curCase.tiles[0]}</b>
            </div>
            <div className="ln-usecase-art-tile ln-usecase-art-tile--2">
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>{t(`landing.useCases.items.${active}.tiles.1.label`)}</span>
              <b>{curCase.tiles[1]}</b>
            </div>
            <div className="ln-usecase-art-tile ln-usecase-art-tile--3">
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>{t(`landing.useCases.items.${active}.tiles.2.label`)}</span>
              <b>{curCase.tiles[2]}</b>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
