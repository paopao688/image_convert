// scripts/copy-vendor.js
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dist = path.resolve(root, 'dist')
const vendorDir = path.resolve(dist, 'vendor')

// 清理旧 vendor
if (fs.existsSync(vendorDir)) {
  fs.rmSync(vendorDir, { recursive: true, force: true })
}
fs.mkdirSync(vendorDir, { recursive: true })

// 从 node_modules 复制
function copyModule(src, dest) {
  const fullSrc = path.resolve(root, 'node_modules', src)
  const fullDest = path.resolve(vendorDir, dest)
  const destDir = path.dirname(fullDest)
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
  if (fs.existsSync(fullSrc)) {
    fs.cpSync(fullSrc, fullDest, { recursive: true, force: true })
    console.log(`✅ 复制: ${src} → ${path.relative(root, fullDest)}`)
  } else {
    console.warn(`⚠️ 未找到: ${src}`)
  }
}

// FFmpeg
copyModule('@ffmpeg/core/dist/esm/ffmpeg-core.js', 'ffmpeg/ffmpeg-core.js')
// ❌ 注释掉 wasm，从 CDN 加载
// copyModule('@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'ffmpeg/ffmpeg-core.wasm')
copyModule('@ffmpeg/ffmpeg/dist/esm/worker.js', 'ffmpeg/worker.js')

// libarchive
copyModule('libarchive.js/dist/worker-bundle.js', 'libarchive/worker-bundle.js')
copyModule('libarchive.js/dist/libarchive.wasm', 'libarchive/libarchive.wasm')

// PDF.js
copyModule('pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs')

console.log('✅ Vendor 资源复制完成')