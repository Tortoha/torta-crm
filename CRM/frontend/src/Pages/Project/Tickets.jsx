import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useParams } from 'react-router-dom';
import {
  MagnifyingGlass, Ticket, QrCode, Check, X, Copy, ArrowsClockwise,
} from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { useInfiniteList } from '../../Utils/useInfiniteList.js';
import { useInfiniteScroll } from '../../Utils/useInfiniteScroll.js';
import '../../Style/Authentication.css';
import '../../Style/Products.css';
import '../../Style/Organization.css';

const TABS = [
  { key: 'issued', label: 'Issued',   Icon: Ticket },
  { key: 'scan',   label: 'Scan',     Icon: QrCode },
];

export default function Tickets() {
  const { projectId, project } = useOutletContext();
  const { apiKey } = useParams();
  const [tab, setTab] = useState('issued');

  return (
    <div className="prod-page-wrap">
      <TabSwitcher tabs={TABS} activeKey={tab} onPick={setTab} />
      <h1 className="crm-page-title">Tickets</h1>
      {tab === 'issued' && <IssuedTab projectId={projectId} />}
      {tab === 'scan'   && <ScanTab   apiKey={apiKey} publishableKey={project?.publishable_key} />}
    </div>
  );
}

function TabSwitcher({ tabs, activeKey, onPick }) {
  const indRef = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);
  const curKey = hovered ?? activeKey;

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el = btnRefs.current[curKey];
      if (!ind || !el) return;
      ind.style.opacity = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [curKey, activeKey]);

  return (
    <div className="auth-tab-wrapper">
      <div className="auth-tab-switcher" onMouseLeave={() => setHovered(null)}>
        <div ref={indRef} className="auth-tab-indicator" />
        {tabs.map(({ key, label, Icon }) => (
          <button key={key} ref={el => { btnRefs.current[key] = el; }}
            className={`auth-tab-btn${curKey === key ? ' auth-tab-btn--active' : ''}`}
            onMouseEnter={() => setHovered(key)}
            onClick={() => onPick(key)}
            type="button">
            <Icon className="auth-tab-icon" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Issued ──────────────────────────────────────────────

function IssuedTab({ projectId }) {
  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState('');
  const [toast,   setToast]   = useState('');

  // Build query string only from active filters — search is debounced via the deps of useInfiniteList.
  const [extraQS, setExtraQS] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = [];
      if (search) qs.push(`search=${encodeURIComponent(search)}`);
      if (status) qs.push(`status=${encodeURIComponent(status)}`);
      setExtraQS(qs.join('&'));
    }, 280);
    return () => clearTimeout(t);
  }, [search, status]);

  const {
    items: tickets, hasMore, loading, loadMore,
  } = useInfiniteList({
    url: `${API_BASE}/api/projects/${projectId}/tickets/issued`,
    pageSize: 100,
    extraQS,
  });
  const sentinelRef = useInfiniteScroll(loadMore);

  const copy = (code) => {
    navigator.clipboard.writeText(code);
    setToast(`Copied ${code}`);
    setTimeout(() => setToast(''), 2000);
  };

  return (
    <>
      <div className="org-toolbar">
        <div className="org-search-wrap">
          <MagnifyingGlass className="org-search-icon" />
          <input className="org-search-input" placeholder="Search by name, code, or product…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <p className="crm-placeholder">Loading…</p>
      ) : tickets.length === 0 ? (
        <p className="crm-placeholder">No event tickets sold yet.</p>
      ) : (
        <div className="po-set-table">
          <div className="po-set-row po-set-row--head ticket-row--grid">
            <span>Event</span>
            <span>Customer</span>
            <span>Quantity</span>
            <span>Access code</span>
            <span>Status</span>
            <span>Sold</span>
          </div>
          {tickets.map(t => (
            <div key={t.item_id} className="po-set-row ticket-row--grid">
              <span>
                <b>{t.title}</b>
                {t.variation_name && <span className="batch-meta-line">{t.variation_name}</span>}
              </span>
              <span>
                {t.recipient_name || '—'}
                {t.phone && <span className="batch-meta-line">{t.phone}</span>}
              </span>
              <span>{t.quantity}</span>
              <span>
                {t.access_code ? (
                  <button type="button" className="ticket-code-btn" onClick={() => copy(t.access_code)}
                    title="Click to copy">
                    <span style={{ fontFamily: 'monospace', letterSpacing: '1px' }}>{t.access_code}</span>
                    <Copy weight="bold" />
                  </button>
                ) : '—'}
              </span>
              <span className={`po-set-status ${statusClass(t.status)}`}>{t.status}</span>
              <span className="batch-meta-line">{fmtDate(t.created_at)}</span>
            </div>
          ))}
          {hasMore && <div ref={sentinelRef} className="inf-sentinel">Loading more…</div>}
        </div>
      )}

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </>
  );
}

function statusClass(s) {
  if (s === 'cancelled' || s === 'refunded') return 'po-set-status--inactive';
  if (s === 'delivered' || s === 'confirmed' || s === 'shipped') return 'po-set-status--active';
  return 'po-set-status--expired';
}

// ── Scan ────────────────────────────────────────────────
// Two paths: (1) camera scanner via jsQR (loaded from CDN to avoid bundling) and (2) manual access-code entry.

function ScanTab({ apiKey, publishableKey }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const [scanning, setScanning] = useState(false);
  const [result,   setResult]   = useState(null);
  const [code,     setCode]     = useState('');
  const [busy,     setBusy]     = useState(false);

  const verifyByCode = async (rawCode) => {
    setBusy(true);
    try {
      const headers = {};
      if (publishableKey) headers['X-Publishable-Key'] = publishableKey;
      const r = await fetch(`http://localhost:8000/${apiKey}/tickets/verify-code?code=${encodeURIComponent(rawCode)}`,
        { headers, credentials: 'include' });
      const j = await r.json().catch(() => null);
      setResult(j || { ok: false, error: 'network' });
    } finally { setBusy(false); }
  };

  // Decode a verify URL: pulls out ?t=<token>. The QR may contain either a URL or just the token.
  const verifyByToken = async (raw) => {
    setBusy(true);
    try {
      let tok = raw;
      try {
        const u = new URL(raw);
        tok = u.searchParams.get('t') || raw;
      } catch {}
      const headers = {};
      if (publishableKey) headers['X-Publishable-Key'] = publishableKey;
      const r = await fetch(`http://localhost:8000/${apiKey}/tickets/verify?t=${encodeURIComponent(tok)}`,
        { headers, credentials: 'include' });
      const j = await r.json().catch(() => null);
      setResult(j || { ok: false, error: 'network' });
    } finally { setBusy(false); }
  };

  // Load jsQR from CDN lazily — keeps the main bundle small. ESM build.
  const ensureJsQR = async () => {
    if (window.jsQR) return window.jsQR;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    return window.jsQR;
  };

  const startScanner = async () => {
    setResult(null);
    try {
      const jsQR = await ensureJsQR();
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false,
      });
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.setAttribute('playsinline', '');
      await videoRef.current.play();
      setScanning(true);

      const tick = () => {
        if (!videoRef.current || !canvasRef.current) return;
        const v = videoRef.current;
        const c = canvasRef.current;
        if (v.readyState === v.HAVE_ENOUGH_DATA) {
          c.width = v.videoWidth; c.height = v.videoHeight;
          const ctx = c.getContext('2d');
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const img = ctx.getImageData(0, 0, c.width, c.height);
          const found = jsQR(img.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
          if (found?.data) {
            stopScanner();
            verifyByToken(found.data);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setResult({ ok: false, error: 'camera_blocked' });
    }
  };

  const stopScanner = () => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  };

  useEffect(() => () => stopScanner(), []);

  return (
    <div className="ticket-scan-wrap">
      <div className="ticket-scan-grid">
        {/* LEFT — camera scanner */}
        <div className="auth-urlcfg-card">
          <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Scan QR with camera</h3>
          <div className="ticket-scan-camera">
            <video ref={videoRef} muted playsInline />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            {!scanning && (
              <div className="ticket-scan-overlay">
                <QrCode size={40} />
                <span>Camera off</span>
              </div>
            )}
          </div>
          <div className="auth-actions" style={{ marginTop: 12 }}>
            {!scanning
              ? <button type="button" className="crm-submit-btn" onClick={startScanner} disabled={busy}>
                  Start scanner
                </button>
              : <button type="button" className="crm-submit-btn auth-btn-danger" onClick={stopScanner}>
                  Stop scanner
                </button>
            }
          </div>
        </div>

        {/* RIGHT — manual code entry + result */}
        <div className="auth-urlcfg-card">
          <h3 className="crm-section-title" style={{ marginBottom: 12 }}>Enter access code</h3>
          <form className="cpm-form" onSubmit={(e) => { e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c) verifyByCode(c);
          }}>
            <input className="crm-input" placeholder="XXXX-XXXX" maxLength={16}
              value={code} onChange={e => setCode(e.target.value.toUpperCase())}
              style={{ fontFamily: 'monospace', letterSpacing: '2px', textAlign: 'center', fontSize: 16 }}
              autoFocus />
            <div className="auth-actions" style={{ marginTop: 12 }}>
              <button type="submit" className="crm-submit-btn" disabled={busy || !code.trim()}>
                Verify
              </button>
              <button type="button" className="crm-submit-btn auth-btn-secondary"
                onClick={() => { setCode(''); setResult(null); }}>
                Clear
              </button>
            </div>
          </form>

          {result && (
            <div className={`ticket-scan-result ${result.ok ? 'ticket-scan-result--ok' : 'ticket-scan-result--fail'}`}>
              {result.ok ? <Check size={28} weight="bold" /> : <X size={28} weight="bold" />}
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {result.ok ? 'Valid ticket' : 'Invalid / not found'}
                </div>
                {result.ok ? (
                  <>
                    <div style={{ fontSize: 13 }}>{result.title} {result.variation && `— ${result.variation}`}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Order #{result.order_id} · {result.recipient || 'guest'} · {result.status}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{result.error || 'Try again'}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
