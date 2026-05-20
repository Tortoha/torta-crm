// Lightweight country picker — proper combobox UX (button trigger +
// portal popup with search + keyboard nav), not the browser-native
// <datalist> hack. Built specifically because:
//   • <input list> shows the browser's own AUTOFILL dropdown (Chrome
//     pulls saved addresses from the user's profile and shows them
//     here), which looks like a privacy leak to the customer even
//     though we don't store any of it.
//   • The native dropdown can't be styled to match the storefront's
//     rounded-pill aesthetic.
// Free-text override is still allowed: typing into the search input
// and pressing Enter on an unmatched value commits that string.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";

// Curated common-destination list. Order roughly matches expected
// traffic from a CIS-centric clothing storefront — CIS first, then
// EU, then global. Free-text input handles anything not listed.
const COUNTRIES = [
  // CIS
  "Kazakhstan", "Russia", "Belarus", "Ukraine", "Uzbekistan",
  "Kyrgyzstan", "Tajikistan", "Turkmenistan", "Azerbaijan", "Armenia",
  "Georgia", "Moldova",
  // Europe
  "Germany", "United Kingdom", "France", "Italy", "Spain",
  "Netherlands", "Belgium", "Poland", "Czech Republic", "Austria",
  "Switzerland", "Sweden", "Norway", "Denmark", "Finland",
  "Ireland", "Portugal", "Greece", "Romania", "Hungary",
  "Bulgaria", "Slovakia", "Croatia", "Estonia", "Latvia", "Lithuania",
  // Americas
  "United States", "Canada", "Mexico", "Brazil", "Argentina", "Chile",
  // Asia + Pacific
  "Turkey", "China", "Japan", "South Korea", "Singapore", "Malaysia",
  "Thailand", "Vietnam", "Indonesia", "Philippines", "India",
  "United Arab Emirates", "Saudi Arabia", "Israel",
  "Australia", "New Zealand",
];

export default function CountryCombobox({ value, onChange, placeholder = "Select country" }) {
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState(null);     // {top, left, width}
  const [hi, setHi] = useState(0);          // highlighted index (keyboard nav)

  // Filter once per keystroke; case-insensitive substring match.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(c => c.toLowerCase().includes(q));
  }, [query]);

  // Re-position the popup right under the trigger every time it
  // opens. We use viewport coords + position: fixed so scrolling the
  // page after the popup opens doesn't detach it.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    // Auto-focus search so the user can start typing immediately.
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Keyboard navigation inside the popup (arrows + Enter).
  const onSearchKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Picked from the list — or commit the typed query if it
      // didn't match (free-text override for niche destinations).
      const pick = filtered[hi] ?? query.trim();
      if (pick) {
        onChange(pick);
        setOpen(false);
        setQuery("");
      }
    }
  };

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="country-cbx-btn"
        onClick={() => setOpen(o => !o)}>
        <span className={value ? "country-cbx-val" : "country-cbx-placeholder"}>
          {value || placeholder}
        </span>
        <CaretDown weight="bold" className="country-cbx-caret" />
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          className="country-cbx-pop"
          style={{ top: pos.top, left: pos.left, width: pos.width }}>
          <div className="country-cbx-search">
            <MagnifyingGlass weight="bold" className="country-cbx-search-icon" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search countries…"
              value={query}
              onChange={e => { setQuery(e.target.value); setHi(0); }}
              onKeyDown={onSearchKey}
            />
          </div>
          <div className="country-cbx-list">
            {filtered.length === 0 ? (
              <div className="country-cbx-empty">
                Press Enter to use "{query}"
              </div>
            ) : (
              filtered.map((c, i) => (
                <button
                  key={c} type="button"
                  className={`country-cbx-opt${i === hi ? " country-cbx-opt--hi" : ""}${c === value ? " country-cbx-opt--sel" : ""}`}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                    setQuery("");
                  }}>
                  {c}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
