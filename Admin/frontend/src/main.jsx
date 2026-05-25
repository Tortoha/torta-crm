import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './Style/index.css'
// Layout.css defines :root design tokens used by every page — eager-import
// so /login (outside the AdminLayout) also gets var(--bg) / var(--card) etc.
import './Style/Layout.css'
// Side-effects: install fetch wrapper + apply theme BEFORE first paint
// so there's no flash of light theme for dark-mode users.
import './api.js'
import './theme.js'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
