// URL-backed tab state: reads/writes ?tab=<key> so each tab has its own URL.
// This makes tabs deep-linkable AND lets presence (cursors / same-page chat /
// "jump to teammate") distinguish people on different tabs of the same page.
//
// The default tab is kept clean (no ?tab param) so the canonical page URL
// still works and two people on the default tab share the same route.
//
//   const [tab, setTab] = useTabParam('verification');

import { useSearchParams } from 'react-router-dom';

export function useTabParam(defaultTab) {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || defaultTab;
  const setTab = (next) => {
    const p = new URLSearchParams(sp);   // preserve other params (?open=, …)
    if (!next || next === defaultTab) p.delete('tab');
    else p.set('tab', next);
    setSp(p);
  };
  return [tab, setTab];
}
