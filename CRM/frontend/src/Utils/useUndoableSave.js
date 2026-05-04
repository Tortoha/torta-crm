import { useEffect, useRef } from 'react';

// Debounced auto-save + silent Undo registration; re-syncs local state when serverValue changes.
export function useUndoableSave({
  value, setValue, serverValue,
  save, registerUndo, label,
  shouldSave = () => true,
  silent = true,
  debounceMs = 500,
}) {
  const prev = useRef(serverValue);
  const skip = useRef(true);

  // Re-sync local state when serverValue changes externally (e.g. via Undo).
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
