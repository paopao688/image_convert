import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@hushvert/engine']
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          'engine': ['@hushvert/engine']
        }
      }
    }
  }
})