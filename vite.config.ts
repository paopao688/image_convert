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
    // 关键：禁用代码拆分
    rollupOptions: {
      output: {
        format: 'es',
        inlineDynamicImports: true
      }
    },
    // 增加 chunk 大小限制
    chunkSizeWarningLimit: 2000
  }
})