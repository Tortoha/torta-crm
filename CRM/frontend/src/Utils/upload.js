import { API_BASE } from '../api.js';
import { startUpload, updateUpload, endUpload } from './uploadProgress.js';

// Presigned direct-to-R2 upload — the browser PUTs the file STRAIGHT to R2,
// bypassing the backend (Cloud Run caps request bodies at ~32 MB and can't hold
// multi-GB files in RAM). Three steps:
//   1. POST /api/upload/presign  → storage-quota pre-flight + signed PUT URL
//   2. PUT the raw file to R2 (echoing the exact headers the backend signed)
//   3. POST /api/upload/confirm   → bill the real size to the org
//
// Returns { url, size }. On a quota overflow the backend answers 402
// plan_limit_exceeded, which the global window.fetch interceptor
// (Utils/planLimit.js) already turns into the PlanLimitModal — so we add NO new
// UI, just stop. A per-file-cap overflow (>4 GB) throws with a .message the
// caller can alert().
export async function presignedUpload(file, { pq = '', kind = 'file', productId = null } = {}) {
  // 1. presign (+ pre-flight quota check)
  const pres = await fetch(`${API_BASE}/api/upload/presign${pq}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename:     file.name || 'file',
      content_type: file.type || 'application/octet-stream',
      size:         file.size,
      kind,
      product_id:   productId,
    }),
  });
  if (!pres.ok) {
    const body   = await pres.json().catch(() => ({}));
    const detail = (body && body.detail) || body || {};
    // 402 plan_limit_exceeded already popped the PlanLimitModal globally — just
    // bubble a quiet error. Other failures carry a human message.
    const err = new Error(detail.message
      || (detail.error === 'plan_limit_exceeded' ? '' : 'Upload could not start.'));
    err.planLimit = detail.error === 'plan_limit_exceeded';
    throw err;
  }
  const { upload_url, public_url, key, content_type, content_disposition } = await pres.json();

  // 2. PUT straight to R2 — NO credentials (cross-origin), echo signed headers.
  //    XMLHttpRequest (not fetch) because fetch() can't report upload progress.
  //    We push live byte counts to the global channel → the page's status pill
  //    renders a progress bar + percentage. Quota/abort paths still throw cleanly.
  const headers = { 'Content-Type': content_type || file.type || 'application/octet-stream' };
  if (content_disposition) headers['Content-Disposition'] = content_disposition;
  const upId = startUpload(file.name || 'file', file.size || 0);
  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', upload_url, true);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) updateUpload(upId, e.loaded, e.total); };
      xhr.onload  = () => (xhr.status >= 200 && xhr.status < 300)
        ? resolve()
        : reject(new Error('Upload to storage failed.'));
      xhr.onerror = () => reject(new Error('Upload to storage failed.'));
      xhr.onabort = () => reject(new Error('Upload aborted.'));
      xhr.send(file);
    });
  } finally {
    endUpload(upId);
  }

  // 3. confirm — verify it landed + bill the real size.
  await fetch(`${API_BASE}/api/upload/confirm${pq}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  }).catch(() => {});

  return { url: public_url, size: file.size };
}
