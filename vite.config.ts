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
        assetFileNames: 'assets/[name]-[hash].[ext]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: 'entries/[name]-[hash].js'
      }
    }
  }
  // ❌ 移除 worker 配置
  // worker: {
  //   format: 'iife'
  // }
})