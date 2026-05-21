import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { UploadSimple, FileCsv, Check, Warning, X } from '@phosphor-icons/react';
import { API_BASE } from '../../../api.js';
import '../../../Style/Authentication.css';

// Two-step CSV import: parse client-side preview → dry-run server validation → commit.
// Expected columns (header row required): title, subtitle, description, product_type, category,
// variation_name, configuration_name, sku_code, sku_barcode, price, stock_quantity
const REQUIRED_HEADERS = ['title'];
const KNOWN_HEADERS = [
  'title', 'subtitle', 'description', 'product_type', 'category',
  'variation_name', 'configuration_name', 'sku_code', 'sku_barcode',
  'price', 'stock_quantity',
];

// Minimal RFC-4180 parser: quoted fields, escaped quotes (""), embedded newlines + commas in quotes. No external dep.
function parseCsv(text) {
  const rows = []; let cur = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"')        inQ = true;
      else if (c === ',')   { cur.push(field); field = ''; }
      else if (c === '\r')  { /* skip */ }
      else if (c === '\n')  { cur.push(field); field = ''; rows.push(cur); cur = []; }
      else                  field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(v => v && v.length));
}

export default function ImportCsvModal({ pq, onClose, onDone }) {
  const { t } = useTranslation();
  const { projectId } = useOutletContext();
  const [file,    setFile]    = useState(null);
  const [rows,    setRows]    = useState([]);
  const [headers, setHeaders] = useState([]);
  const [stage,   setStage]   = useState('pick'); // pick → preview → committing → done
  const [dryRes,  setDryRes]  = useState(null);
  const [err,     setErr]     = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [toast,   setToast]   = useState('');

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3200); };

  // Esc to close.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPickFile = async (f) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv' && f.type !== 'application/vnd.ms-excel') {
      setErr(t('products.import.errNotCsv')); return;
    }
    if (f.size > 5 * 1024 * 1024) { setErr(t('products.import.errTooLarge')); return; }
    setErr(''); setFile(f);
    try {
      const text = await f.text();
      const parsed = parseCsv(text);
      if (parsed.length < 2) { setErr(t('products.import.errNeedRows')); return; }
      const hdr = parsed[0].map(h => h.trim().toLowerCase());
      for (const r of REQUIRED_HEADERS) {
        if (!hdr.includes(r)) { setErr(t('products.import.errMissingColumn', { col: r })); return; }
      }
      setHeaders(hdr); setRows(parsed.slice(1)); setStage('preview');

      const objs = parsed.slice(1).map(r => {
        const o = {};
        hdr.forEach((h, i) => { if (KNOWN_HEADERS.includes(h)) o[h] = (r[i] ?? '').trim(); });
        if (o.price) o.price = parseFloat(o.price);
        if (o.stock_quantity) o.stock_quantity = parseInt(o.stock_quantity, 10);
        return o;
      });
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/products/import`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: objs, dry_run: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setErr(data?.detail || t('products.import.errDryRun')); return; }
      setDryRes(data);
    } catch (e) {
      setErr(t('products.import.errParse', { msg: String(e).slice(0, 200) }));
    }
  };

  const commit = async () => {
    setStage('committing'); setErr('');
    try {
      const objs = rows.map(r => {
        const o = {};
        headers.forEach((h, i) => { if (KNOWN_HEADERS.includes(h)) o[h] = (r[i] ?? '').trim(); });
        if (o.price) o.price = parseFloat(o.price);
        if (o.stock_quantity) o.stock_quantity = parseInt(o.stock_quantity, 10);
        return o;
      });
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/products/import`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: objs, dry_run: false }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.detail || t('products.import.errImport')); setStage('preview'); return;
      }
      setStage('done'); setDryRes(data);
      showToast(t('products.import.toastDone', { products: data.products_created, skus: data.skus_created + data.skus_updated }));
      onDone?.();
    } catch (e) {
      setErr(String(e).slice(0, 200)); setStage('preview');
    }
  };

  // Drag-and-drop on the dropzone — preventDefault on dragover required for drop to fire.
  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); };
  const onDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); };
  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onPickFile(f);
  };

  return createPortal(
    <div className="auth-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal cpm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="auth-modal-head">
          <div className="auth-modal-title-row">
            <div>
              <div className="auth-modal-title">{t('products.import.title')}</div>
              <div className="auth-modal-subtitle-row">
                <span className="auth-modal-subtitle">
                  {t('products.import.subtitle')}
                </span>
              </div>
            </div>
          </div>
          <button className="auth-modal-close" onClick={onClose} type="button">
            <X className="auth-modal-close-icon" />
          </button>
        </div>

        <div className="auth-modal-body">
          {stage === 'pick' && (
            <>
              <label
                className={`csv-dropzone${dragOver ? ' csv-dropzone--over' : ''}`}
                onDragOver={onDragOver} onDragEnter={onDragOver}
                onDragLeave={onDragLeave} onDrop={onDrop}>
                <FileCsv weight="duotone" className="csv-dropzone-icon" />
                <div className="csv-dropzone-title">
                  {dragOver ? t('products.import.dropNow') : t('products.import.dropHere')}
                </div>
                <div className="csv-dropzone-or">{t('products.import.or')}</div>
                <div className="csv-dropzone-pick">
                  <UploadSimple weight="bold" /> {t('products.import.chooseFile')}
                </div>
                <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
                  onChange={(e) => onPickFile(e.target.files?.[0])} />
                <div className="csv-dropzone-hint">{t('products.import.fileHint')}</div>
              </label>

              <div className="cpm-section">
                <label className="po-field-label">{t('products.import.expectedColumns')}</label>
                <div className="csv-cols">
                  {KNOWN_HEADERS.map(h => (
                    <span key={h} className={`csv-col-chip${REQUIRED_HEADERS.includes(h) ? ' csv-col-chip--req' : ''}`}>
                      {h}{REQUIRED_HEADERS.includes(h) ? ' *' : ''}
                    </span>
                  ))}
                </div>
                <span className="cpm-section-hint"
                  dangerouslySetInnerHTML={{ __html: t('products.import.columnsHint') }} />
              </div>
            </>
          )}

          {(stage === 'preview' || stage === 'committing') && (
            <>
              <div className="cpm-section csv-file-section">
                <div className="csv-file-row">
                  <FileCsv weight="duotone" className="csv-file-icon" />
                  <div style={{ flex: 1 }}>
                    <div className="csv-file-name">{file?.name}</div>
                    <div className="csv-file-meta">{t('products.import.rowsMeta', { rows: rows.length, size: (file?.size / 1024).toFixed(1) })}</div>
                  </div>
                  <button type="button" className="auth-btn-danger"
                    onClick={() => { setStage('pick'); setRows([]); setHeaders([]); setDryRes(null); setFile(null); }}>
                    {t('products.import.changeFile')}
                  </button>
                </div>

                {dryRes && (
                  <div className="csv-summary">
                    <span className="csv-summary-item">
                      <Check weight="bold" /> {t('products.import.newProducts')} <b>{dryRes.products_created}</b>
                    </span>
                    <span className="csv-summary-item">
                      <Check weight="bold" /> {t('products.import.newSkus')} <b>{dryRes.skus_created}</b>
                    </span>
                    {dryRes.errors?.length > 0 && (
                      <span className="csv-summary-item csv-summary-item--warn">
                        <Warning weight="bold" /> {t('products.import.errors')} <b>{dryRes.errors.length}</b>
                      </span>
                    )}
                  </div>
                )}

                {dryRes?.errors?.length > 0 && (
                  <details className="csv-errors-details">
                    <summary>{t('products.import.showErrors', { count: dryRes.errors.length })}</summary>
                    <ul>
                      {dryRes.errors.slice(0, 50).map((e, i) => (
                        <li key={i}>{t('products.import.rowError', { row: e.row, error: e.error })}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              <div className="cpm-section">
                <label className="po-field-label">{t('products.import.preview')}</label>
                <div className="csv-preview-wrap">
                  <table className="csv-preview-table">
                    <thead>
                      <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 10).map((r, i) => (
                        <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="auth-actions">
                <button className="crm-submit-btn" disabled={stage === 'committing'}
                  onClick={commit} type="button">
                  {stage === 'committing' ? t('products.import.importing') : t('products.import.importRows', { count: rows.length })}
                </button>
              </div>
            </>
          )}

          {stage === 'done' && (
            <div className="csv-done">
              <div className="csv-done-circle"><Check weight="bold" /></div>
              <div className="csv-done-title">{t('products.import.complete')}</div>
              <div className="csv-done-sub"
                dangerouslySetInnerHTML={{ __html: t('products.import.completeSub', { products: dryRes.products_created, skus: dryRes.skus_created + dryRes.skus_updated }) }} />
              <button className="crm-submit-btn" onClick={onClose} type="button">{t('products.import.close')}</button>
            </div>
          )}

          {err && <p className="auth-msg auth-msg--err">{err}</p>}
        </div>
      </div>

      {toast && createPortal(<div className="auth-toast">{toast}</div>, document.body)}
    </div>,
    document.body
  );
}
