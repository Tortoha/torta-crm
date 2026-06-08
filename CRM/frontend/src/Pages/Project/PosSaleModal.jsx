// PosSaleModal — in-store / point-of-sale checkout rung up from CRM Orders.
//
// Two panes: LEFT = catalog (scan/search + category chips + a browsable product
// grid; multi-variant products drill into their SKUs), RIGHT = the ticket (cart
// lines with batch + qty, payment, optional customer, total, complete).
//
// Hardware barcode scanners just "type" the code + Enter, so the focused scan box
// captures them — no device API. The backend creates a delivered + paid order and
// deducts stock immediately (POST /pos/sale).
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Barcode, Trash, Plus, Minus, Package, CircleNotch, CaretLeft } from '@phosphor-icons/react';
import { API_BASE } from '../../api.js';
import { formatMoney } from '../../Utils/currency.js';
import { InteractiveSection } from '../../Utils/InteractiveSection.js';
import Modal from '../../Elements/Modal.jsx';
import { Combobox } from './Booking/BookingCreateModal.jsx';
import '../../Style/Booking.css';   // .bk-cb-* dropdown styles the shared Combobox needs
import '../../Style/Pos.css';

// Module-level counter for stable React keys (no Math.random — keeps keys deterministic).
let _lineSeq = 0;

// Subtle 3D tilt for catalog tiles — the same InteractiveSection hook the
// Dashboard / Organization cards use, so POS tiles feel native to the system.
const TILE_TILT = {
  maxAngle: 14, lerp: 0.05, lerpOut: 0.07,
  scale: 1.04, perspective: 620,
  gloss: { opacity: 0, spread: 0 },
};

function PosTile({ onClick, children }) {
  const { ref, handlers } = InteractiveSection(TILE_TILT, false);
  return (
    <div ref={ref} className="pos-tile" role="button" tabIndex={0} onClick={onClick} {...handlers}>
      {children}
    </div>
  );
}

export default function PosSaleModal({ projectId, currency = 'USD', onClose, onDone }) {
  const { t } = useTranslation();
  const base = `${API_BASE}/api/projects/${projectId}/pos`;

  const [query,     setQuery]     = useState('');
  const [cats,      setCats]      = useState([]);
  const [activeCat, setActiveCat] = useState(null);   // null = all categories
  const [catalog,   setCatalog]   = useState([]);     // flat SKU rows (browse or search)
  const [loading,   setLoading]   = useState(false);
  const [drill,     setDrill]     = useState(null);   // a product → browse its SKUs
  const [cart,      setCart]      = useState([]);
  const [cust,      setCust]      = useState({ name: '', phone: '', email: '' });
  const [showCust,  setShowCust]  = useState(false);
  const [pay,       setPay]       = useState('cash');
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState('');

  const scanRef = useRef(null);
  const focusScan = useCallback(() => { try { scanRef.current?.focus(); } catch { /* noop */ } }, []);
  useEffect(() => { focusScan(); }, [focusScan]);

  // Mirror cart into a ref so add/scan handlers read the CURRENT cart synchronously.
  const cartRef = useRef(cart);
  useEffect(() => { cartRef.current = cart; }, [cart]);

  // Categories (once).
  useEffect(() => {
    fetch(`${API_BASE}/api/categories?project_id=${projectId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCats(Array.isArray(d) ? d : []))
      .catch(() => setCats([]));
  }, [projectId]);

  // Catalog feed: a search query searches the WHOLE catalog (ignores category);
  // otherwise we browse the selected category (or everything). Debounced on search.
  useEffect(() => {
    const q = query.trim();
    let alive = true;
    setLoading(true);
    const run = async () => {
      try {
        const url = q
          ? `${base}/catalog?search=${encodeURIComponent(q)}`
          : `${base}/catalog${activeCat != null ? `?category_id=${activeCat}` : ''}`;
        const r = await fetch(url, { credentials: 'include' });
        const d = r.ok ? await r.json() : [];
        if (alive) setCatalog(Array.isArray(d) ? d : []);
      } catch { if (alive) setCatalog([]); }
      finally { if (alive) setLoading(false); }
    };
    const h = setTimeout(run, q ? 220 : 0);
    return () => { alive = false; clearTimeout(h); };
  }, [query, activeCat, base]);

  // Group flat SKU rows into product tiles (one tile per product, its SKUs nested).
  const products = useMemo(() => {
    const m = new Map();
    for (const s of catalog) {
      let p = m.get(s.product_id);
      if (!p) {
        p = { product_id: s.product_id, title: s.product_title, image: s.image_url || null,
              skus: [], minP: Infinity, maxP: 0, stock: 0 };
        m.set(s.product_id, p);
      }
      p.skus.push(s);
      if (!p.image && s.image_url) p.image = s.image_url;
      const pr = Number(s.price) || 0;
      p.minP = Math.min(p.minP, pr);
      p.maxP = Math.max(p.maxP, pr);
      p.stock += Number(s.stock) || 0;
    }
    return [...m.values()];
  }, [catalog]);

  // ── Cart helpers ────────────────────────────────────────────────────
  const lineCap = (l) => {
    if (l.batch_id) {
      const b = l.batches.find(x => x.id === l.batch_id);
      return Math.max(1, Number(b?.quantity_remaining ?? l.stock) || 1);
    }
    return Math.max(1, Number(l.stock) || 1);
  };
  const stepQty = (key, d) => setCart(prev => prev.map(l =>
    l.key === key ? { ...l, qty: Math.min(Math.max(1, (l.qty || 1) + d), lineCap(l)) } : l));
  const setQty = (key, v) => setCart(prev => prev.map(l => {
    if (l.key !== key) return l;
    const n = parseInt(String(v).replace(/\D/g, ''), 10);
    return { ...l, qty: Number.isNaN(n) ? 1 : Math.min(Math.max(1, n), lineCap(l)) };
  }));
  const pickBatch = (key, batchId) => setCart(prev => prev.map(l => {
    if (l.key !== key) return l;
    const b = l.batches.find(x => x.id === batchId);
    const cap = Math.max(1, Number(b?.quantity_remaining ?? l.stock) || 1);
    return { ...l, batch_id: batchId, qty: Math.min(l.qty, cap) };
  }));
  const removeLine = (key) => setCart(prev => prev.filter(l => l.key !== key));

  // Add a SKU: bump qty if already in the cart, else append a fresh line and
  // lazy-load its batches (defaulting to the FEFO — earliest-expiry — batch).
  const addToCart = useCallback(async (sku) => {
    setErr('');
    setQuery(''); focusScan();
    const existing = cartRef.current.find(l => l.sku_id === sku.sku_id);
    if (existing) {
      setCart(prev => prev.map(l => {
        if (l.sku_id !== sku.sku_id) return l;
        const cap = l.batch_id
          ? Math.max(1, Number(l.batches.find(b => b.id === l.batch_id)?.quantity_remaining ?? l.stock) || 1)
          : Math.max(1, Number(l.stock) || 1);
        return { ...l, qty: Math.min(l.qty + 1, cap) };
      }));
      return;
    }
    const key = `l${++_lineSeq}`;
    setCart(prev => [...prev, {
      key, sku_id: sku.sku_id,
      product_title: sku.product_title, variation_name: sku.variation_name,
      configuration_name: sku.configuration_name, sku_code: sku.sku_code,
      image_url: sku.image_url, unit_price: Number(sku.price) || 0,
      qty: 1, stock: Number(sku.stock) || 0, batches: [], batch_id: null,
    }]);
    try {
      const r = await fetch(`${base}/sku-batches?sku_id=${sku.sku_id}`, { credentials: 'include' });
      const batches = r.ok ? await r.json() : [];
      setCart(prev => prev.map(l => l.key === key
        ? { ...l, batches: Array.isArray(batches) ? batches : [], batch_id: batches[0]?.id ?? null }
        : l));
    } catch { /* no batches → sells from warehouse stock */ }
  }, [base, focusScan]);

  // Click a product tile: single SKU adds straight away, multi-variant drills in.
  const pickProduct = (p) => {
    if (p.skus.length === 1) addToCart(p.skus[0]);
    else setDrill(p);
  };

  // Barcode → exactly one SKU.
  const doScan = useCallback(async (code) => {
    const c = (code || '').trim();
    if (!c) return;
    setErr('');
    try {
      const r = await fetch(`${base}/scan?code=${encodeURIComponent(c)}`, { credentials: 'include' });
      if (r.ok) { addToCart(await r.json()); return; }
    } catch { /* fall through */ }
    setErr(t('orders.pos.notFound', { code: c }));
  }, [base, addToCart, t]);

  // Enter on the scan box: a populated search → add the top hit; otherwise treat
  // the raw value as a barcode (the fast-scanner path, where Enter beats the debounce).
  const onScanKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (catalog.length >= 1) addToCart(catalog[0]);
    else doScan(q);
  };

  // Capture a hardware scan even if focus drifted off the box (never while another
  // field is focused, so customer-name typing isn't hijacked).
  useEffect(() => {
    let buf = '', last = 0;
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
      const now = e.timeStamp || 0;
      if (now - last > 120) buf = '';
      last = now;
      if (e.key === 'Enter') { if (buf.length >= 3) doScan(buf); buf = ''; return; }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doScan]);

  const total = useMemo(
    () => cart.reduce((s, l) => s + (Number(l.unit_price) || 0) * (l.qty || 0), 0), [cart]);
  const count = useMemo(() => cart.reduce((s, l) => s + (l.qty || 0), 0), [cart]);

  const submit = async () => {
    if (!cart.length || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${base}/sale`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(l => ({
            sku_id: l.sku_id, quantity: l.qty,
            batch_id: l.batch_id ?? null, price: l.unit_price,
          })),
          customer_name: cust.name.trim() || null,
          customer_email: cust.email.trim() || null,
          phone: cust.phone.trim() || null,
          payment_method: pay,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { onDone?.(d.order_id); onClose?.(); }
      else setErr(d.detail || t('orders.pos.failed'));
    } catch { setErr(t('orders.pos.failed')); }
    finally { setBusy(false); }
  };

  const tilePrice = (p) => (p.minP === p.maxP
    ? formatMoney(p.minP, currency)
    : t('orders.pos.fromPrice', { price: formatMoney(p.minP, currency) }));

  return (
    <Modal onClose={onClose} title={t('orders.pos.title')} subtitle={t('orders.pos.subtitle')} maxWidth={1040}>
      <div className="pos-wrap">
        {/* ── LEFT: catalog ── */}
        <div className="pos-catalog">
          <div className="pos-scan">
            <Barcode className="pos-scan-ico" weight="duotone" />
            <input
              ref={scanRef}
              className="pos-scan-input"
              placeholder={t('orders.pos.scanPlaceholder')}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onScanKey}
              autoComplete="off"
            />
            {loading && <CircleNotch className="pos-scan-spin" />}
          </div>

          {!drill && !query.trim() && (
            <div className="pos-cats">
              <button
                type="button"
                className={`pos-cat${activeCat == null ? ' pos-cat--on' : ''}`}
                onClick={() => setActiveCat(null)}
              >
                {t('orders.pos.allCategories')}
              </button>
              {cats.map(c => (
                <button
                  key={c.id} type="button"
                  className={`pos-cat${activeCat === c.id ? ' pos-cat--on' : ''}`}
                  onClick={() => setActiveCat(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {drill && (
            <button type="button" className="pos-back" onClick={() => setDrill(null)}>
              <CaretLeft /> {drill.title}
            </button>
          )}

          <div className="pos-grid">
            {loading ? (
              <div className="pos-grid-msg"><CircleNotch className="pos-grid-spin" /></div>
            ) : drill ? (
              drill.skus.map(s => (
                <PosTile key={s.sku_id} onClick={() => { addToCart(s); setDrill(null); }}>
                  <span className="pos-tile-img">{s.image_url ? <img src={s.image_url} alt="" /> : <Package />}</span>
                  <span className="pos-tile-title">
                    {s.variation_name || s.configuration_name || s.sku_code || t('orders.pos.variant')}
                  </span>
                  <span className="pos-tile-sub">{[s.configuration_name, s.sku_code].filter(Boolean).join(' · ')}</span>
                  <span className="pos-tile-foot">
                    <span className="pos-tile-price">{formatMoney(s.price, currency)}</span>
                    <span className="pos-tile-stock">{t('orders.pos.inStock', { n: s.stock })}</span>
                  </span>
                </PosTile>
              ))
            ) : products.length === 0 ? (
              <div className="pos-grid-msg">
                {query.trim() ? t('orders.pos.noResults') : t('orders.pos.emptyCat')}
              </div>
            ) : products.map(p => (
              <PosTile key={p.product_id} onClick={() => pickProduct(p)}>
                <span className="pos-tile-img">{p.image ? <img src={p.image} alt="" /> : <Package />}</span>
                <span className="pos-tile-title">{p.title}</span>
                <span className="pos-tile-sub">
                  {p.skus.length > 1
                    ? t('orders.pos.nVariants', { n: p.skus.length })
                    : (p.skus[0]?.configuration_name || p.skus[0]?.sku_code || '')}
                </span>
                <span className="pos-tile-foot">
                  <span className="pos-tile-price">{tilePrice(p)}</span>
                  <span className="pos-tile-stock">{t('orders.pos.inStock', { n: p.stock })}</span>
                </span>
              </PosTile>
            ))}
          </div>
        </div>

        {/* ── RIGHT: ticket ── */}
        <div className="pos-ticket">
          {err && <div className="pos-err">{err}</div>}

          <div className="pos-cart">
            {cart.length === 0 ? (
              <div className="pos-empty">
                <Barcode className="pos-empty-ico" weight="thin" />
                <p>{t('orders.pos.emptyHint')}</p>
              </div>
            ) : cart.map(l => (
              <div key={l.key} className="pos-line">
                <div className="pos-line-top">
                  <span className="pos-line-thumb">{l.image_url ? <img src={l.image_url} alt="" /> : <Package />}</span>
                  <div className="pos-line-main">
                    <div className="pos-line-title">
                      {l.product_title}{l.variation_name ? ` · ${l.variation_name}` : ''}
                    </div>
                    <div className="pos-line-sub">{[l.configuration_name, l.sku_code].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button type="button" className="pos-line-del" onClick={() => removeLine(l.key)} title={t('orders.pos.remove')}>
                    <Trash />
                  </button>
                </div>
                {l.batches.length > 0 && (
                  <div className="pos-batch-cb">
                    <Combobox
                      value={l.batch_id ?? ''}
                      options={l.batches.map(b => ({
                        value: b.id,
                        label: `${b.batch_name} · ${t('orders.pos.left', { n: b.quantity_remaining })}`
                          + (b.warehouse_name ? ` · ${b.warehouse_name}` : '')
                          + (b.expiry_date ? ` · ${b.expiry_date}` : ''),
                      }))}
                      onChange={v => pickBatch(l.key, Number(v))}
                    />
                  </div>
                )}
                <div className="pos-line-bottom">
                  <div className="pos-qty">
                    <button type="button" className="pos-qty-btn" onClick={() => stepQty(l.key, -1)}><Minus /></button>
                    <input className="pos-qty-input" value={l.qty} inputMode="numeric" onChange={e => setQty(l.key, e.target.value)} />
                    <button type="button" className="pos-qty-btn" onClick={() => stepQty(l.key, +1)}><Plus /></button>
                  </div>
                  <div className="pos-line-price">{formatMoney((Number(l.unit_price) || 0) * l.qty, currency)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="pos-foot">
            <div className="pos-foot-row">
              <div className="pos-pay">
                {['cash', 'card', 'other'].map(m => (
                  <button key={m} type="button" className={`pos-pay-btn${pay === m ? ' pos-pay-btn--on' : ''}`} onClick={() => setPay(m)}>
                    {t(`orders.pos.pay.${m}`)}
                  </button>
                ))}
              </div>
              <button type="button" className="pos-cust-toggle" onClick={() => setShowCust(v => !v)}>
                {showCust ? t('orders.pos.hideCustomer') : t('orders.pos.addCustomer')}
              </button>
            </div>

            {showCust && (
              <div className="pos-cust">
                <input className="pos-cust-input" placeholder={t('orders.pos.custName')}
                       value={cust.name} onChange={e => setCust(c => ({ ...c, name: e.target.value }))} />
                <input className="pos-cust-input" placeholder={t('orders.pos.custPhone')}
                       value={cust.phone} onChange={e => setCust(c => ({ ...c, phone: e.target.value }))} />
                <input className="pos-cust-input" placeholder={t('orders.pos.custEmail')}
                       value={cust.email} onChange={e => setCust(c => ({ ...c, email: e.target.value }))} />
              </div>
            )}

            <div className="pos-total-row">
              <div className="pos-total">
                <span className="pos-total-label">{t('orders.pos.total', { n: count })}</span>
                <span className="pos-total-val">{formatMoney(total, currency)}</span>
              </div>
              <button type="button" className="pos-complete" disabled={!cart.length || busy} onClick={submit}>
                {busy ? t('orders.pos.processing') : t('orders.pos.complete')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
