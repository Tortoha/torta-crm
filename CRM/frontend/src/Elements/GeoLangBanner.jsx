// Mounted once at the App root. On a first-time anonymous visit it resolves the
// visitor's language from their country (Utils/geoLang.js) and — only in
// Kazakhstan, which is multilingual — pops a small bottom banner offering
// kk / ru / en. Everywhere else the language is set silently. The banner is a
// portal so it never disturbs page layout; once a language is chosen (or the
// resolver stored one) it won't show again.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { syncLang } from '../i18n.js';
import { resolveGeoLanguage } from '../Utils/geoLang.js';
import '../Style/GeoLang.css';

const KZ_OPTS = [
  { v: 'kk', label: 'Қазақша' },
  { v: 'ru', label: 'Русский' },
  { v: 'en', label: 'English' },
];

export default function GeoLangBanner() {
  const [showKZ, setShowKZ] = useState(false);

  useEffect(() => {
    let alive = true;
    resolveGeoLanguage().then(res => {
      if (alive && res && res.pickerKZ) setShowKZ(true);
    });
    return () => { alive = false; };
  }, []);

  if (!showKZ) return null;

  const pick = (v) => { syncLang(v); setShowKZ(false); };

  return createPortal(
    <div className="geo-lang-bar" role="dialog" aria-label="Choose language">
      <span className="geo-lang-text">Тілді таңдаңыз · Выберите язык · Choose language</span>
      <div className="geo-lang-opts">
        {KZ_OPTS.map(o => (
          <button key={o.v} type="button" className="geo-lang-btn" onClick={() => pick(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
      <button type="button" className="geo-lang-close" aria-label="Close" onClick={() => setShowKZ(false)}>×</button>
    </div>,
    document.body,
  );
}
