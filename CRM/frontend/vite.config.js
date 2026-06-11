import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React core — separate, long-cache chunk.
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // NB: @phosphor-icons/react is deliberately NOT pinned to a manual chunk.
          // Pinning it (array OR function form) consolidates every used icon into one
          // eagerly-loaded chunk (~480 kB on first paint). Leaving it to Rollup's
          // default chunking lets route-exclusive icons ride along in their own lazy
          // route chunks, so only first-paint/shared icons stay eager — measured
          // ~252 kB (~51 kB gzip) smaller initial load.
        },
      },
    },
    // Предупреждать если chunk > 400 kb
    chunkSizeWarningLimit: 400,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
})
