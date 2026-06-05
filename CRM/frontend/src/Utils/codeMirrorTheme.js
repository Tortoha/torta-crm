// Minimal CodeMirror 6 theme that matches the CRM design system.
//
// • Transparent surface — inherits the white card (or dark card) behind it, so
//   there is no second background fighting the page.
// • Chrome (gutter, line numbers, selection, cursor, active line) is driven by
//   the CRM CSS vars (`--accent`, `--accent-tint`, `--fg-rgb`) so it adapts to
//   light/dark automatically.
// • Syntax palette is deliberately calm: accent-blue tags, soft-violet attribute
//   names, and neutral-slate strings — so the long inline `style="…"` blobs in
//   email HTML recede instead of screaming colour (the old default theme looked
//   garish and off-brand).

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const MONO = "'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

const base = EditorView.theme(
  {
    '&': { color: 'var(--text)', backgroundColor: 'transparent', fontSize: '13px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: MONO, lineHeight: '1.7' },
    '.cm-content': { padding: '12px 0', caretColor: 'var(--accent)' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'rgba(var(--fg-rgb), 0.30)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px' },
    '.cm-foldGutter .cm-gutterElement': { color: 'rgba(var(--fg-rgb), 0.32)' },
    '.cm-activeLine': { backgroundColor: 'rgba(var(--fg-rgb), 0.025)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'rgba(var(--fg-rgb), 0.55)',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--accent-tint-hover) !important',
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--accent-tint)',
      color: 'inherit',
      outline: 'none',
    },
    '.cm-tooltip': {
      border: 'none',
      borderRadius: '12px',
      overflow: 'hidden',
      background: 'var(--card)',
      boxShadow: 'var(--box-shadow, 0 8px 28px rgba(0,0,0,0.12))',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      background: 'var(--accent-tint-hover)',
      color: 'var(--accent)',
    },
  },
  { dark: false }
);

const highlight = HighlightStyle.define([
  { tag: [t.angleBracket, t.bracket, t.punctuation, t.separator], color: 'rgba(var(--fg-rgb), 0.42)' },
  { tag: [t.tagName, t.heading], color: '#0071E3' },
  { tag: [t.attributeName, t.propertyName], color: '#7A6AD0' },
  { tag: [t.attributeValue, t.string], color: '#7B8496' },
  { tag: [t.number, t.bool, t.literal, t.atom], color: '#0071E3' },
  { tag: [t.keyword], color: '#0071E3' },
  { tag: [t.comment], color: 'rgba(var(--fg-rgb), 0.38)', fontStyle: 'italic' },
]);

export const crmCodeMirrorTheme = [base, syntaxHighlighting(highlight)];
