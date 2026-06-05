// HTML email editor — a real code editor in place of the old block editor.
//
// • One convenient top line: Subject (pill) + variable-insert tabbar (mirrors
//   the Targets filter — sliding Dynamic Block indicator that follows hover) +
//   an optional action slot (Reset to default).
// • CodeMirror 6 (HTML highlight + tag autocomplete), themed to match the CRM
//   (Utils/codeMirrorTheme.js). Long lines scroll horizontally (CRM-styled
//   scrollbar) so it's clear a line continues.
// • Verification uses {{code}} like any other variable — no special tag.
// • Live preview below in a SANDBOXED iframe (sandbox="") so a merchant's HTML
//   can never touch the CRM, and email clients strip JS anyway.
// • Required tokens (e.g. {{code}} for verification) are validated — the parent
//   blocks Save via missingRequiredVars().
//
// Controlled: { emailType, subject, html, onChange({subject, html}), headerRight }.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CodeMirror from '@uiw/react-codemirror';
import { html as cmHtml, htmlLanguage } from '@codemirror/lang-html';
import { Warning, Images } from '@phosphor-icons/react';
import { crmCodeMirrorTheme } from '../../Utils/codeMirrorTheme.js';
import { TYPE_VARS, DEFAULT_HTML, missingRequiredVars, renderPreview } from '../../Utils/emailTemplateDefaults.js';
import MediaLibraryModal from './MediaLibraryModal.jsx';

const CM_SETUP = {
  lineNumbers: true, foldGutter: true, autocompletion: true,
  highlightActiveLine: true, highlightActiveLineGutter: true,
};

// {{variable}} autocomplete — pops as you type (like VS Code), not just after
// `<`. Fires on a `{{ … ` token, OR a bare word (≥3 chars) that prefixes a known
// variable (e.g. `cust` → {{customer_name}}). Works in text AND attribute values
// (e.g. href="{{reset_url}}").
function emailVarCompletions(vars) {
  const opts = (vars || []).map(v => ({ label: `{{${v}}}`, type: 'variable', detail: 'variable', apply: `{{${v}}}` }));
  return (context) => {
    const brace = context.matchBefore(/\{\{\s*\w*$/);
    if (brace) return { from: brace.from, options: opts, validFor: /^\{\{\s*\w*$/ };
    const word = context.matchBefore(/[A-Za-z_]{3,}$/);
    if (word) {
      const q = word.text.toLowerCase();
      const hits = opts.filter(o => {
        const name = o.label.slice(2, -2);
        return name.startsWith(q) || name.replace(/_/g, '').startsWith(q);
      });
      if (hits.length) return { from: word.from, options: hits };
    }
    return null;
  };
}

// Variable-insert tabbar — sliding accent indicator follows hover (mirrors the
// Targets/Organization SortToggle). No persistent active item: the indicator
// hides on mouse-leave.
function VarTabbar({ items, onInsert }) {
  const indRef = useRef(null);
  const btnRefs = useRef({});
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ind = indRef.current;
      const el  = hovered ? btnRefs.current[hovered] : null;
      if (!ind) return;
      if (!el) { ind.style.opacity = '0'; return; }
      ind.style.opacity   = '1';
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
      ind.style.width     = `${el.offsetWidth}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [hovered]);

  return (
    <div className="em-vtabs" onMouseLeave={() => setHovered(null)}>
      <div ref={indRef} className="em-vtabs-ind" />
      {items.map(v => (
        <button key={v} ref={el => { btnRefs.current[v] = el; }}
          className={`em-vtab${hovered === v ? ' em-vtab--current' : ''}`}
          onMouseEnter={() => setHovered(v)}
          onClick={() => onInsert(`{{${v}}}`)} type="button">
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  );
}

export default function HtmlEmailEditor({ emailType = '__broadcast', subject, html, onChange, headerRight = null, projectId }) {
  const { t } = useTranslation();
  const cmRef = useRef(null);
  const [mediaOpen, setMediaOpen] = useState(false);

  // Never an empty box — seed the default template for this type on first open
  // (broadcasts start blank; transactional types arrive pre-filled from the API).
  useEffect(() => {
    if (html == null || html.trim() === '') {
      onChange?.({ subject: subject || '', html: DEFAULT_HTML[emailType] || DEFAULT_HTML.__broadcast });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailType]);

  const vars    = TYPE_VARS[emailType] || TYPE_VARS.__broadcast;
  const missing = missingRequiredVars(emailType, html || '', subject || '');
  const preview = useMemo(() => renderPreview(emailType, html || ''), [emailType, html]);

  // HTML support + {{var}} autocomplete (per email type) + CRM theme.
  const cmExtensions = useMemo(
    () => [cmHtml(), htmlLanguage.data.of({ autocomplete: emailVarCompletions(vars) }), crmCodeMirrorTheme],
    [vars],
  );

  // Insert a token at the cursor (falls back to append if the view isn't ready).
  const insertToken = (token) => {
    const view = cmRef.current?.view;
    if (!view) { onChange?.({ subject, html: (html || '') + token }); return; }
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: token },
      selection: { anchor: sel.from + token.length },
    });
    view.focus();
  };

  return (
    <div className="em-html">
      <div className="em-html-bar">
        <input className="em-html-subject" value={subject || ''} placeholder={t('comms.emails.htmlSubject')}
          onChange={e => onChange?.({ subject: e.target.value, html })} />
        <VarTabbar items={vars} onInsert={insertToken} />
        {projectId && (
          <button type="button" className="em-html-media-btn" onClick={() => setMediaOpen(true)}
            title={t('comms.emails.media.title')}>
            <Images weight="bold" />
          </button>
        )}
        {headerRight}
      </div>
      {mediaOpen && <MediaLibraryModal projectId={projectId} onClose={() => setMediaOpen(false)} />}

      {missing.length > 0 && (
        <div className="em-html-warn">
          <Warning weight="fill" size={16} />
          {t('comms.emails.htmlRequired', { vars: missing.map(m => `{{${m}}}`).join(', ') })}
        </div>
      )}

      <div className="em-html-editor">
        <CodeMirror
          ref={cmRef}
          value={html || ''}
          height="360px"
          theme="none"
          basicSetup={CM_SETUP}
          extensions={cmExtensions}
          onChange={(val) => onChange?.({ subject, html: val })}
        />
      </div>

      <div className="em-html-preview">
        <iframe title="Email preview" sandbox="" srcDoc={preview} className="em-html-frame" />
      </div>
    </div>
  );
}
