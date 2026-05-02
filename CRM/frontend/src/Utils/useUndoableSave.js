import { useEffect, useRef } from 'react';

// Debounced auto-save + undo registration in one hook. Wraps the existing
// "local state → setTimeout → save → reload" pattern so Ctrl+Z works for
// every editable field on the page, not just deletions.
//
// On a successful save the old server-confirmed value is captured into the
// undo stack (silent — no toast spam for text edits). Triggering Undo calls
// `save(before)` and resets the local state via `setValue(before)`, then the
// re-sync `useEffect` on `serverValue` keeps things consistent.
//
// Usage:
//   const [title, setTitle] = useState(product.title || '');
//   useUndoableSave({
//     value: title, setValue: setTitle, serverValue: product.title || '',
//     save: async (v) => { ...PUT...; return true; },
//     registerUndo, label: 'Title',
//     shouldSave: (v) => !!v.trim(),       // refuse empty
//     silent: true,                        // text edits are silent by default
//     debounceMs: 500,
//   });
export function useUndoableSave({
  value, setValue, serverValue,
  save, registerUndo, label,
  shouldSave = () => true,
  silent = true,
  debounceMs = 500,
}) {
  const prev = useRef(serverValue);
  const skip = useRef(true);

  // Re-sync local state when the server value changes from outside this
  // component (e.g. an Undo restored it). skip.current=true prevents the
  // save effect below from firing on the re-sync.
  useEffect(() => {
    if (serverValue !== prev.current) {
      prev.current = serverValue;
      skip.current = true;
      setValue(serverValue);
    }
  }, [serverValue]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    if (!shouldSave(value)) return;
    if (value === prev.current) return;
    const t = setTimeout(async () => {
      const before = prev.current;
      const result = await save(value);
      if (result === false) return;
      prev.current = value;
      registerUndo?.({
        description: `${label} changed`,
        silent,
        undo: async () => {
          skip.current = true;
          setValue(before);
          const r = await save(before);
          if (r !== false) prev.current = before;
        },
      });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
}
