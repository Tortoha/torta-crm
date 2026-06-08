// Tiny global pub/sub for in-flight upload progress. Lets the shared
// presignedUpload() helper (Utils/upload.js) drive a single status pill
// (e.g. ProductOverview's bottom toast) without threading a callback through
// every upload call site. Tracks byte-level aggregate so concurrent / multi-file
// uploads surface as one combined percentage instead of fighting over the pill.

const _subs = new Set();
const _inflight = new Map();   // id → { loaded, total, name }
let _seq = 0;

function _emit() {
  let loaded = 0, total = 0, name = '';
  for (const u of _inflight.values()) {
    loaded += u.loaded;
    total  += u.total;
    name    = u.name;            // surface the most recently registered file's name
  }
  const active  = _inflight.size > 0;
  const percent = total > 0
    ? Math.min(100, Math.round((loaded / total) * 100))
    : (active ? 0 : 100);
  const state = { active, percent, count: _inflight.size, name };
  // A throwing subscriber must never break an in-progress upload.
  _subs.forEach(fn => { try { fn(state); } catch { /* ignore */ } });
}

// Subscribe to progress updates. Returns an unsubscribe function.
export function onUploadProgress(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

// Register a new in-flight upload. Returns an id used to update / end it.
export function startUpload(name, total) {
  const id = ++_seq;
  _inflight.set(id, { loaded: 0, total: total || 0, name: name || '' });
  _emit();
  return id;
}

export function updateUpload(id, loaded, total) {
  const u = _inflight.get(id);
  if (!u) return;
  u.loaded = loaded;
  if (total) u.total = total;
  _emit();
}

export function endUpload(id) {
  if (_inflight.delete(id)) _emit();
}
