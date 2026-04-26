import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './Style/index.css'
// Side-effect import: installs the auto-refresh fetch wrapper before any
// component code runs, so even the very first /api/me call benefits.
import './api.js'
import App from './App.jsx'

const rootElement = document.getElementById('root');
const reactRoot = createRoot(rootElement);

reactRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
