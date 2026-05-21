// Project Settings — redesigned to match the Product Settings "bulk-style"
// layout. One scrolling page, no tabs. Each topic is its own Section with
// icon + title + subtitle and a column of bulk-field cards. Save-on-change
// for every field (no Save button). Toast confirms each commit.
//
// Sections from top to bottom:
//   1. General         — timezone (auto-detect or manual) + currency (with warning modal)
//   2. Inventory       — FIFO/LIFO batch consumption + Hide-price/margin override
//   3. Barcode defaults — 4 toggles for what gets encoded into printed barcodes
//   4. Danger Zone     — placeholder (delete project, rotate API key — TODO)
//
// PDF document branding lives at /project/:apiKey/documents — a dedicated
// Sidebar page now (used to be a tab here, but customers couldn't find it
// buried inside Settings).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import {
  Globe, Stack, Barcode, Warning, CaretDown, MagnifyingGlass,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { CURRENCIES, formatMoney, getCurrencyMeta } from '../../Utils/currency.js';
import { DynamicBlock } from '../../Utils/DynamicBlock.js';
import '../../Style/Authentication.css';
import '../../Style/Products.css';

// Common IANA timezones — covers the bulk of e-commerce markets without
// dumping the full 600+ list on the user. Custom values are NOT directly
// typeable through the dropdown; users with exotic zones can call the
// backend API directly (rare enough to not warrant a typeahead UI).
const TIMEZONE_PRESETS = [
  'UTC',
  'Asia/Almaty',     'Asia/Aqtobe',    'Asia/Tashkent',
  'Europe/Moscow',   'Europe/London',  'Europe/Berlin',
  'Europe/Paris',    'Europe/Istanbul',
  'America/New_York','America/Chicago','America/Denver',
  'America/Los_Angeles','America/Toronto',
  'Asia/Dubai',      'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Sydney',
];

// ── Shared bulk-style primitives (mirror of ProductsSettings) ───────────

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

// Save-on-change card — no Apply switch. Modifier `bulk-field--noswitch`
// shifts the layout to skip the toggle column.
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

/**
 * SegmentSwitch — sliding pill toggle. Used for FIFO/LIFO + hide-price
 * + on/off toggles in barcode defaults. Same component as ProductsSettings
 * — kept local here to avoid premature shared-Utils extraction.
 */
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

// ── Searchable combobox ────────────────────────────────────────────────
//
// Built on the same shell as Booking's `Combobox` (portal dropdown,
// DynamicBlock hover pill, smart up/down flip near viewport edge), with
// a search input added at the top of the dropdown. We need this for the
// Timezone (~18 options) and Currency (49 options) dropdowns where a
// native `<select>` becomes a wall of text.
//
// Behaviour:
//   • Click trigger → dropdown opens, search input auto-focused
//   • Type → live filter on `label` AND `searchText` (so "tenge", "₸"
//     and "KZT" all find the same row)
//   • Esc → close. Click outside → close.
//   • Each option supports `subLabel` rendered dim on the right —
//     used to show currency symbol next to the name.
export function SearchableCombobox({
  value, options, onChange,
  placeholder = '— Select —',
  searchPlaceholder = 'Search…',
  disabled = false,
}) {
  const btnRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState(null);

  const selected = useMemo(
    () => options.find(o => String(o.value) === String(value)),
    [options, value]
  );

  // Live filter. `searchText` allows hidden synonyms (e.g. "tenge",
  // "kzt", "₸" all match "Kazakhstani Tenge"). Lowercase compare,
  // simple substring — no fuzzy / no regex. Good enough for <100 rows.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => {
      const hay = `${o.label || ''} ${o.searchText || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  const activeKey = hovered ?? String(value);
  const { indRef, setItemRef } = DynamicBlock(activeKey, open);

  // Compute dropdown position + smart up/down flip. Same logic as
  // Booking's Combobox — when there's < 240 px below the trigger we
  // pin the dropdown to the trigger's TOP edge with a `bottom` value
  // so it shrinks-to-content naturally rather than floating in space.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const margin = 12;
    const width = Math.max(r.width, 320);
    const MAX_H = 360;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const flipUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const maxHeight = flipUp ? Math.min(MAX_H, spaceAbove) : Math.min(MAX_H, spaceBelow);
    if (flipUp) {
      setPos({ bottom: window.innerHeight - r.top + 6, left: Math.max(margin, r.left), width, maxHeight });
    } else {
      setPos({ top: r.bottom + 6, left: Math.max(margin, r.left), width, maxHeight });
    }
    // Reset filter every time we open so the user always starts fresh.
    setQuery('');
    // Auto-focus the search input after the portal mounts.
    requestAnimationFrame(() => { inputRef.current?.focus(); });

    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onPd = (e) => {
      if (!e.target.closest?.('.bk-cb-dropdown') &&
          !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPd);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button"
        className={`cpm-cat-btn${open ? ' cpm-cat-btn--open' : ''}`}
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}>
        <span className={selected ? '' : 'cpm-cat-placeholder'}
          style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          {selected ? (
            <>
              <span>{selected.label}</span>
              {selected.subLabel && (
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {selected.subLabel}
                </span>
              )}
            </>
          ) : placeholder}
        </span>
        <CaretDown weight="bold" className={`cpm-cat-caret${open ? ' cpm-cat-caret--up' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div className="cat-filter-dropdown bk-cb-dropdown"
          style={{
            ...(pos.top    != null ? { top:    pos.top }    : null),
            ...(pos.bottom != null ? { bottom: pos.bottom } : null),
            left: pos.left, width: pos.width, maxHeight: pos.maxHeight,
            // Stack the search bar above the scrollable list inside the
            // portal — the list flexes to fill remaining height so the
            // search input always stays pinned.
            display: 'flex', flexDirection: 'column',
          }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}>
          {/* Search input — sticky to the dropdown's top edge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
            flexShrink: 0,
          }}>
            <MagnifyingGlass size={14} weight="bold" style={{ color: 'var(--muted)' }} />
            <input ref={inputRef} type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                flex: 1, border: 'none', outline: 'none',
                background: 'transparent', fontSize: 13,
                color: 'var(--text)',
              }} />
          </div>

          {/* Filtered list — scrolls; dynamic indicator follows hover */}
          <div style={{ overflowY: 'auto', flex: 1, position: 'relative' }}
            onMouseLeave={() => setHovered(null)}>
            <div ref={indRef} className="cat-filter-indicator" />
            {filtered.length === 0 && (
              <div style={{
                padding: '16px 12px', color: 'var(--muted)',
                fontSize: 13, textAlign: 'center',
              }}>
                No matches.
              </div>
            )}
            {filtered.map(o => {
              const k = String(o.value);
              return (
                <button key={k} ref={setItemRef(k)} type="button"
                  className={`cat-filter-item${activeKey === k ? ' cat-filter-item--current' : ''}`}
                  onMouseEnter={() => setHovered(k)}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12,
                  }}>
                  <span>{o.label}</span>
                  {o.subLabel && (
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {o.subLabel}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Currency change warning modal (kept exactly as before) ─────────────
//
// Pops when the merchant picks a different currency from the dropdown.
// Shows side-by-side "before / after" for a sample amount so the merchant
// can see at a glance: NUMBER stays, SYMBOL changes. No FX conversion.
function CurrencyChangeWarningModal({ fromCode, toCode, onCancel, onConfirm }) {
  const fromMeta = getCurrencyMeta(fromCode);
  const toMeta   = getCurrencyMeta(toCode);
  return (
    <div className="auth-modal-overlay" onClick={onCancel}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}
        style={{ width: 520 }}>
        <div className="auth-modal-body">
          <div className="auth-modal-title-row">
            <h2 className="auth-modal-title">Change currency?</h2>
          </div>

          <p className="cpm-section-hint" style={{ marginTop: 0 }}>
            You're switching from <b>{fromMeta.name} ({fromMeta.symbol})</b>{' '}
            to <b>{toMeta.name} ({toMeta.symbol})</b>.
          </p>

          {/* Before / after preview */}
          <div style={{
            display:'grid', gridTemplateColumns:'1fr auto 1fr',
            gap:12, alignItems:'center',
            padding:16, borderRadius:16,
            background:'var(--accent-tint)',
            margin:'8px 0 12px',
          }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ color:'var(--muted)', fontSize:12, marginBottom:4 }}>Was</div>
              <div style={{ fontSize:20, fontWeight:600, fontVariantNumeric:'tabular-nums' }}>
                {formatMoney(99.99, fromCode)}
              </div>
            </div>
            <div style={{ color:'var(--muted)', fontSize:18 }}>→</div>
            <div style={{ textAlign:'center' }}>
              <div style={{ color:'var(--muted)', fontSize:12, marginBottom:4 }}>Will be</div>
              <div style={{ fontSize:20, fontWeight:600, color:'var(--accent)', fontVariantNumeric:'tabular-nums' }}>
                {formatMoney(99.99, toCode)}
              </div>
            </div>
          </div>

          <ul style={{
            margin:0, padding:'0 0 0 18px',
            color:'var(--muted)', fontSize:13, lineHeight:1.55,
          }}>
            <li>
              <b>Numbers don't change.</b> A product priced at 99.99
              stays 99.99 — only the symbol updates.
            </li>
            <li>
              <b>Past orders keep their original currency.</b> An invoice
              issued in {fromMeta.symbol} stays in {fromMeta.symbol} forever.
            </li>
            <li>
              <b>No FX rate is applied.</b> If you want to re-price
              products at the current exchange rate, use Products →
              Bulk update price after switching.
            </li>
          </ul>

          <div className="auth-actions" style={{ marginTop: 16 }}>
            <button type="button" className="crm-submit-btn" onClick={onConfirm}>
              Change to {toMeta.code}
            </button>
            <button type="button" className="auth-btn-danger"
              onClick={onCancel} style={{ marginLeft: 'auto' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function ProjectSettings() {
  const { projectId } = useOutletContext();
  const [toast, setToast] = useState('');
  const tref = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    if (tref.current) clearTimeout(tref.current);
    tref.current = setTimeout(() => setToast(''), 2400);
  }, []);

  // ── General section state (timezone + currency) ────────────────────
  // Source of truth lives on `crm_projects` row — same PATCH endpoint
  // handles both fields. Currency change opens a warning modal first;
  // timezone changes commit immediately (no ambiguity about behaviour).
  const [tz, setTz]         = useState('UTC');
  const [tzAuto, setTzAuto] = useState(true);
  const [currency, setCurrency] = useState('USD');
  const [loadedGen, setLoadedGen] = useState(false);
  const [pendingCurrency, setPendingCurrency] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j) {
          setTz(j.timezone || 'UTC');
          setTzAuto(j.tz_auto !== false);
          setCurrency(j.currency || 'USD');
        }
        setLoadedGen(true);
      })
      .catch(() => setLoadedGen(true));
  }, [projectId]);

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const saveProject = async (patch) => {
    const r = await fetch(`${API_BASE}/api/projects/${projectId}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (r.ok) showToast('Saved');
    else showToast('Save failed');
  };

  // Manual dropdown selection → flips tz_auto off (user picked one
  // explicitly, don't auto-overwrite next time they reload).
  const pickTimezone = (v) => {
    setTz(v); setTzAuto(false);
    saveProject({ timezone: v, tz_auto: false });
  };
  // "Use browser timezone" → BACK to auto mode + syncs immediately.
  const useBrowser = () => {
    setTz(browserTz); setTzAuto(true);
    saveProject({ timezone: browserTz, tz_auto: true });
  };

  // ── Inventory section state ────────────────────────────────────────
  // FIFO vs LIFO consumption + the "hide price column, enter cost only"
  // option which auto-derives selling price from cost × (1 + margin/100).
  const [invMode,   setInvMode]   = useState('fifo');
  const [hidePrice, setHidePrice] = useState(false);
  const [marginPct, setMarginPct] = useState(50);
  const [loadedInv, setLoadedInv] = useState(false);

  // ── Barcode defaults section state ─────────────────────────────────
  const [barcode, setBarcode] = useState({
    barcode_include_date:   false,
    barcode_include_batch:  false,
    barcode_include_qty:    false,
    barcode_include_serial: false,
  });
  const [loadedBc, setLoadedBc] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j) {
          setInvMode(j.batch_consumption_mode || 'fifo');
          setHidePrice(!!j.hide_price_in_overview);
          setMarginPct(parseFloat(j.default_margin_percent || 50));
          setBarcode({
            barcode_include_date:   !!j.barcode_include_date,
            barcode_include_batch:  !!j.barcode_include_batch,
            barcode_include_qty:    !!j.barcode_include_qty,
            barcode_include_serial: !!j.barcode_include_serial,
          });
        }
        setLoadedInv(true);
        setLoadedBc(true);
      })
      .catch(() => { setLoadedInv(true); setLoadedBc(true); });
  }, [projectId]);

  const saveBatchSetting = async (patch) => {
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (r.ok) showToast('Saved');
  };

  return (
    <>
      <h1 className="crm-page-title">Settings</h1>

      <div className="bulk-settings">

      {/* ── General ── */}
      <Section icon={<Globe weight="duotone" />} title="General"
        subtitle="Timezone and currency drive how dates and money render across the dashboard.">

        <FieldCard label="Timezone"
          hint={
            tzAuto
              ? <>Auto-detect mode — CRM syncs with your browser ({browserTz}) every 30 min and on every page load. Pick a zone below to lock it manually.</>
              : <>Manual mode — locked to <b>{tz}</b>. Your browser reports <b>{browserTz}</b>.</>
          }>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 220 }}>
              <SearchableCombobox
                value={tz}
                disabled={!loadedGen}
                onChange={(v) => pickTimezone(v)}
                searchPlaceholder="Search timezones…"
                options={(() => {
                  // Compose options with the current value at top if it
                  // isn't in the preset list, then the standard preset
                  // list. `searchText` accepts city names without the
                  // region prefix so typing "Almaty" matches "Asia/Almaty".
                  const list = TIMEZONE_PRESETS.includes(tz)
                    ? TIMEZONE_PRESETS
                    : [tz, ...TIMEZONE_PRESETS];
                  return list.map(z => ({
                    value: z,
                    label: z,
                    searchText: z.split('/').pop(),
                  }));
                })()} />
            </div>
            {(!tzAuto || tz !== browserTz) && (
              <button type="button" className="auth-btn-check"
                onClick={useBrowser} disabled={!loadedGen}>
                {tzAuto ? 'Resume auto-detect' : 'Use browser timezone'}
              </button>
            )}
          </div>
        </FieldCard>

        <FieldCard label="Currency"
          hint={<>
            Every price on the dashboard — products, orders, analytics,
            invoices — uses this currency's symbol and decimal style.
            <b> Past orders snapshot their currency at the time of purchase</b>,
            so historical reports stay accurate after you change this.
          </>}>
          {/* Dropdown + live preview side-by-side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
            <SearchableCombobox
              value={currency}
              disabled={!loadedGen}
              onChange={(next) => {
                if (next === currency) return;
                // Stage the change — modal asks for confirmation first.
                setPendingCurrency(next);
              }}
              searchPlaceholder="Search 49 currencies (USD, ₸, tenge…)"
              options={(() => {
                // `searchText` lets the user find a currency by code,
                // symbol or name — type "₸" / "kzt" / "tenge" all hit
                // Kazakhstani Tenge. Label shows full name; subLabel
                // shows the symbol as a dim trailing chip.
                const list = CURRENCIES.some(c => c.code === currency)
                  ? CURRENCIES
                  : [getCurrencyMeta(currency), ...CURRENCIES];
                return list.map(c => ({
                  value: c.code,
                  label: `${c.code} — ${c.name}`,
                  subLabel: c.symbol,
                  searchText: `${c.code} ${c.name} ${c.symbol}`,
                }));
              })()} />
            <div style={{
              padding: '8px 14px', borderRadius: 999,
              background: 'var(--accent-tint)', color: 'var(--accent)',
              fontVariantNumeric: 'tabular-nums', fontWeight: 600,
              whiteSpace: 'nowrap',
            }}>
              {formatMoney(1234.5, currency)}
            </div>
          </div>
        </FieldCard>
      </Section>

      {/* ── Inventory ── */}
      <Section icon={<Stack weight="duotone" />} title="Inventory"
        subtitle="How stock partitions consume from batches, and how SKU prices are entered.">

        <FieldCard label="Batch consumption order"
          hint={
            invMode === 'fifo'
              ? 'FIFO (first-in, first-out) — oldest batches sell first. Best for food, cosmetics, anything with an expiry date.'
              : 'LIFO (last-in, first-out) — newest batches sell first. Uncommon — use only if you have a specific accounting reason.'
          }>
          <SegmentSwitch value={invMode} disabled={!loadedInv}
            options={[
              { value: 'fifo', label: 'FIFO' },
              { value: 'lifo', label: 'LIFO' },
            ]}
            onChange={(v) => { setInvMode(v); saveBatchSetting({ batch_consumption_mode: v }); }} />
        </FieldCard>

        <FieldCard label="Hide Price column — enter Cost only"
          hint={<>
            Product Overview hides the Price column for L2 SKUs. Merchant types <b>Cost</b>;
            public price is auto-set to <b>Cost × (1 + margin / 100)</b>.
          </>}>
          <SegmentSwitch value={hidePrice ? 'on' : 'off'} disabled={!loadedInv}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on',  label: 'On'  },
            ]}
            onChange={(v) => {
              const on = v === 'on';
              setHidePrice(on);
              saveBatchSetting({ hide_price_in_overview: on });
            }} />
        </FieldCard>

        {/* Margin input — only relevant when hidePrice is ON, so dim
            otherwise. Disabled-state styling handled by the bulk-field
            class system. */}
        <FieldCard label="Default margin %"
          hint="Used to compute selling price when Hide Price is on. e.g. 50 → price = cost × 1.5.">
          <input className="crm-input" type="number" min="0" max="10000" step="0.1"
            style={{ maxWidth: 160, opacity: hidePrice ? 1 : 0.5 }}
            value={marginPct}
            disabled={!hidePrice || !loadedInv}
            onChange={(e) => setMarginPct(parseFloat(e.target.value) || 0)}
            onBlur={(e) => saveBatchSetting({ default_margin_percent: parseFloat(e.target.value) || 0 })} />
        </FieldCard>
      </Section>

      {/* ── Barcode defaults ── */}
      <Section icon={<Barcode weight="duotone" />} title="Barcode defaults"
        subtitle='These toggles pre-fill the "Advanced encoding" section in the Print barcodes modal.'>

        <FieldCard label="Include production date"
          hint="Appends -YYYYMMDD to the encoded value">
          <SegmentSwitch value={barcode.barcode_include_date ? 'on' : 'off'} disabled={!loadedBc}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on',  label: 'On'  },
            ]}
            onChange={(v) => {
              const on = v === 'on';
              setBarcode(s => ({ ...s, barcode_include_date: on }));
              saveBatchSetting({ barcode_include_date: on });
            }} />
        </FieldCard>

        <FieldCard label="Include batch name"
          hint="Appends -B<batch> — useful for recall traceability">
          <SegmentSwitch value={barcode.barcode_include_batch ? 'on' : 'off'} disabled={!loadedBc}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on',  label: 'On'  },
            ]}
            onChange={(v) => {
              const on = v === 'on';
              setBarcode(s => ({ ...s, barcode_include_batch: on }));
              saveBatchSetting({ barcode_include_batch: on });
            }} />
        </FieldCard>

        <FieldCard label="Include quantity in batch"
          hint="Appends -Q<n> — for production reporting">
          <SegmentSwitch value={barcode.barcode_include_qty ? 'on' : 'off'} disabled={!loadedBc}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on',  label: 'On'  },
            ]}
            onChange={(v) => {
              const on = v === 'on';
              setBarcode(s => ({ ...s, barcode_include_qty: on }));
              saveBatchSetting({ barcode_include_qty: on });
            }} />
        </FieldCard>

        <FieldCard label="Include serial counter"
          hint="Each printed sticker gets a unique -NNNN suffix">
          <SegmentSwitch value={barcode.barcode_include_serial ? 'on' : 'off'} disabled={!loadedBc}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on',  label: 'On'  },
            ]}
            onChange={(v) => {
              const on = v === 'on';
              setBarcode(s => ({ ...s, barcode_include_serial: on }));
              saveBatchSetting({ barcode_include_serial: on });
            }} />
        </FieldCard>
      </Section>

      {/* ── Danger Zone ── */}
      {/* Placeholder until rotate-api-key + delete-project are wired up.
          Keeping the section visible signals intent to the merchant. */}
      <Section icon={<Warning weight="duotone" />} title="Danger zone"
        subtitle="Irreversible actions — rotate API key, delete project.">
        <FieldCard label="Coming soon"
          hint="Project rotation and deletion are not yet exposed in the UI. Until then, drop a request via support.">
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>
        </FieldCard>
      </Section>

      {/* Currency-change warning modal — gates the dropdown commit. */}
      {pendingCurrency && createPortal(
        <CurrencyChangeWarningModal
          fromCode={currency}
          toCode={pendingCurrency}
          onCancel={() => setPendingCurrency(null)}
          onConfirm={() => {
            const next = pendingCurrency;
            setPendingCurrency(null);
            setCurrency(next);
            saveProject({ currency: next });
          }}
        />,
        document.body,
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
      </div>
    </>
  );
}
