import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@hushvert/engine']
  },
  // 新增：配置 worker 构建格式为 ES 模块
  worker: {
    format: 'es'
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
        // 保持输出为 ES 模块格式
        format: 'es',
        manualChunks: {
          'engine': ['@hushvert/engine']
        }
      }
    }
  }
})