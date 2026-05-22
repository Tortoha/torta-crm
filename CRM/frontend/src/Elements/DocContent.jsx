import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Every doc page is bundled at build time as a raw string. Keys look like
// '../docs/en/quickstart.md'. No runtime fetch — content ships with the app.
const FILES = import.meta.glob('../docs/**/*.md', { query: '?raw', import: 'default', eager: true });

function pickDoc(section, lang) {
  return FILES[`../docs/${lang}/${section}.md`]
      || FILES[`../docs/en/${section}.md`]   // fall back to English
      || null;
}

// Fenced code block with a copy button (react-markdown v9 wraps block code in <pre><code>).
function Pre({ children }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const codeEl = Array.isArray(children) ? children[0] : children;
  const raw = codeEl?.props?.children;
  const text = Array.isArray(raw) ? raw.join('') : String(raw ?? '');
  const copy = () => {
    navigator.clipboard.writeText(text.replace(/\n$/, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="doc-code">
      <button type="button" className="doc-code-copy" onClick={copy}>
        {copied ? t('docs.copied') : t('docs.copy')}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

// Internal links navigate within the SPA; external links open in a new tab.
function Anchor({ href, children }) {
  const navigate = useNavigate();
  if (href && href.startsWith('/')) {
    return <a href={href} onClick={(e) => { e.preventDefault(); navigate(href); }}>{children}</a>;
  }
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

export default function DocContent({ section }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en').slice(0, 2);
  const md = pickDoc(section, lang);
  if (!md) return <div className="doc-empty">{t('docs.notFound')}</div>;
  return (
    <article className="doc-article">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: Pre, a: Anchor }}>
        {md}
      </ReactMarkdown>
    </article>
  );
}
