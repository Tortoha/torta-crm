import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Admin panel runs on a separate port + subdomain (admin.tortacrm.com in prod,
// localhost:5175 in dev). Talks to the SAME CRM backend on :8001 — the admin
// endpoints live under /api/admin/* and are gated by require_admin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-icons': ['@phosphor-icons/react'],
        },
      },
    },
    chunkSizeWarningLimit: 400,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@phosphor-icons/react'],
  },
})
