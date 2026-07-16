import { useEffect, useState } from 'react';

// Typewriter effect — reveals `text` character-by-character. Returns { displayed, done }.
// Respects prefers-reduced-motion (renders the full string instantly, done=true).
export function useTypewriter(text, { speed = 42, startDelay = 500 } = {}) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !text) { setDisplayed(text || ''); setDone(true); return; }

    setDisplayed(''); setDone(false);
    let i = 0;
    let interval;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) { clearInterval(interval); setDone(true); }
      }, speed);
    }, startDelay);

    return () => { clearTimeout(start); clearInterval(interval); };
  }, [text, speed, startDelay]);

  return { displayed, done };
}
