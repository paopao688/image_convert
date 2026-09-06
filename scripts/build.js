import esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'

// 构建主应用
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  loader: {
    '.ts': 'ts'
  },
  define: {
    'process.env.NODE_ENV': '"production"'
  }
  // @hushvert/engine 及其依赖（@jsquash/*、libarchive.js、zip.js、utif2 等）
  // 一并打进 bundle.js：之前设为 external 导致产物残留浏览器无法解析的
  // 裸模块导入（`import ... from "@hushvert/engine"`），生产环境必然白屏。
})

// 复制 index.html，并把开发入口脚本引用（/src/main.ts）改写为打包产物 ./bundle.js。
// index.html 必须保留 /src/main.ts 供 Vite dev 使用，因此只在构建产物里替换。
const htmlPath = 'dist/index.html'
fs.copyFileSync('index.html', htmlPath)
let html = fs.readFileSync(htmlPath, 'utf8')
if (!html.includes('<script type="module" src="/src/main.ts"></script>')) {
  console.warn('⚠️ dist/index.html 中未找到 /src/main.ts 入口引用，未改写为 ./bundle.js')
} else {
  html = html.replace(
    '<script type="module" src="/src/main.ts"></script>',
    '<script type="module" src="./bundle.js"></script>',
  )
  fs.writeFileSync(htmlPath, html)
  console.log('✅ index.html 入口已指向 ./bundle.js')
}

console.log('✅ Build completed!')