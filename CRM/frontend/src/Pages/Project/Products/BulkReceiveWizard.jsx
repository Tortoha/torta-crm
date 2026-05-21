// Bulk Receive Wizard — two-step modal: pick SKUs (with cascade), then plan
// warehouse + batch + qty + reason per SKU; applies as one transaction via
// /inventory/bulk-receive. This is where NEW batches are created — the Transfer
// wizard only moves stock between existing batches.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  X, CaretRight, CaretDown, Folder, Cube,
  Stack, ArrowRight, Trash,
} from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import { Combobox, DatePicker } from '../Booking/BookingCreateModal.jsx';
import '../../../Style/Booking.css';   // .bk-date-pop / calendar grid styles for DatePicker

// User's browser tz — DatePicker uses it to highlight "today" correctly.
const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Must match RECEIVE_REASONS in backend main.py.
const REASON_OPTIONS = [
  { value: 'supplier_delivery', labelKey: 'products.bulkReceive.reason.supplierDelivery' },
  { value: 'initial_inventory', labelKey: 'products.bulkReceive.reason.initialInventory' },
  { value: 'customer_return',   labelKey: 'products.bulkReceive.reason.customerReturn' },
  { value: 'production',        labelKey: 'products.bulkReceive.reason.production' },
  { value: 'recount_adjust',    labelKey: 'products.bulkReceive.reason.recountAdjust' },
  { value: 'transfer_in',       labelKey: 'products.bulkReceive.reason.transferIn' },
  { value: 'other',             labelKey: 'products.bulkReceive.reason.other' },
];

export function BulkReceiveButton({ onClick, disabled }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="org-new-btn"
      onClick={onClick} disabled={disabled}>
      <Stack weight="bold" className="org-new-icon" /> {t('products.bulkReceive.addStock')}
    </button>
  );
}

export default function BulkReceiveWizard({ projectId, onClose, onApplied, showToast }) {
  const { t } = useTranslation();
  const pq = `?project_id=${projectId}`;
  const [step, setStep] = useState(1);
  const [warehouses, setWarehouses] = useState([]);
  const [productList, setProductList] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [skuMeta, setSkuMeta] = useState({});           // sku_id → { label, breadcrumb }
  const [plan, setPlan] = useState({});                 // sku_id → row state
  const [busy, setBusy] = useState(false);
  const [batchNaming, setBatchNaming] = useState({ mode: 'auto', format: 'B-{YYYY}{MM}-{seq:03}' });
  // Grouping mode controls auto-name sharing + date auto-fill across rows in this receipt.
  // 'config' (default) → each row independent; 'product' → same parent product shares;
  // 'global' → everyone shares. Custom-named rows (batch_choice='manual') are exempt.
  const [groupingMode, setGroupingMode] = useState('config');
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
    fetch(`${API_BASE}/api/projects/${projectId}/batch-settings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setBatchNaming({
            mode:   d.batch_naming_mode   || 'auto',
            format: d.batch_naming_format || 'B-{YYYY}{MM}-{seq:03}',
          });
          setGroupingMode(d.batch_grouping_mode || 'config');
        }
      });
  }, [pq, projectId]);

  // Lazy-load existing batches at (sku, wh) so the merchant can ADD to one instead of creating new.
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

  const hydratePromises = useRef({});

  const hydrateProduct = useCallback((pid) => {
    if (expanded[pid]?.hydrated) return Promise.resolve(expanded[pid].data);
    if (hydratePromises.current[pid]) return hydratePromises.current[pid];

    setExpanded(prev => ({ ...prev, [pid]: { ...(prev[pid] || {}), loading: true } }));
    const promise = (async () => {
      const pd = await fetch(`${API_BASE}/api/products/${pid}${pq}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null);
      if (!pd) {
        setExpanded(prev => ({ ...prev, [pid]: { hydrated: false, loading: false } }));
        delete hydratePromises.current[pid];
        return null;
      }
      // Cache breadcrumb + label + product_id per SKU for step 2 (product_id is what
      // the 'product' grouping mode uses to decide which rows share dates/auto-name).
      setSkuMeta(prev => {
        const next = { ...prev };
        for (const v of (pd.variations || [])) {
          for (const c of (v.configurations || [])) {
            next[c.id] = {
              label:      `${v.variation_name} / ${c.configuration_name}`,
              breadcrumb: `${pd.title} / ${v.variation_name} / ${c.configuration_name}`,
              product_id: pd.id,
            };
          }
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

  // ── Selection helpers (same as Transfer wizard) ──────────────────────
  const toggleSku = (skuId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId); else next.add(skuId);
      return next;
    });
  };
  const skuIdsOfProduct   = (pd) => (pd?.variations || []).flatMap(v => (v.configurations || []).map(c => c.id));
  const skuIdsOfVariation = (v)  => (v.configurations || []).map(c => c.id);
  const setMany = (ids, on) => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });
  };
  const aggState = (ids) => {
    if (ids.length === 0) return 'none';
    const on = ids.filter(i => selected.has(i)).length;
    if (on === 0) return 'none';
    if (on === ids.length) return 'all';
    return 'some';
  };
  const productAggState   = (pd) => aggState(skuIdsOfProduct(pd));
  const variationAggState = (v)  => aggState(skuIdsOfVariation(v));

  const goToStep2 = () => {
    if (selected.size === 0) { showToast(t('products.bulkReceive.pickAtLeastOne')); return; }
    const defaultWh = warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id ?? '';
    const next = {};
    for (const sid of selected) {
      next[sid] = {
        warehouse: defaultWh,
        batch_choice: 'auto',        // 'auto' | 'manual' | 'existing:<id>'
        batch_custom: '',
        qty: '',
        reason: 'supplier_delivery',
        note: '',
        production_date: '',
        expiry_date:     '',
      };
    }
    setPlan(next);
    setStep(2);
  };

  // Auto-propagate a date field to other rows in the same group. The rules
  // mirror the backend's _group_key_for():
  //   global  → every other row
  //   product → rows whose SKU has the same parent product_id
  //   config  → no propagation (each row is its own group)
  // Skipped on rows where batch_choice !== 'auto' (custom name = explicit user intent).
  const propagateDate = (originSid, field, value) => {
    if (!value) return;
    if (groupingMode === 'config') return;
    const originMeta = skuMeta[originSid];
    const originPid  = originMeta?.product_id;
    setPlan(prev => {
      const out = { ...prev };
      for (const [sidStr, row] of Object.entries(out)) {
        const sid = Number(sidStr);
        if (sid === originSid) continue;
        if (row.batch_choice !== 'auto') continue;
        if (row[field]) continue;                 // don't clobber explicit values
        if (groupingMode === 'product') {
          const pid = skuMeta[sid]?.product_id;
          if (!pid || !originPid || pid !== originPid) continue;
        }
        out[sid] = { ...row, [field]: value };
      }
      return out;
    });
  };

  const updateRow = (sid, patch) => {
    setPlan(prev => ({ ...prev, [sid]: { ...prev[sid], ...patch } }));
  };
  const removeRow = (sid) => {
    setPlan(prev => { const out = { ...prev }; delete out[sid]; return out; });
    setSelected(prev => { const next = new Set(prev); next.delete(sid); return next; });
  };

  // ── Validation ───────────────────────────────────────────────────────
  const validRows = useMemo(() => {
    const rows = [];
    for (const [sidStr, p] of Object.entries(plan)) {
      const sid = Number(sidStr);
      const wh  = p.warehouse ? Number(p.warehouse) : null;
      const qty = parseInt(p.qty, 10);
      const choice = p.batch_choice || 'auto';
      const custom = (p.batch_custom || '').trim();
      let batchValid = true;
      if (choice === 'manual') batchValid = custom.length > 0;
      const isValid = (
        wh != null && !isNaN(qty) && qty > 0 && batchValid &&
        REASON_OPTIONS.some(o => o.value === p.reason)
      );
      rows.push({
        sid, wh, qty, isValid, choice, custom,
        reason: p.reason, note: p.note,
        production_date: p.production_date || '',
        expiry_date:     p.expiry_date     || '',
      });
    }
    return rows;
  }, [plan]);

  const allValid = validRows.length > 0 && validRows.every(r => r.isValid);

  const apply = async () => {
    if (!allValid) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/projects/${projectId}/inventory/bulk-receive`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: validRows.map(r => {
            const out = {
              sku_id:       r.sid,
              warehouse_id: r.wh,
              quantity:     r.qty,
              batch_choice: r.choice.startsWith('existing:') ? 'existing' : r.choice,
              reason:       r.reason,
              note:         (r.note || '').trim() || null,
              production_date: r.production_date || null,
              expiry_date:     r.expiry_date     || null,
            };
            if (r.choice.startsWith('existing:')) out.target_batch_id = Number(r.choice.slice(9));
            else if (r.choice === 'manual')      out.batch_name = r.custom;
            return out;
          }),
        }),
      });
      if (r.ok) {
        const j = await r.json();
        showToast(t('products.bulkReceive.toastReceived', { units: j.total_units, created: j.batches_created, updated: j.batches_updated }));
        onApplied?.();
      } else {
        const j = await r.json().catch(() => ({}));
        showToast(j.detail || t('products.bulkReceive.receiveFailed'));
      }
    } finally { setBusy(false); }
  };

  // ── Render ───────────────────────────────────────────────────────────
  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className={`auth-modal cpm-modal po-bulk-wizard${step === 1 ? ' po-bulk-wizard--narrow' : ' po-bulk-wizard--receive'}`}
        onClick={e => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">
                {step === 1 ? t('products.bulkReceive.pickStepTitle') : t('products.bulkReceive.planStepTitle')}
              </div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {t('products.bulkReceive.stepProgress', { step, count: selected.size })}
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
              updateRow={updateRow}
              removeRow={removeRow}
              batchNaming={batchNaming}
              groupingMode={groupingMode}
              propagateDate={propagateDate}
              batchOptionsBySkuWh={batchOptionsBySkuWh}
              loadBatchesFor={loadBatchesFor}
            />
          )}

          <div className="auth-actions po-bulk-wizard-actions">
            {step === 1 ? (
              <>
                <button type="button" className="crm-submit-btn"
                  disabled={selected.size === 0} onClick={goToStep2}>
                  {t('products.bulkReceive.next')} <ArrowRight weight="bold" />
                </button>
                <button type="button" className="crm-submit-btn auth-btn-secondary po-disc-cancel-btn"
                  onClick={onClose}>{t('products.bulkReceive.cancel')}</button>
              </>
            ) : (
              <>
                <button type="button" className="crm-submit-btn auth-btn-secondary"
                  onClick={() => setStep(1)} disabled={busy}>{t('products.bulkReceive.back')}</button>
                <button type="button" className="crm-submit-btn"
                  disabled={!allValid || busy} onClick={apply}>
                  {busy ? t('products.bulkReceive.receiving') : t('products.bulkReceive.receiveRows', { count: validRows.length })}
                </button>
                <button type="button" className="crm-submit-btn auth-btn-secondary po-disc-cancel-btn"
                  onClick={onClose} disabled={busy}>{t('products.bulkReceive.cancel')}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Step 1: Tree with cascading checkboxes (same as Transfer wizard) ─────

function Step1Tree({ productList, expanded, hydrate, selected, toggleSku, setMany,
                      productAggState, variationAggState,
                      skuIdsOfProduct, skuIdsOfVariation }) {
  const { t } = useTranslation();
  const [openProducts, setOpenProducts] = useState(new Set());
  const [openVars, setOpenVars] = useState(new Set());
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
    setOpenVars(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  };
  const onProductCheck = async (p, checked) => {
    let pd = expanded[p.id]?.data;
    if (!pd) {
      setBusyPid(prev => { const n = new Set(prev); n.add(p.id); return n; });
      try { pd = await hydrate(p.id); }
      finally { setBusyPid(prev => { const n = new Set(prev); n.delete(p.id); return n; }); }
    }
    if (!pd) return;
    setMany(skuIdsOfProduct(pd), checked);
    if (checked) setOpenProducts(prev => { const n = new Set(prev); n.add(p.id); return n; });
  };

  if (productList.length === 0) {
    return <p className="crm-placeholder">{t('products.bulkReceive.noProducts')}</p>;
  }

  return (
    <div className="po-bulk-tree">
      {productList.map(p => {
        const pdState = expanded[p.id];
        const pd = pdState?.data;
        const isOpen = openProducts.has(p.id);
        const state  = pd ? productAggState(pd) : 'none';
        const isBusy = busyPid.has(p.id);
        return (
          <div key={p.id} className="po-bulk-tree-node">
            <div className="po-bulk-tree-row">
              <button type="button" className="po-tree-chevron"
                onClick={() => togglePid(p.id)}>
                {isOpen ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}
              </button>
              <TriCheckbox state={state} disabled={isBusy}
                onChange={(checked) => onProductCheck(p, checked)} />
              <Folder weight="duotone" className="po-disc-cell--strong" />
              <span className="po-set-strong">{p.title}</span>
              <span className="po-set-note po-tree-meta">
                · {p.variations_count === 1 ? t('products.bulkReceive.variationOne', { count: p.variations_count }) : t('products.bulkReceive.variationMany', { count: p.variations_count || 0 })}
                {isBusy && <span className="po-bulk-tree-loading-inline"> · {t('products.bulkReceive.loadingInline')}</span>}
              </span>
            </div>
            {isOpen && !pdState?.hydrated && (
              <div className="po-bulk-tree-loading">{t('products.bulkReceive.loading')}</div>
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
                      · {(v.configurations || []).length === 1 ? t('products.bulkReceive.skuOne', { count: (v.configurations || []).length }) : t('products.bulkReceive.skuMany', { count: (v.configurations || []).length })}
                    </span>
                  </div>
                  {vOpen && (v.configurations || []).map(c => (
                    <div key={c.id} className="po-bulk-tree-row po-bulk-tree-row--depth-2">
                      <span className="po-tree-chevron-spacer" />
                      <TriCheckbox state={selected.has(c.id) ? 'all' : 'none'}
                        onChange={() => toggleSku(c.id)} />
                      <Cube className="po-disc-cell--muted" />
                      <span>{c.configuration_name || c.name || '—'}</span>
                      <span className="po-set-note po-tree-meta">
                        · {t('products.bulkReceive.stock', { count: c.stock_quantity ?? 0 })}
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

// ── Step 2: per-SKU receive planner ──────────────────────────────────────

function Step2Plan({ warehouses, skuMeta, plan, validRows,
                     updateRow, removeRow, batchNaming, groupingMode, propagateDate,
                     batchOptionsBySkuWh, loadBatchesFor }) {
  const { t } = useTranslation();
  const planEntries = Object.entries(plan);
  if (planEntries.length === 0) {
    return <p className="crm-placeholder">{t('products.bulkReceive.nothingSelected')}</p>;
  }

  const groupingLabel = {
    config:  t('products.bulkReceive.groupConfig'),
    product: t('products.bulkReceive.groupProduct'),
    global:  t('products.bulkReceive.groupGlobal'),
  }[groupingMode] || '';

  return (
    <>
      <p className="po-bulk-plan-hint">
        <span dangerouslySetInnerHTML={{ __html: t('products.bulkReceive.planHint') }} />
        <br />
        <span className="po-bulk-plan-hint-grouping">{t('products.bulkReceive.grouping')} <b>{groupingLabel}</b></span>
      </p>

      <div className="po-bulk-plan-table po-bulk-plan-table--receive">
        <div className="po-bulk-plan-row po-bulk-plan-row--head po-bulk-plan-row--receive">
          <span>{t('products.bulkReceive.colSku')}</span>
          <span>{t('products.bulkReceive.colWarehouse')}</span>
          <span>{t('products.bulkReceive.colBatch')}</span>
          <span>{t('products.bulkReceive.colUnitsAdded')}</span>
          <span>{t('products.bulkReceive.colProduction')}</span>
          <span>{t('products.bulkReceive.colExpiry')}</span>
          <span>{t('products.bulkReceive.colReason')}</span>
          <span>{t('products.bulkReceive.colNote')}</span>
          <span></span>
        </div>
        {planEntries.map(([sidStr, p]) => {
          const sid = Number(sidStr);
          const meta = skuMeta[sid];
          const validRow = validRows.find(r => r.sid === sid);
          const whNum = p.warehouse === '' ? null : Number(p.warehouse);
          const batchOpts = whNum != null ? (batchOptionsBySkuWh[`${sid}:${whNum}`] || []) : [];
          const batchSelectOptions = [
            { value: 'auto',   label: batchNaming.mode === 'auto'
                ? t('products.bulkReceive.batchAutoFormat', { format: batchNaming.format })
                : t('products.bulkReceive.batchAuto') },
            { value: 'manual', label: t('products.bulkReceive.batchManual') },
            ...batchOpts.map(b => ({
              value: `existing:${b.id}`,
              label: t('products.bulkReceive.batchAddTo', { name: b.batch_name, count: b.quantity_remaining }),
            })),
          ];

          return (
            <div key={sid}
              className={`po-bulk-plan-row po-bulk-plan-row--receive${validRow?.isValid === false ? ' po-bulk-plan-row--invalid' : ''}`}>
              <span className="po-bulk-plan-sku">
                <span className="po-set-strong">{meta?.label || `#${sid}`}</span>
                <span className="po-set-note po-bulk-plan-bc">{meta?.breadcrumb}</span>
              </span>
              <span className="po-cb-wrap">
                <Combobox value={p.warehouse === '' ? '' : Number(p.warehouse)}
                  placeholder={t('products.bulkReceive.warehouse')}
                  options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                  onChange={(v) => {
                    const next = v === '' ? '' : Number(v);
                    updateRow(sid, { warehouse: next });
                    if (next) loadBatchesFor?.(sid, next);
                  }} />
              </span>
              <span className="po-bulk-plan-batch-cell">
                <Combobox value={p.batch_choice}
                  options={batchSelectOptions}
                  placeholder={t('products.bulkReceive.batch')}
                  onChange={(v) => updateRow(sid, { batch_choice: v })} />
                {p.batch_choice === 'manual' && (
                  <input className="crm-input crm-input--sm po-bulk-plan-batch-input"
                    placeholder={t('products.bulkReceive.batchNamePlaceholder')}
                    value={p.batch_custom || ''}
                    onChange={(e) => updateRow(sid, { batch_custom: e.target.value })}
                    maxLength={80} />
                )}
              </span>
              <input type="number" min="1" step="1"
                className="crm-input po-bulk-plan-qty"
                placeholder="0" value={p.qty}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') { updateRow(sid, { qty: '' }); return; }
                  const n = parseInt(raw, 10);
                  // Negatives are not allowed here — that's the Edit stock flow.
                  if (isNaN(n) || n < 0) return;
                  updateRow(sid, { qty: n });
                }} />
              {/* Production date — auto-propagates within the same group when set */}
              <div className="po-bulk-plan-date">
                <DatePicker value={p.production_date || ''} tz={USER_TZ}
                  onChange={(v) => {
                    updateRow(sid, { production_date: v });
                    propagateDate(sid, 'production_date', v);
                  }} />
              </div>
              {/* Expiry date — same auto-propagation rules */}
              <div className="po-bulk-plan-date">
                <DatePicker value={p.expiry_date || ''} tz={USER_TZ}
                  onChange={(v) => {
                    updateRow(sid, { expiry_date: v });
                    propagateDate(sid, 'expiry_date', v);
                  }} />
              </div>
              <span className="po-cb-wrap">
                <Combobox value={p.reason} placeholder={t('products.bulkReceive.reasonLabel')}
                  options={REASON_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
                  onChange={(v) => updateRow(sid, { reason: v })} />
              </span>
              <input type="text" className="crm-input po-bulk-plan-note"
                placeholder={t('products.bulkReceive.notePlaceholder')}
                value={p.note || ''}
                onChange={(e) => updateRow(sid, { note: e.target.value })}
                maxLength={500} />
              <button type="button" className="po-tier-row-del"
                aria-label={t('products.bulkReceive.remove')} onClick={() => removeRow(sid)}>
                <Trash weight="bold" />
              </button>
            </div>
          );
        })}
      </div>

      {validRows.some(r => !r.isValid) && (
        <p className="po-bulk-plan-warning">
          {t('products.bulkReceive.invalidRows')}
        </p>
      )}
    </>
  );
}

// ── Tri-state checkbox ─────────────────────────────────────────────────

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
