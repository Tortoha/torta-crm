import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './Style/index.css'
// Side-effect import: installs the auto-refresh fetch wrapper before any
// component code runs, so even the very first /api/me call benefits.
import './api.js'
import { i18nReady } from './i18n'
import './theme'
import App from './App.jsx'

const rootElement = document.getElementById('root');
const reactRoot = createRoot(rootElement);

// Defer first paint until the active language's translations are loaded (one
// small JSON fetch, lazy — not the old ~2.5 MB all-languages bundle), so the
// UI never flashes raw i18n keys. Render even if the locale fetch fails — raw
// keys are an acceptable degradation, a blank screen is not.
const start = () => reactRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
i18nReady.then(start, start);
