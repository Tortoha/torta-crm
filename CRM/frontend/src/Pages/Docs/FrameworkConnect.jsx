import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchableCombobox } from '../Project/ProjectSettings.jsx';

// torta-js is plain JavaScript, so the "connect" step is the same idea everywhere:
// create one client in a shared module and import it. Only the file convention,
// the env mechanism, and the SSR note differ per framework — that's what the
// picker below swaps. Order mirrors the framework list shown on the marketing site.
const FRAMEWORKS = [
  {
    value: 'nextjs', label: 'Next.js',
    code: `// lib/torta.js
import { createClient } from 'torta-js';

export const client = createClient(
  process.env.NEXT_PUBLIC_TORTA_URL,  // https://api.example.com/PUBLIC_KEY
  process.env.NEXT_PUBLIC_TORTA_PK,   // pk_…
);`,
    note: {
      en: `Use it from Client Components ("use client") — login and cart rely on the browser session cookie. Public data (products, categories) can also be read in Server Components. The secret key (sk_) belongs only in Route Handlers / Server Actions — never NEXT_PUBLIC_.`,
      ru: `Используйте в Client Components ("use client") — вход и корзина зависят от cookie сессии в браузере. Публичные данные (товары, категории) можно читать и в Server Components. Секретный ключ (sk_) — только в Route Handlers / Server Actions, никогда не NEXT_PUBLIC_.`,
    },
  },
  {
    value: 'remix', label: 'Remix',
    code: `// app/lib/torta.js
import { createClient } from 'torta-js';

export const client = createClient(
  'https://api.example.com/PUBLIC_KEY',
  'pk_…',
);`,
    note: {
      en: `Call it from the browser (components / useEffect), not from loaders — auth uses the session cookie. To avoid literals, expose the values through your root loader and read them on the client.`,
      ru: `Вызывайте из браузера (компоненты / useEffect), а не из loaders — авторизация использует cookie сессии. Чтобы не хардкодить значения, отдавайте их через root loader и читайте на клиенте.`,
    },
  },
  {
    value: 'react', label: 'React',
    code: `// src/lib/torta.js
import { createClient } from 'torta-js';

export const client = createClient(
  import.meta.env.VITE_TORTA_URL,   // https://api.example.com/PUBLIC_KEY
  import.meta.env.VITE_TORTA_PK,    // pk_…
);`,
    note: {
      en: `Import { client } from "./lib/torta" in any component. Browser code only ever gets the public + publishable keys — keep the secret key (sk_) on your server.`,
      ru: `Импортируйте { client } из "./lib/torta" в любом компоненте. Браузерный код получает только публичный и publishable-ключи — секретный ключ (sk_) держите на сервере.`,
    },
  },
  {
    value: 'nuxt', label: 'Nuxt',
    code: `// plugins/torta.client.js   (.client = browser only)
import { createClient } from 'torta-js';

export default defineNuxtPlugin(() => {
  const cfg = useRuntimeConfig().public;
  const client = createClient(cfg.tortaUrl, cfg.tortaPk);
  return { provide: { torta: client } };
});`,
    note: {
      en: `Access it as const { $torta } = useNuxtApp(). The .client suffix keeps the client browser-side, which is required for cookie-based auth.`,
      ru: `Получайте его как const { $torta } = useNuxtApp(). Суффикс .client держит клиент на стороне браузера, что нужно для авторизации на cookie.`,
    },
  },
  {
    value: 'vue', label: 'Vue.js',
    code: `// src/torta.js
import { createClient } from 'torta-js';

export const client = createClient(
  import.meta.env.VITE_TORTA_URL,
  import.meta.env.VITE_TORTA_PK,
);`,
    note: {
      en: `Import { client } anywhere, or register it once with app.provide("torta", client) and pull it in with inject("torta").`,
      ru: `Импортируйте { client } где угодно или зарегистрируйте один раз через app.provide("torta", client) и получайте через inject("torta").`,
    },
  },
  {
    value: 'sveltekit', label: 'SvelteKit',
    code: `// src/lib/torta.js
import { createClient } from 'torta-js';
import { PUBLIC_TORTA_URL, PUBLIC_TORTA_PK } from '$env/static/public';

export const client = createClient(PUBLIC_TORTA_URL, PUBLIC_TORTA_PK);`,
    note: {
      en: `Use it in components / onMount — sessions are stored in the browser cookie. PUBLIC_-prefixed env vars are exposed to the client by design, which is exactly what the public + publishable keys need.`,
      ru: `Используйте в компонентах / onMount — сессии хранятся в cookie браузера. Переменные с префиксом PUBLIC_ по задумке доступны клиенту, что как раз и нужно публичному и publishable-ключам.`,
    },
  },
  {
    value: 'solid', label: 'Solid.js',
    code: `// src/torta.js
import { createClient } from 'torta-js';

export const client = createClient(
  import.meta.env.VITE_TORTA_URL,
  import.meta.env.VITE_TORTA_PK,
);`,
    note: {
      en: `Import { client } in any component or inside a createResource fetcher.`,
      ru: `Импортируйте { client } в любом компоненте или внутри fetcher'а createResource.`,
    },
  },
  {
    value: 'astro', label: 'Astro',
    code: `---
// any .astro page — the <script> below runs in the browser
---
<script>
  import { createClient } from 'https://cdn.jsdelivr.net/npm/torta-js/+esm';

  const client = createClient('https://api.example.com/PUBLIC_KEY', 'pk_…');
  // …use client inside client-side scripts or framework islands
</script>`,
    note: {
      en: `Astro is static-first, so call the SDK from a client <script> or a hydrated island — not from the frontmatter (which runs at build time). npm install also works if you prefer a bundled import (import.meta.env.PUBLIC_*).`,
      ru: `Astro в первую очередь статичен, поэтому вызывайте SDK из клиентского <script> или гидратированного острова — не из frontmatter (он выполняется на сборке). npm install тоже работает, если предпочитаете бандл-импорт (import.meta.env.PUBLIC_*).`,
    },
  },
  {
    value: 'refine', label: 'Refine',
    code: `// src/torta.js
import { createClient } from 'torta-js';

export const client = createClient(
  import.meta.env.VITE_TORTA_URL,
  import.meta.env.VITE_TORTA_PK,
);`,
    note: {
      en: `torta-js is not a Refine dataProvider. Use client directly inside components and hooks, or wrap it in a thin custom dataProvider if you want Refine's useList / useOne to drive it.`,
      ru: `torta-js не является dataProvider'ом Refine. Используйте client напрямую в компонентах и хуках или оберните его в тонкий кастомный dataProvider, если хотите, чтобы им управляли useList / useOne из Refine.`,
    },
  },
  {
    value: 'tanstack-start', label: 'TanStack Start',
    code: `// app/torta.ts
import { createClient } from 'torta-js';

export const client = createClient(
  import.meta.env.VITE_TORTA_URL,
  import.meta.env.VITE_TORTA_PK,
);`,
    note: {
      en: `Use it in components — sessions are browser-cookie based. Server functions can read public data, but keep the secret key (sk_) server-only.`,
      ru: `Используйте в компонентах — сессии на cookie браузера. Серверные функции могут читать публичные данные, но секретный ключ (sk_) держите только на сервере.`,
    },
  },
];

const INSTALL = `npm install torta-js`;

const USAGE = `import { client } from './torta';

const { ok, data, error } = await client.products.list();
if (!ok) console.error(error);
else      render(data);`;

const FW_KEY = 'torta_docs_framework';

function CopyBlock({ code }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="doc-code">
      <button type="button" className="doc-code-copy" onClick={copy}>
        {copied ? t('docs.copied') : t('docs.copy')}
      </button>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export default function FrameworkConnect() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en').slice(0, 2);
  const [fw, setFw] = useState(() => {
    try { return localStorage.getItem(FW_KEY) || 'nextjs'; } catch { return 'nextjs'; }
  });
  const pick = (v) => {
    setFw(v);
    try { localStorage.setItem(FW_KEY, v); } catch { /* private mode */ }
  };
  const current = FRAMEWORKS.find(f => f.value === fw) || FRAMEWORKS[0];
  const note = current.note[lang] || current.note.en;

  return (
    <article className="doc-article">
      <h1>{t('docs.frameworks.title')}</h1>
      <p>{t('docs.frameworks.intro')}</p>

      <div className="doc-fw-picker">
        <SearchableCombobox
          value={fw}
          options={FRAMEWORKS.map(f => ({ value: f.value, label: f.label }))}
          onChange={pick}
          placeholder={t('docs.frameworks.pick')}
          searchPlaceholder={t('common.search')}
        />
      </div>

      <h2>{t('docs.frameworks.install')}</h2>
      <CopyBlock code={INSTALL} />
      <p>{t('docs.frameworks.cdnNote')}</p>

      <h2>{t('docs.frameworks.create', { fw: current.label })}</h2>
      <CopyBlock code={current.code} />
      <blockquote><p>{note}</p></blockquote>

      <h2>{t('docs.frameworks.use')}</h2>
      <CopyBlock code={USAGE} />
      <p>
        {t('docs.frameworks.next')}{' '}
        <a href="/docs/concepts">{t('docs.pages.concepts')}</a>.
      </p>
    </article>
  );
}
