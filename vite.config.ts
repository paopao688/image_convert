import { defineConfig, type Plugin } from 'vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))

// 让 dev server 以「同源」方式提供 /vendor/*（对应生产构建的 dist/vendor）。
// libarchive 的 classic Worker 不允许跨域，因此必须同源加载；这里直接从
// node_modules 读取，无需把文件复制进 public/。
function vendorDevPlugin(): Plugin {
  const files: Record<string, { rel: string; type: string }> = {
    '/vendor/libarchive/worker-bundle.js': {
      rel: 'libarchive.js/dist/worker-bundle.js',
      type: 'application/javascript'
    },
    '/vendor/libarchive/libarchive.wasm': {
      rel: 'libarchive.js/dist/libarchive.wasm',
      type: 'application/wasm'
    },
    '/vendor/pdfjs/pdf.worker.min.mjs': {
      rel: 'pdfjs-dist/build/pdf.worker.min.mjs',
      type: 'text/javascript'
    },
    // ffmpeg：worker/core 必须同源（Chromium 禁止跨域 Worker）。
    // worker.js 还相对导入 const.js / errors.js，需一并提供；wasm 仍走 CDN。
    '/vendor/ffmpeg/worker.js': {
      rel: '@ffmpeg/ffmpeg/dist/esm/worker.js',
      type: 'application/javascript'
    },
    '/vendor/ffmpeg/const.js': {
      rel: '@ffmpeg/ffmpeg/dist/esm/const.js',
      type: 'application/javascript'
    },
    '/vendor/ffmpeg/errors.js': {
      rel: '@ffmpeg/ffmpeg/dist/esm/errors.js',
      type: 'application/javascript'
    },
    '/vendor/ffmpeg/ffmpeg-core.js': {
      rel: '@ffmpeg/core/dist/esm/ffmpeg-core.js',
      type: 'application/javascript'
    }
  }
  return {
    name: 'serve-vendor-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        const hit = files[url]
        if (!hit) return next()
        const abs = path.resolve(root, 'node_modules', hit.rel)
        if (!fs.existsSync(abs)) {
          res.statusCode = 404
          res.end(`vendor asset not found: ${hit.rel}`)
          return
        }
        res.setHeader('Content-Type', hit.type)
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(abs).pipe(res)
      })
    }
  }
}

export default defineConfig({
  plugins: [vendorDevPlugin()],
  optimizeDeps: {
    exclude: ['@hushvert/engine']
  },
  // 引擎刻意使用单线程 ffmpeg，不需要 COOP/COEP；不设置以免阻碍跨域 CDN 资源
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
})
