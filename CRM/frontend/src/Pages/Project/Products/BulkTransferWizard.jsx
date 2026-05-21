// Bulk Transfer Wizard — two-step modal: pick SKUs (with cascade), then plan from/to/qty per SKU; applies as one transaction.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  X, CaretRight, CaretDown, Folder, Cube,
  ArrowsLeftRight, ArrowRight, Trash,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { Combobox } from '../Booking/BookingCreateModal.jsx';

export function BulkTransferButton({ onClick, disabled }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="org-new-btn"
      onClick={onClick} disabled={disabled}>
      <ArrowsLeftRight weight="bold" className="org-new-icon" /> {t('products.bulkTransfer.distribute')}
    </button>
  );
}

export default function BulkTransferWizard({ projectId, onClose, onApplied, showToast }) {
  const { t } = useTranslation();
  const pq = `?project_id=${projectId}`;
  const [step, setStep] = useState(1);
  const [products, setProducts] = useState([]);   // hydrated tree per chevron click
  const [warehouses, setWarehouses] = useState([]);
  const [productList, setProductList] = useState([]);  // cheap list rows
  const [expanded, setExpanded] = useState({});         // pid → { hydrated, data }
  const [selected, setSelected] = useState(new Set()); // sku_ids
  // skuMeta keeps the data we need to render Step 2: name, breadcrumb, stocks per WH.
  const [skuMeta, setSkuMeta] = useState({}); // sku_id → { label, breadcrumb, stocks: {wh_id: qty} }
  const [plan, setPlan] = useState({});       // sku_id → { from_wh, to_wh, qty, batch_choice, batch_custom }
  const [busy, setBusy] = useState(false);
  // Cache of existing-batch options per (sku, to_wh) for the Combobox.
  const [batchOptionsBySkuWh, setBatchOptionsBySkuWh] = useState({});

  // ── Initial load ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/api/products${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        // Physical-only — services, digital, events don't carry warehouse stock.
        const visible = (Array.isArray(list) ? list : []).filter(
          p => (p.product_type || 'physical') === 'physical'
        );
        setProductList(visible);
      });
    fetch(`${API_BASE}/api/warehouses${pq}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setWarehouses(Array.isArray(d) ? d.filter(w => w.is_active) : []));
  }, [pq, projectId]);

  // Lazy-load existing batches for (sku, to_wh) pair whenever a row's destination changes.
  const loadBatchesFor = useCallback(async (sid, whId) => {
    if (!whId) return;
    const key = `${sid}:${whId}`;
    if (batchOptionsBySkuWh[key]) return;
    const r = await fetch(
      `${API_BASE}/api/projects/${projectId}/batches/lookup?sku_id=${sid}&warehouse_id=${whId}`,
      { credentials: 'include' }
    );
    const list = r.ok ? await r.json() : [];
    setBatchOptionsBySkuWh(prev => ({ ...prev, [key]: list }));
  }, [projectId, batchOptionsBySkuWh]);

  // In-flight hydrate promises — concurrent callers share one fetch.
  const hydratePromises = useRef({});

  const hydrateProduct = useCallback((pid) => {
    if (expanded[pid]?.hydrated) return Promise.resolve(expanded[pid].data);
    if (hydratePromises.current[pid]) return hydratePromises.current[pid];

    setExpanded(prev => ({ ...prev, [pid]: { ...(prev[pid] || {}), loading: true } }));
    const promise = (async () => {
      const [pd, perWh] = await Promise.all([
        fetch(`${API_BASE}/api/products/${pid}${pq}`,                   { credentials: 'include' }).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/products/${pid}/stock/per-warehouse${pq}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      ]);
      if (!pd) {
        setExpanded(prev => ({ ...prev, [pid]: { hydrated: false, loading: false } }));
        delete hydratePromises.current[pid];
        return null;
      }
      // Cache stock-per-WH for every leaf SKU under this product so step 2 can show it.
      setSkuMeta(prev => {
        const next = { ...prev };
        for (const row of (perWh || [])) {
          const stocks = {};
          for (const w of (row.warehouses || [])) stocks[w.warehouse_id] = w.quantity;
          next[row.sku_id] = {
            label:      `${row.variation_name} / ${row.sku_name}`,
            breadcrumb: `${pd.title} / ${row.variation_name} / ${row.sku_name}`,
            stocks,
          };
        }
        return next;
      });
      setExpanded(prev => ({ ...prev, [pid]: { hydrated: true, loading: false, data: pd } }));
      delete hydratePromises.current[pid];
      return pd;
    })();
    hydratePromises.current[pid] = promise;
    return promise;
  }, [expanded, pq]);

  // ── Selection helpers ────────────────────────────────────────────────
  const toggleSku = (skuId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId); else next.add(skuId);
      return next;
    });
  };
  const skuIdsOfProduct = (pd) => {
    const ids = [];
    for (const v of (pd?.variations || [])) {
      for (const c of (v.configurations || [])) ids.push(c.id);
    }
    return ids;
  };
  const skuIdsOfVariation = (v) => (v.configurations || []).map(c => c.id);
  const setMany = (ids, on) => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });
  };

  const productAggState = (pd) => {
    const ids = skuIdsOfProduct(pd);
    if (ids.length === 0) return 'none';
    const on = ids.filter(i => selected.has(i)).length;
    if (on === 0) return 'none';
    if (on === ids.length) return 'all';
    return 'some';
  };
  const variationAggState = (v) => {
    const ids = skuIdsOfVariation(v);
    if (ids.length === 0) return 'none';
    const on = ids.filter(i => selected.has(i)).length;
    if (on === 0) return 'none';
    if (on === ids.length) return 'all';
    return 'some';
  };

  // ── Step 2 plan defaults — fired the moment we transition to step 2 ──
  const goToStep2 = () => {
    if (selected.size === 0) { showToast(t('products.bulkTransfer.pickAtLeastOne')); return; }
    const next = {};
    for (const sid of selected) {
      const meta = skuMeta[sid];
      if (!meta) { next[sid] = { from_wh: '', to_wh: '', qty: '' }; continue; }
      // Default From = WH with most stock; qty stays empty so merchant types it explicitly.
      let bestWh = null;
      let bestQty = -1;
      for (const [whId, q] of Object.entries(meta.stocks)) {
        if (q > bestQty) { bestQty = q; bestWh = Number(whId); }
      }
      next[sid] = { from_wh: bestWh ?? '', to_wh: '', qty: '' };
    }
    setPlan(next);
    setStep(2);
  };

  const setAllTo = (whId) => {
    setPlan(prev => {
      const out = { ...prev };
      for (const sid of Object.keys(out)) out[sid] = { ...out[sid], to_wh: whId };
      return out;
    });
  };
  const updateRow = (sid, patch) => {
    setPlan(prev => ({ ...prev, [sid]: { ...prev[sid], ...patch } }));
  };
  const removeRow = (sid) => {
    setPlan(prev => {
      const out = { ...prev };
      delete out[sid];
      return out;
    });
    setSelected(prev => {
      const next = new Set(prev);
      next.delete(sid);
      return next;
    });
  };

  // ── Validation for Apply ─────────────────────────────────────────────
  const validRows = useMemo(() => {
    const rows = [];
    for (const [sidStr, p] of Object.entries(plan)) {
      const sid = Number(sidStr);
      const fromWh = p.from_wh ? Number(p.from_wh) : null;
      const toWh   = p.to_wh   ? Number(p.to_wh)   : null;
      const qty    = parseInt(p.qty, 10);
      const meta   = skuMeta[sid];
      const haveOnSource = meta && fromWh != null ? (meta.stocks[fromWh] || 0) : 0;
      // Transfer requires an existing batch at the destination — no new-batch flow here.
      const batchChoice = p.batch_choice || '';
      const batchValid  = batchChoice.startsWith('existing:');
      const isValid = (
        fromWh != null && toWh != null && fromWh !== toWh &&
        !isNaN(qty) && qty > 0 && qty <= haveOnSource &&
        batchValid
      );
      rows.push({ sid, fromWh, toWh, qty, haveOnSource, isValid, batchChoice });
    }
    return rows;
  }, [plan, skuMeta]);

  const allValid = validRows.length > 0 && validRows.every(r => r.isValid);

  const apply = async () => {
    if (!allValid) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/projects/${projectId}/stock/bulk-transfer`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transfers: validRows.map(r => {
            const out = {
              sku_id:            r.sid,
              from_warehouse_id: r.fromWh,
              to_warehouse_id:   r.toWh,
              quantity:          r.qty,
            };
            if (r.batchChoice?.startsWith('existing:')) {
              out.target_batch_id = Number(r.batchChoice.slice(9));
            }
            return out;
          }),
        }),
      });
      if (r.ok) {
        const j = await r.json();
        showToast(t('products.bulkTransfer.toastTransferred', { lines: j.transfers_applied, skus: j.skus_affected }));
        onApplied?.();
      } else {
        const j = await r.json().catch(() => ({}));
        showToast(j.detail || t('products.bulkTransfer.transferFailed'));
      }
    } finally { setBusy(false); }
  };

  // ── Render ───────────────────────────────────────────────────────────
  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal po-bulk-wizard po-bulk-wizard--transfer" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">
                {step === 1 ? t('products.bulkTransfer.pickStepTitle') : t('products.bulkTransfer.planStepTitle')}
              </div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {t('products.bulkTransfer.stepProgress', { step, count: selected.size })}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          {step === 1 ? (
            <Step1Tree
              productList={productList}
              expanded={expanded}
              hydrate={hydrateProduct}
              selected={selected}
              toggleSku={toggleSku}
              setMany={setMany}
              productAggState={productAggState}
              variationAggState={variationAggState}
              skuIdsOfProduct={skuIdsOfProduct}
              skuIdsOfVariation={skuIdsOfVariation}
            />
          ) : (
            <Step2Plan
              warehouses={warehouses}
              skuMeta={skuMeta}
              plan={plan}
              validRows={validRows}
              setAllTo={setAllTo}
              updateRow={updateRow}
              removeRow={removeRow}
              batchOptionsBySkuWh={batchOptionsBySkuWh}
              loadBatchesFor={loadBatchesFor}
            />
          )}

          <div className="auth-actions po-bulk-wizard-actions">
            {step === 1 ? (
              <>
                <button type="button" className="crm-submit-btn"
                  disabled={selected.size === 0} onClick={goToStep2}>
                  {t('products.bulkTransfer.next')} <ArrowRight weight="bold" />
                </button>
                <button type="button" className="crm-submit-btn auth-btn-secondary po-disc-cancel-btn"
                  onClick={onClose}>{t('products.bulkTransfer.cancel')}</button>
              </>
            ) : (
              <>
                <button type="button" className="crm-submit-btn auth-btn-secondary"
                  onClick={() => setStep(1)} disabled={busy}>
                  {t('products.bulkTransfer.back')}
                </button>
                <button type="button" className="crm-submit-btn"
                  disabled={!allValid || busy} onClick={apply}>
                  {busy ? t('products.bulkTransfer.applying') : t('products.bulkTransfer.applyTransfers', { count: validRows.length })}
                </button>
                <button type="button" className="crm-submit-btn auth-btn-secondary po-disc-cancel-btn"
                  onClick={onClose} disabled={busy}>{t('products.bulkTransfer.cancel')}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Step 1: Tree with cascading checkboxes ─────────────────────────────

function Step1Tree({ productList, expanded, hydrate, selected, toggleSku, setMany,
                      productAggState, variationAggState,
                      skuIdsOfProduct, skuIdsOfVariation }) {
  const { t } = useTranslation();
  const [openProducts, setOpenProducts] = useState(new Set());
  const [openVars, setOpenVars] = useState(new Set());
  // Products whose checkbox was clicked while still hydrating — shows brief loading state.
  const [busyPid, setBusyPid] = useState(new Set());

  const togglePid = (pid) => {
    setOpenProducts(prev => {
      const n = new Set(prev);
      if (n.has(pid)) n.delete(pid);
      else { n.add(pid); hydrate(pid); }
      return n;
    });
  };
  const toggleVid = (key) => {
    setOpenVars(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  // Product checkbox: hydrate if needed, cascade to all SKUs, auto-open the branch.
  const onProductCheck = async (p, checked) => {
    let pd = expanded[p.id]?.data;
    if (!pd) {
      setBusyPid(prev => { const n = new Set(prev); n.add(p.id); return n; });
      try {
        pd = await hydrate(p.id);
      } finally {
        setBusyPid(prev => { const n = new Set(prev); n.delete(p.id); return n; });
      }
    }
    if (!pd) return;
    setMany(skuIdsOfProduct(pd), checked);
    if (checked) {
      // Reveal the freshly-selected branch.
      setOpenProducts(prev => {
        const n = new Set(prev);
        n.add(p.id);
        return n;
      });
    }
  };

  if (productList.length === 0) {
    return <p className="crm-placeholder">{t('products.bulkTransfer.noProducts')}</p>;
  }

  return (
    <div className="po-bulk-tree">
      {productList.map(p => {
        const pdState = expanded[p.id];
        const pd = pdState?.data;
        const isOpen = openProducts.has(p.id);
        const aggState = pd ? productAggState(pd) : 'none';
        const isBusy = busyPid.has(p.id);
        return (
          <div key={p.id} className="po-bulk-tree-node">
            <div className="po-bulk-tree-row">
              <button type="button" className="po-tree-chevron"
                onClick={() => togglePid(p.id)}>
                {isOpen ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}
              </button>
              <TriCheckbox state={aggState}
                disabled={isBusy}
                onChange={(checked) => onProductCheck(p, checked)} />
              <Folder weight="duotone" className="po-disc-cell--strong" />
              <span className="po-set-strong">{p.title}</span>
              <span className="po-set-note po-tree-meta">
                · {p.variations_count === 1 ? t('products.bulkTransfer.variationOne', { count: p.variations_count }) : t('products.bulkTransfer.variationMany', { count: p.variations_count || 0 })}
                {isBusy && <span className="po-bulk-tree-loading-inline"> · {t('products.bulkTransfer.loadingInline')}</span>}
              </span>
            </div>
            {isOpen && !pdState?.hydrated && (
              <div className="po-bulk-tree-loading">{t('products.bulkTransfer.loading')}</div>
            )}
            {isOpen && pd && (pd.variations || []).map(v => {
              const vKey = `${p.id}-${v.id}`;
              const vOpen = openVars.has(vKey);
              const vState = variationAggState(v);
              return (
                <div key={v.id} className="po-bulk-tree-subnode">
                  <div className="po-bulk-tree-row po-bulk-tree-row--depth-1">
                    <button type="button" className="po-tree-chevron"
                      onClick={() => toggleVid(vKey)}>
                      {vOpen ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}
                    </button>
                    <TriCheckbox state={vState}
                      onChange={(checked) => setMany(skuIdsOfVariation(v), checked)} />
                    <span className="po-set-strong">{v.variation_name || v.name || '—'}</span>
                    <span className="po-set-note po-tree-meta">
                      · {(v.configurations || []).length === 1 ? t('products.bulkTransfer.skuOne', { count: (v.configurations || []).length }) : t('products.bulkTransfer.skuMany', { count: (v.configurations || []).length })}
                    </span>
                  </div>
                  {vOpen && (v.configurations || []).map(c => (
                    <div key={c.id} className="po-bulk-tree-row po-bulk-tree-row--depth-2">
                      <span className="po-tree-chevron-spacer" />
                      <TriCheckbox
                        state={selected.has(c.id) ? 'all' : 'none'}
                        onChange={() => toggleSku(c.id)} />
                      <Cube className="po-disc-cell--muted" />
                      <span>{c.configuration_name || c.name || '—'}</span>
                      <span className="po-set-note po-tree-meta">
                        · {t('products.bulkTransfer.stock', { count: c.stock_quantity ?? 0 })}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 2: per-SKU planner table ──────────────────────────────────────

function Step2Plan({ warehouses, skuMeta, plan, validRows, setAllTo, updateRow, removeRow,
                     batchOptionsBySkuWh, loadBatchesFor }) {
  const { t } = useTranslation();
  const planEntries = Object.entries(plan);
  if (planEntries.length === 0) {
    return <p className="crm-placeholder">{t('products.bulkTransfer.nothingSelected')}</p>;
  }

  return (
    <>
      <div className="po-bulk-plan-toolbar">
        <span className="cpm-section-hint">{t('products.bulkTransfer.quickAction')}</span>
        <span className="po-cb-wrap po-bulk-plan-quick-cb">
          <Combobox value="" placeholder={t('products.bulkTransfer.setAllDestinations')}
            options={warehouses.map(w => ({
              value: w.id,
              label: w.is_default ? `${w.name} · ${t('products.bulkTransfer.default')}` : w.name,
            }))}
            onChange={(v) => v && setAllTo(Number(v))} />
        </span>
      </div>

      <div className="po-bulk-plan-table po-bulk-plan-table--batch">
        <div className="po-bulk-plan-row po-bulk-plan-row--head po-bulk-plan-row--batch">
          <span>{t('products.bulkTransfer.colSku')}</span>
          <span>{t('products.bulkTransfer.colFrom')}</span>
          <span></span>
          <span>{t('products.bulkTransfer.colTo')}</span>
          <span>{t('products.bulkTransfer.colBatch')}</span>
          <span>{t('products.bulkTransfer.colQty')}</span>
          <span>{t('products.bulkTransfer.colAvail')}</span>
          <span></span>
        </div>
        {planEntries.map(([sidStr, p]) => {
          const sid = Number(sidStr);
          const meta = skuMeta[sid];
          const validRow = validRows.find(r => r.sid === sid);
          const havStr = meta && p.from_wh
            ? (meta.stocks[Number(p.from_wh)] ?? 0)
            : '—';
          // Transfer can ONLY add to an existing batch at the destination — never create
          // a new one. (New batches are created via the Add stock wizard.) If no batches
          // exist at the chosen destination, the dropdown stays empty and the row reads
          // as invalid until the merchant picks a different destination.
          const toWhNum = p.to_wh === '' ? null : Number(p.to_wh);
          const batchOpts = toWhNum != null ? (batchOptionsBySkuWh[`${sid}:${toWhNum}`] || []) : [];
          const choice = p.batch_choice || '';
          const batchSelectOptions = batchOpts.map(b => ({
            value: `existing:${b.id}`,
            label: t('products.bulkTransfer.batchOption', { name: b.batch_name, count: b.quantity_remaining }),
          }));

          return (
            <div key={sid}
              className={`po-bulk-plan-row po-bulk-plan-row--batch${validRow?.isValid === false ? ' po-bulk-plan-row--invalid' : ''}`}>
              <span className="po-bulk-plan-sku">
                <span className="po-set-strong">{meta?.label || `#${sid}`}</span>
                <span className="po-set-note po-bulk-plan-bc">{meta?.breadcrumb}</span>
              </span>
              <span className="po-cb-wrap">
                <Combobox value={p.from_wh === '' ? '' : Number(p.from_wh)}
                  placeholder={t('products.bulkTransfer.from')}
                  options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                  onChange={(v) => updateRow(sid, { from_wh: v === '' ? '' : Number(v) })} />
              </span>
              <ArrowRight weight="bold" className="po-bulk-plan-arrow" />
              <span className="po-cb-wrap">
                <Combobox value={p.to_wh === '' ? '' : Number(p.to_wh)}
                  placeholder={t('products.bulkTransfer.to')}
                  options={warehouses
                    .filter(w => w.id !== Number(p.from_wh))
                    .map(w => ({ value: w.id, label: w.name }))}
                  onChange={(v) => {
                    const next = v === '' ? '' : Number(v);
                    updateRow(sid, { to_wh: next });
                    if (next) loadBatchesFor?.(sid, next);
                  }} />
              </span>
              <span className="po-bulk-plan-batch-cell">
                <Combobox value={choice}
                  options={batchSelectOptions}
                  placeholder={toWhNum == null
                    ? t('products.bulkTransfer.pickDestinationFirst')
                    : batchOpts.length === 0
                      ? t('products.bulkTransfer.noBatchesHere')
                      : t('products.bulkTransfer.pickBatch')}
                  onChange={(v) => updateRow(sid, { batch_choice: v })} />
              </span>
              <input type="number" min="1" className="crm-input po-bulk-plan-qty"
                placeholder="0"
                value={p.qty}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') { updateRow(sid, { qty: '' }); return; }
                  const n = parseInt(raw, 10);
                  if (isNaN(n) || n < 0) return;
                  // Auto-clamp to available stock at source WH.
                  const max = meta && p.from_wh
                    ? (meta.stocks[Number(p.from_wh)] ?? 0)
                    : null;
                  const clamped = max !== null ? Math.min(n, max) : n;
                  updateRow(sid, { qty: clamped });
                }} />
              <span className="po-bulk-plan-avail">
                {havStr === '—' ? '—' : `/ ${havStr}`}
              </span>
              <button type="button" className="po-tier-row-del"
                aria-label={t('products.bulkTransfer.remove')} onClick={() => removeRow(sid)}>
                <Trash weight="bold" />
              </button>
            </div>
          );
        })}
      </div>

      {validRows.some(r => !r.isValid) && (
        <p className="po-bulk-plan-warning">
          {t('products.bulkTransfer.invalidRows')}
        </p>
      )}
    </>
  );
}

// ── Tri-state checkbox (none / some / all) ─────────────────────────────

function TriCheckbox({ state, onChange, disabled = false }) {
  const checked = state === 'all';
  const indet   = state === 'some';
  return (
    <input type="checkbox" className="cat-prod-checkbox po-include-cb"
      checked={checked}
      ref={el => { if (el) el.indeterminate = indet; }}
      disabled={disabled}
      onChange={e => onChange(e.target.checked)}
      onClick={e => e.stopPropagation()} />
  );
}
