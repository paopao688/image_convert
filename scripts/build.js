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
  },
  // 确保 worker 文件被正确处理
  external: ['@hushvert/engine']
})

// 复制 index.html
fs.copyFileSync('index.html', 'dist/index.html')

console.log('✅ Build completed!')