import { useEffect, useRef, useState } from 'react';
import {
  TextT, TextAlignLeft, Image as ImageIcon, Minus, ArrowsOutLineVertical,
  Hash, Receipt, Paperclip, Trash, Eye, EyeSlash,
  DotsSixVertical, UploadSimple, PaintBucket,
} from '@phosphor-icons/react';
import { API_BASE, pickError } from '../../api.js';
import { DynamicBlock } from '../../Utils/DynamicBlock.js';
import { HexColorPicker, RgbaStringColorPicker } from 'react-colorful';

// Block palette — order shown in the bottom tools pill.
export const BLOCK_DEFS = {
  heading:       { label: 'Heading',       Icon: TextT,                  def: { text: 'Heading', align: 'left' } },
  text:          { label: 'Text',          Icon: TextAlignLeft,          def: { text: 'Write something for your customers…', align: 'left' } },
  button:        { label: 'Button',        Icon: UploadSimple,           def: { text: 'Click here', url: 'https://', align: 'center' } },
  image:         { label: 'Image',         Icon: ImageIcon,              def: { src: '', alt: '', align: 'center' } },
  divider:       { label: 'Divider',       Icon: Minus,                  def: {} },
  spacer:        { label: 'Spacer',        Icon: ArrowsOutLineVertical,  def: { height: 24 } },
  code:          { label: 'Code (OTP)',    Icon: Hash,                   def: {} },
  order_summary: { label: 'Order summary', Icon: Receipt,                def: {} },
  downloads:     { label: 'Downloads',     Icon: Paperclip,              def: {} },
};

const DYNAMIC_NOTE = {
  code: 'Renders the live verification code at send time.',
  order_summary: 'Renders the order items and total at send time.',
  downloads: 'Renders digital download links at send time (digital orders only).',
};

let _previewSeq = 0;

export default function EmailEditor({ projectId, previewType, subject, blocks, onChange, headerRight }) {
  // `background` is a non-rendered block holding the page background (colour / image); the rest is content.
  const bgBlock = blocks.find(b => b.type === 'background') || null;
  const content = blocks.filter(b => b.type !== 'background');

  const [sel, setSel] = useState(0);
  const [previewHtml, setPreviewHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const dragFrom = useRef(null);
  const fileInputRef = useRef(null);
  const bgFileRef = useRef(null);
  const pageFileRef = useRef(null);
  const [hoverLayer, setHoverLayer] = useState(null);
  const { indRef: layerInd, setItemRef: setLayerRef } = DynamicBlock(hoverLayer ?? sel, content.length);
  const toolIndRef = useRef(null);
  const toolRefs = useRef({});
  const [hovTool, setHovTool] = useState(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = toolIndRef.current;
      if (!ind) return;
      const el = hovTool != null ? toolRefs.current[hovTool] : null;
      if (!el) { ind.style.opacity = '0'; return; }
      ind.style.opacity = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [hovTool]);

  const commit = (newContent, newBg = bgBlock) =>
    onChange({ subject, blocks: newBg ? [...newContent, newBg] : newContent });
  const setSubject = (v) => onChange({ subject: v, blocks });

  // ── Live preview (server-rendered for fidelity), debounced ──
  useEffect(() => {
    const seq = ++_previewSeq;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/email-preview?project_id=${projectId}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: previewType || '', subject, blocks }),
        });
        const d = await r.json();
        if (seq === _previewSeq && r.ok) setPreviewHtml(d.html || '');
      } catch { /* preview is best-effort */ }
    }, 350);
    return () => clearTimeout(t);
  }, [projectId, previewType, subject, blocks]);

  // ── Block ops (content indices) ──
  const patchBlock = (idx, propsPatch) =>
    commit(content.map((b, i) => i === idx ? { ...b, props: { ...(b.props || {}), ...propsPatch } } : b));
  const addBlock = (type) => { commit([...content, { type, props: { ...(BLOCK_DEFS[type].def || {}) } }]); setSel(content.length); };
  const removeBlock = (idx) => {
    commit(content.filter((_, i) => i !== idx));
    setSel(s => (s === 'bg' ? s : Math.max(0, Math.min(typeof s === 'number' ? s : 0, content.length - 2))));
  };
  const move = (from, to) => {
    if (to < 0 || to >= content.length || from === to) return;
    const next = [...content];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    commit(next); setSel(to);
  };
  const setBg = (patch) => commit(content, { type: 'background', props: { ...((bgBlock || {}).props || {}), ...patch } });

  // ── Uploads (Ctrl+V / Drag-Drop / button) ──
  const uploadImage = async (file) => {
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch(`${API_BASE}/api/upload/image?project_id=${projectId}`, { method: 'POST', credentials: 'include', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(pickError(d));
    return d.url;
  };
  const uploadFile = async (file) => {
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch(`${API_BASE}/api/upload/file?project_id=${projectId}`, { method: 'POST', credentials: 'include', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(pickError(d));
    return { url: d.url, name: d.name || file.name };
  };

  const ingestImageFile = async (file) => {
    setBusy(true);
    try {
      const url = await uploadImage(file);
      const cur = sel !== 'bg' ? content[sel] : null;
      if (cur && cur.type === 'image') patchBlock(sel, { src: url });
      else { commit([...content, { type: 'image', props: { src: url, align: 'center' } }]); setSel(content.length); }
    } catch (e) { alert(String(e.message || e)); }
    finally { setBusy(false); }
  };
  const ingestPdfFile = async (file) => {
    setBusy(true);
    try {
      const { url, name } = await uploadFile(file);
      commit([...content, { type: 'button', props: { text: `Download ${name}`, url, align: 'center' } }]);
      setSel(content.length);
    } catch (e) { alert(String(e.message || e)); }
    finally { setBusy(false); }
  };
  const ingestBgImage = async (file) => {
    setBusy(true);
    try { const url = await uploadImage(file); setBg({ image: url }); }
    catch (e) { alert(String(e.message || e)); }
    finally { setBusy(false); }
  };
  const ingestPageImage = async (file) => {
    setBusy(true);
    try { const url = await uploadImage(file); setBg({ page_image: url }); }
    catch (e) { alert(String(e.message || e)); }
    finally { setBusy(false); }
  };
  const ingest = (file) => {
    if (!file) return;
    if (file.type && file.type.startsWith('image/')) ingestImageFile(file);
    else ingestPdfFile(file);
  };

  const onPaste = (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { e.preventDefault(); ingest(f); return; } }
    }
  };
  const onDrop = (e) => {
    if (e.dataTransfer?.files?.length) { e.preventDefault(); ingest(e.dataTransfer.files[0]); }
  };

  const selected = sel === 'bg' ? null : content[sel];

  return (
    <div className="em-editor" onPaste={onPaste} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} tabIndex={0}>
      <div className="em-subject-row">
        <input className="em-subject" placeholder="Subject line" value={subject || ''}
               onChange={(e) => setSubject(e.target.value)} />
        {headerRight && <div className="em-subject-actions">{headerRight}</div>}
      </div>

      <div className="em-body">
        <aside className="em-card em-layers">
          <div className="em-card-head">Layers</div>
          <div className="em-layer-list" onMouseLeave={() => setHoverLayer(null)}>
            <div ref={layerInd} className="em-layer-ind" />
            <div className={`em-layer em-layer--pinned${sel === 'bg' ? ' em-layer--sel' : ''}`}
                 ref={setLayerRef('bg')}
                 onMouseEnter={() => setHoverLayer('bg')}
                 onClick={() => setSel('bg')}>
              <PaintBucket className="em-layer-icon" />
              <span className="em-layer-label">Background</span>
            </div>
            {content.map((b, i) => {
              const D = BLOCK_DEFS[b.type] || { label: b.type, Icon: TextT };
              return (
                <div key={i}
                     ref={setLayerRef(i)}
                     className={`em-layer${i === sel ? ' em-layer--sel' : ''}${b.hidden ? ' em-layer--hidden' : ''}`}
                     draggable
                     onDragStart={() => { dragFrom.current = i; }}
                     onDragOver={(e) => e.preventDefault()}
                     onDrop={() => { if (dragFrom.current != null) move(dragFrom.current, i); dragFrom.current = null; }}
                     onMouseEnter={() => setHoverLayer(i)}
                     onClick={() => setSel(i)}>
                  <DotsSixVertical className="em-layer-grip" />
                  <D.Icon className="em-layer-icon" />
                  <span className="em-layer-label">{D.label}</span>
                  <button type="button" className="em-layer-act" title={b.hidden ? 'Show' : 'Hide'}
                          onClick={(e) => { e.stopPropagation(); commit(content.map((x, j) => j === i ? { ...x, hidden: !x.hidden } : x)); }}>
                    {b.hidden ? <EyeSlash /> : <Eye />}
                  </button>
                  <button type="button" className="em-layer-act em-layer-act--danger" title="Delete"
                          onClick={(e) => { e.stopPropagation(); removeBlock(i); }}>
                    <Trash />
                  </button>
                </div>
              );
            })}
            {content.length === 0 && <div className="em-empty">No blocks yet — add one below.</div>}
          </div>
        </aside>

        <main className="em-card em-canvas">
          {busy && <div className="em-uploading">Uploading…</div>}
          <div className="em-preview-wrap">
            <iframe title="preview" className="em-preview" srcDoc={previewHtml} />
          </div>
          <div className="em-canvas-hint">Paste an image (Ctrl+V) or drop an image / PDF anywhere here.</div>
        </main>

        <aside className="em-card em-inspector">
          {sel === 'bg'
            ? <BackgroundInspector props={(bgBlock || {}).props || {}}
                onField={(k, v) => setBg({ [k]: v })}
                onPickPanelImage={() => bgFileRef.current?.click()}
                onPickPageImage={() => pageFileRef.current?.click()}
                onClear={() => setBg({ color: '', image: '', radius: '', shadow: '', page_color: '', page_image: '' })} />
            : selected
              ? <Inspector block={selected} onField={(k, v) => patchBlock(sel, { [k]: v })}
                  onPickImage={() => fileInputRef.current?.click()} />
              : <div className="em-empty">Select a block to edit it.</div>}
        </aside>
      </div>

      <div className="em-tools" onMouseLeave={() => setHovTool(null)}>
        <div ref={toolIndRef} className="em-tool-ind" />
        {Object.entries(BLOCK_DEFS).map(([type, d]) => (
          <button key={type} ref={el => { toolRefs.current[type] = el; }} type="button" className="em-tool"
            title={`Add ${d.label}`} onMouseEnter={() => setHovTool(type)} onClick={() => addBlock(type)}>
            <d.Icon />
          </button>
        ))}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
             onChange={(e) => { const f = e.target.files?.[0]; if (f) ingestImageFile(f); e.target.value = ''; }} />
      <input ref={bgFileRef} type="file" accept="image/*" style={{ display: 'none' }}
             onChange={(e) => { const f = e.target.files?.[0]; if (f) ingestBgImage(f); e.target.value = ''; }} />
      <input ref={pageFileRef} type="file" accept="image/*" style={{ display: 'none' }}
             onChange={(e) => { const f = e.target.files?.[0]; if (f) ingestPageImage(f); e.target.value = ''; }} />
    </div>
  );
}

// ── Inspector: per-block fields + style controls ──

function Field({ label, children }) {
  return <label className="em-field"><span className="em-field-label">{label}</span>{children}</label>;
}

const ALIGN_OPTS = [{ value: 'left', label: 'left' }, { value: 'center', label: 'center' }, { value: 'right', label: 'right' }];
const SHADOW_OPTS = [{ value: 'none', label: 'None' }, { value: 'soft', label: 'Soft' }, { value: 'medium', label: 'Medium' }, { value: 'strong', label: 'Strong' }];
const COLOR_PRESETS = ['#000000', '#1d1d1f', '#5f6368', '#9aa0a6', '#ffffff', '#0071e3',
                       '#34c759', '#ff9500', '#ff3b30', '#af52de', '#bcdadc', '#f4f4f5'];

function Seg({ value, options, onChange }) {
  const indRef = useRef(null);
  const btnRefs = useRef({});
  const [hov, setHov] = useState(null);
  const cur = hov ?? value;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current, el = btnRefs.current[cur];
      if (!ind || !el) return;
      ind.style.opacity = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [cur, value]);
  return (
    <div className="em-seg em-seg--dyn" onMouseLeave={() => setHov(null)}>
      <div ref={indRef} className="em-seg-ind" />
      {options.map(o => (
        <button key={o.value} ref={el => { btnRefs.current[o.value] = el; }} type="button"
          className={`em-seg-btn${value === o.value ? ' em-on' : ''}`}
          onMouseEnter={() => setHov(o.value)} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function ColorField({ value, onChange, alpha }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const v = value || (alpha ? 'rgba(255,255,255,1)' : '#ffffff');
  const safe = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : '#ffffff';
  return (
    <div className="em-cf" ref={ref}>
      <button type="button" className="em-swatch" style={{ background: v }} title={v} onClick={() => setOpen(o => !o)} />
      {open && (
        <div className="em-color-pop">
          {alpha
            ? <RgbaStringColorPicker color={v} onChange={onChange} />
            : <HexColorPicker color={safe} onChange={onChange} />}
          <input className="crm-input em-color-hexin" value={value || ''} placeholder={alpha ? 'rgba(…)' : '#000000'} onChange={(e) => onChange(e.target.value)} />
          {!alpha && (
            <div className="em-color-chips">
              {COLOR_PRESETS.map(c => (
                <button key={c} type="button" className="em-color-chip" style={{ background: c }} title={c} onClick={() => onChange(c)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BackgroundInspector({ props, onField, onPickPanelImage, onPickPageImage, onClear }) {
  const p = props || {};
  return (
    <div className="em-inspector-in">
      <div className="em-insp-title">Background</div>
      <div className="em-insp-note">Style the email panel and the page behind it — each can have its own colour and image.</div>

      <div className="em-insp-sub">Email panel</div>
      <Field label="Colour"><ColorField alpha value={p.color || 'rgba(255,255,255,1)'} onChange={(v) => onField('color', v)} /></Field>
      <Field label={`Corners — ${p.radius ?? 16}px`}>
        <input type="range" className="em-range" min="0" max="48" value={p.radius ?? 16} onChange={(e) => onField('radius', Number(e.target.value))} />
      </Field>
      <Field label="Shadow"><Seg value={p.shadow || 'soft'} options={SHADOW_OPTS} onChange={(v) => onField('shadow', v)} /></Field>
      <Field label="Image">
        <button type="button" className="auth-btn-check em-upload-btn" onClick={onPickPanelImage}><UploadSimple /> Upload image</button>
      </Field>
      {p.image && <>
        <img src={p.image} alt="panel" className="em-logo-preview" />
        <button type="button" className="em-btn-ghost" onClick={() => onField('image', '')}>Remove panel image</button>
      </>}

      <div className="em-insp-sub">Page background</div>
      <Field label="Colour"><ColorField value={p.page_color || '#ffffff'} onChange={(v) => onField('page_color', v)} /></Field>
      <Field label="Image">
        <button type="button" className="auth-btn-check em-upload-btn" onClick={onPickPageImage}><UploadSimple /> Upload image</button>
      </Field>
      {p.page_image && <>
        <img src={p.page_image} alt="page" className="em-logo-preview" />
        <button type="button" className="em-btn-ghost" onClick={() => onField('page_image', '')}>Remove page image</button>
      </>}

      <button type="button" className="em-btn-ghost em-btn-danger em-bg-clear" onClick={onClear}><Trash /> Reset background</button>
    </div>
  );
}

function Inspector({ block, onField, onPickImage }) {
  const p = block.props || {};
  const t = block.type;
  const text  = (k, ph) => <input className="crm-input" value={p[k] ?? ''} placeholder={ph} onChange={(e) => onField(k, e.target.value)} />;
  const color = (k, fb) => <ColorField value={p[k] || fb} onChange={(v) => onField(k, v)} />;
  const num   = (k, ph) => <input className="crm-input" type="number" value={p[k] ?? ''} placeholder={ph} onChange={(e) => onField(k, e.target.value === '' ? '' : Number(e.target.value))} />;
  const align = () => <Seg value={p.align || 'left'} options={ALIGN_OPTS} onChange={(v) => onField('align', v)} />;

  return (
    <div className="em-inspector-in">
      <div className="em-insp-title">{BLOCK_DEFS[t]?.label || t}</div>
      {DYNAMIC_NOTE[t] && <div className="em-insp-note">{DYNAMIC_NOTE[t]}</div>}

      {(t === 'heading' || t === 'text') && <>
        <Field label="Text"><textarea className="crm-input em-textarea" value={p.text ?? ''} onChange={(e) => onField('text', e.target.value)} /></Field>
        <Field label="Alignment">{align()}</Field>
        <Field label="Text color">{color('color', '#1d1d1f')}</Field>
        <Field label="Font size (px)">{num('fontSize', t === 'heading' ? '24' : '15')}</Field>
      </>}

      {t === 'button' && <>
        <Field label="Label">{text('text', 'Click here')}</Field>
        <Field label="Link URL">{text('url', 'https://')}</Field>
        <Field label="Alignment">{align()}</Field>
        <Field label="Background">{color('bg', '#0071E3')}</Field>
        <Field label="Label color">{color('color', '#ffffff')}</Field>
        <Field label="Corner radius">{text('radius', '999px')}</Field>
        <Field label="Border">{text('border', 'none')}</Field>
        <Field label="Shadow">{text('shadow', 'none')}</Field>
      </>}

      {t === 'image' && <>
        <Field label="Image"><button type="button" className="auth-btn-check em-upload-btn" onClick={onPickImage}><UploadSimple /> Upload image</button></Field>
        <Field label="Image URL">{text('src', 'https://')}</Field>
        <Field label="Alt text">{text('alt', 'Description')}</Field>
        <Field label="Alignment">{align()}</Field>
        <Field label="Width (px)">{num('width', 'auto')}</Field>
        <Field label="Corner radius">{text('radius', '0')}</Field>
      </>}

      {t === 'code' && <>
        <Field label="Background">{color('bg', '#eaf3fd')}</Field>
        <Field label="Code color">{color('color', '#0071E3')}</Field>
        <Field label="Font size (px)">{num('fontSize', '34')}</Field>
      </>}

      {t === 'divider' && <Field label="Color">{color('color', '#e5e5e7')}</Field>}
      {t === 'spacer' && <Field label="Height (px)">{num('height', '24')}</Field>}
    </div>
  );
}
