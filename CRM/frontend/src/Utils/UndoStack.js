import { useCallback, useEffect, useRef, useState } from 'react';

// Page-scoped undo stack: register({description, undo, silent}) + Ctrl/Cmd+Z (skipped inside text inputs).
export function useUndoStack({ max = 10, autoDismissMs = 8000 } = {}) {
  const [toast, setToast] = useState(null);
  const stackRef = useRef([]);
  const dismissTimer = useRef(null);

  const armDismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setToast(null), autoDismissMs);
  }, [autoDismissMs]);

  const register = useCallback(({ description, undo, silent = false }) => {
    if (typeof undo !== 'function') return;
    const entry = { description, undo, silent, id: Date.now() + Math.random() };
    stackRef.current = [...stackRef.current, entry].slice(-max);
    // silent=true → stack-only, no toast (used for noisy debounced saves).
    if (!silent) {
      setToast(entry);
      armDismiss();
    }
  }, [max, armDismiss]);

  const performUndo = useCallback(async () => {
    const s = stackRef.current;
    if (!s.length) return;
    const last = s[s.length - 1];
    stackRef.current = s.slice(0, -1);
    setToast(null);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    try { await last.undo(); } catch {}
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey;
      if (!isUndo) return;
      const t = e.target;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      if (!stackRef.current.length) return;
      e.preventDefault();
      performUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [performUndo]);

  useEffect(() => () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  return { register, undo: performUndo, toast, dismissToast };
}
