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
        format: 'es',
        // 关键：允许 Worker 使用不同的输出格式
        assetFileNames: 'assets/[name]-[hash].[ext]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: 'entries/[name]-[hash].js'
      },
      // 为 Worker 单独配置
      plugins: [
        {
          name: 'worker-format-fix',
          resolveId(id) {
            if (id.includes('@hushvert/engine') && id.includes('worker')) {
              return id
            }
          },
          load(id) {
            if (id.includes('@hushvert/engine') && id.includes('worker')) {
              return null // 使用默认加载
            }
          }
        }
      ]
    }
  },
  worker: {
    format: 'iife' // 为 Worker 保留 IIFE 格式
  }
})