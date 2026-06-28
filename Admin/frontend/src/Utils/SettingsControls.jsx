// Bulk-style settings primitives — copied from CRM
// Pages/Project/ProjectSettings.jsx (Section / FieldCard / SegmentSwitch).
// Pure presentational, no i18n inside — callers pass already-translated labels.
// The .bulk-section / .bulk-field / .seg-switch classes come from the copied
// Products.css / Authentication.css, so these render identically to the CRM.

import { useEffect, useRef, useState } from 'react';

export function Section({ icon, title, subtitle, children }) {
  return (
    <section className="bulk-section">
      <header className="bulk-section-head">
        <div className="bulk-section-icon">{icon}</div>
        <div className="bulk-section-text">
          <h2 className="bulk-section-title">{title}</h2>
          {subtitle && <p className="bulk-section-sub">{subtitle}</p>}
        </div>
      </header>
      <div className="bulk-section-fields">{children}</div>
    </section>
  );
}

// Save-on-change card — no Apply switch (bulk-field--noswitch skips the toggle
// column).
export function FieldCard({ label, hint, children }) {
  return (
    <div className="bulk-field bulk-field--noswitch bulk-field--on">
      <div className="bulk-field-head">
        <div className="bulk-field-text">
          <span className="bulk-field-label">{label}</span>
          {hint && <span className="bulk-field-hint">{hint}</span>}
        </div>
      </div>
      <div className="bulk-field-value">{children}</div>
    </div>
  );
}

// Sliding pill toggle. The indicator follows hover → active.
export function SegmentSwitch({ value, options, onChange, disabled }) {
  const indRef = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const current = hovered ?? value;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el = btnRefs.current[String(current)];
      if (!ind || !el) return;
      ind.style.opacity = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [current, value]);

  return (
    <div className={`seg-switch${disabled ? ' seg-switch--disabled' : ''}`}
      onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="seg-switch-indicator" />
      {options.map(({ value: v, label }) => (
        <button key={String(v)} type="button" disabled={disabled}
          ref={el => { btnRefs.current[String(v)] = el; }}
          className={`seg-switch-btn${String(current) === String(v) ? ' seg-switch-btn--current' : ''}`}
          onMouseEnter={() => !disabled && setHovered(v)}
          onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
