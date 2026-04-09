import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React core — отдельный chunk, кэшируется долго
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Иконки — самая тяжёлая зависимость
          'vendor-icons': ['@phosphor-icons/react'],
        },
      },
    },
    // Предупреждать если chunk > 400 kb
    chunkSizeWarningLimit: 400,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@phosphor-icons/react'],
  },
})
