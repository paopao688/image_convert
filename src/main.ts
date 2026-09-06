import { configureEngine, convertFile } from '@hushvert/engine'

// 配置引擎（图片格式无需配置，只有音视频/归档/PDF需要）
configureEngine({
  ffmpeg: {
    coreUrl: '/vendor/ffmpeg/ffmpeg-core.js',
    wasmUrl: '/vendor/ffmpeg/ffmpeg-core.wasm',
    classWorkerUrl: '/vendor/ffmpeg/worker.js',
  },
  libarchiveWorkerUrl: '/vendor/libarchive/worker-bundle.js',
  pdfjsWorkerUrl: '/vendor/pdfjs/pdf.worker.min.mjs',
})

// DOM 元素
const fileInput = document.getElementById('fileInput') as HTMLInputElement
const fromFormat = document.getElementById('fromFormat') as HTMLSelectElement
const toFormat = document.getElementById('toFormat') as HTMLSelectElement
const convertBtn = document.getElementById('convertBtn') as HTMLButtonElement
const progressBar = document.getElementById('progressBar') as HTMLProgressElement
const progressText = document.getElementById('progressText') as HTMLSpanElement
const outputArea = document.getElementById('outputArea') as HTMLDivElement
const statusMsg = document.getElementById('statusMsg') as HTMLDivElement

// 格式映射：根据 from 动态更新 to 选项
const formatPairs: Record<string, string[]> = {
  'heic': ['jpg', 'png', 'webp', 'avif'],
  'png': ['jpg', 'webp', 'avif', 'jxl', 'ico'],
  'jpg': ['png', 'webp', 'avif', 'jxl', 'ico'],
  'webp': ['jpg', 'png', 'avif', 'jxl', 'ico'],
  'avif': ['jpg', 'png', 'webp', 'jxl'],
  'jxl': ['jpg', 'png', 'webp', 'avif'],
  'bmp': ['jpg', 'png'],
  'tiff': ['jpg', 'png'],
  'mp3': ['wav', 'm4a', 'flac', 'ogg'],
  'wav': ['mp3', 'm4a', 'flac', 'ogg'],
  'm4a': ['mp3', 'wav', 'flac', 'ogg'],
  'flac': ['mp3', 'wav', 'm4a', 'ogg'],
  'ogg': ['mp3', 'wav', 'm4a', 'flac'],
  'mp4': ['webm'],
  'mov': ['mp3', 'webm'],
  'avi': ['mp3', 'webm'],
  'mkv': ['mp3', 'webm'],
  '7z': ['zip'],
  'tar': ['zip'],
  'tar.gz': ['zip'],
  'pdf': ['png', 'jpg', 'txt'],
  'docx': ['html'],
  'csv': ['json', 'xlsx'],
  'json': ['csv', 'xlsx', 'yaml'],
  'yaml': ['json', 'csv'],
  'xlsx': ['csv', 'json'],
  'svg': ['png', 'jpg', 'pdf'],
}

// 格式 → 模块映射
const formatModule: Record<string, string> = {
  'heic': 'images',
  'png': 'images',
  'jpg': 'images',
  'webp': 'images',
  'avif': 'images',
  'jxl': 'images',
  'bmp': 'images',
  'tiff': 'images',
  'ico': 'ico',
  'svg': 'svg',
  'mp3': 'audio-video',
  'wav': 'audio-video',
  'm4a': 'audio-video',
  'flac': 'audio-video',
  'ogg': 'audio-video',
  'mp4': 'audio-video',
  'mov': 'audio-video',
  'avi': 'audio-video',
  'mkv': 'audio-video',
  'webm': 'audio-video',
  '7z': 'archives',
  'tar': 'archives',
  'tar.gz': 'archives',
  'zip': 'archives',
  'pdf': 'pdf',
  'docx': 'docx-preview',
  'csv': 'data',
  'json': 'data',
  'yaml': 'data',
  'xlsx': 'data',
}

// 更新目标格式下拉框
function updateToFormats() {
  const from = fromFormat.value
  const tos = formatPairs[from] || []
  toFormat.innerHTML = tos.map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('')
  if (tos.length > 0) toFormat.value = tos[0]
}

fromFormat.addEventListener('change', updateToFormats)
updateToFormats()

// 转换按钮点击
convertBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0]
  if (!file) {
    statusMsg.textContent = '⚠️ 请先选择一个文件'
    return
  }

  const from = fromFormat.value
  const to = toFormat.value
  const moduleName = formatModule[from]

  if (!moduleName) {
    statusMsg.textContent = `❌ 不支持 ${from} 格式`
    return
  }

  // 禁用按钮，显示进度
  convertBtn.disabled = true
  convertBtn.textContent = '转换中...'
  progressBar.value = 0
  progressBar.style.display = 'block'
  progressText.textContent = '0%'
  outputArea.innerHTML = ''
  statusMsg.textContent = ''

  try {
    const result = await convertFile(
      file,
      {
        from: from,
        to: to,
        module: moduleName,
      },
      (pct: number) => {
        progressBar.value = pct
        progressText.textContent = `${Math.round(pct)}%`
      }
    )

    // 生成下载链接
    const url = URL.createObjectURL(result)
    const a = document.createElement('a')
    a.href = url
    a.download = `${file.name.split('.')[0]}.${to}`
    a.textContent = `📥 下载 ${to.toUpperCase()}`
    a.className = 'download-link'
    outputArea.appendChild(a)

    statusMsg.textContent = '✅ 转换完成！'
  } catch (err: any) {
    statusMsg.textContent = `❌ 转换失败：${err.message || err}`
    console.error(err)
  } finally {
    convertBtn.disabled = false
    convertBtn.textContent = '🔄 转换'
  }
})

// 拖拽上传支持
document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.querySelector('.drop-zone') as HTMLDivElement
  if (!dropZone) return

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropZone.style.borderColor = '#6C3CE1'
  })

  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = '#3b82f6'
  })

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropZone.style.borderColor = '#3b82f6'
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      fileInput.files = files
      statusMsg.textContent = `📎 已选择: ${files[0].name}`
    }
  })
})