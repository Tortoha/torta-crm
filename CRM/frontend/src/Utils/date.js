// Small date helpers that avoid the toISOString() TZ-roll-back trap.
//
// `new Date().toISOString().slice(0, 10)` gives the date in **UTC**, not local.
// For users east of UTC during late-evening / early-morning hours, this rolls
// to the wrong day. Worse: a Date that was set to local-midnight via
// `setHours(0,0,0,0)` always falls into the PREVIOUS UTC day for any positive
// offset — so passing such a Date through `toISOString()` always picks the
// wrong day for users in UTC+1 onwards.
//
// Use `localIsoDay(date)` whenever you need "the date the user sees in their
// browser" as YYYY-MM-DD — for backend queries, URL params, day pickers, etc.

/**
 * Format a Date as YYYY-MM-DD using LOCAL year/month/day components.
 * Safe for users in any timezone.
 *
 * @param {Date} d
 * @returns {string} e.g. "2026-05-14"
 */
export function localIsoDay(d) {
  if (!(d instanceof Date)) d = new Date(d);
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Today's local date as YYYY-MM-DD. */
export function todayLocalIsoDay() {
  return localIsoDay(new Date());
}
