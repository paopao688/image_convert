import { buildZip, configureEngine, convertFile, type ConvertOptions } from '@hushvert/engine'

// ============================================================
// 配置引擎 - 重型 wasm 资源的加载策略
//  · ffmpeg（音/视频）：
//    - worker.js + core.js：由 @ffmpeg/ffmpeg 以 module Worker 加载，
//      Chromium 禁止跨域构造 Worker（即使 CDN 返回 CORS 头也报
//      SecurityError）→ 必须本地同源 vendor/，与 libarchive/pdfjs 同理。
//    - ffmpeg-core.wasm（约 30MB）不适合随站点打包 → 仍走 CDN。
//      它在 worker 内以普通 fetch 拉取，跨域 CORS 没问题。
//  · libarchive（7z/tar/…）：classic Worker 不允许跨域 → 本地同源 vendor/。
//  · pdfjs（PDF 渲染 worker）：本地同源 vendor/。
//  所有本地 vendor 由 scripts/copy-vendor.js 复制到部署根目录 /vendor/；
//  dev 环境由 vite.config.ts 的 vendor 插件映射到相同路径。
// ============================================================
const FFMPEG_VER = '0.12.10' // @ffmpeg/core 版本，决定 CDN wasm 路径
const VENDOR_FFMPEG_WORKER = '/vendor/ffmpeg/worker.js'
const VENDOR_FFMPEG_CORE = '/vendor/ffmpeg/ffmpeg-core.js'
const VENDOR_LIBARCHIVE = '/vendor/libarchive/worker-bundle.js'
const VENDOR_PDFJS = '/vendor/pdfjs/pdf.worker.min.mjs'

// ffmpeg-core.wasm 的 CDN 备选源（仅 wasm 走 CDN）
interface CdnProvider {
  name: string
  wasmUrl: string
}

const CDN_PROVIDERS: CdnProvider[] = [
  { name: 'jsdelivr', wasmUrl: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_VER}/dist/esm/ffmpeg-core.wasm` },
  { name: 'jsdelivr-fastly', wasmUrl: `https://fastly.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_VER}/dist/esm/ffmpeg-core.wasm` },
  { name: 'jsdelivr-gcore', wasmUrl: `https://gcore.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_VER}/dist/esm/ffmpeg-core.wasm` },
  { name: 'unpkg', wasmUrl: `https://unpkg.com/@ffmpeg/core@${FFMPEG_VER}/dist/esm/ffmpeg-core.wasm` },
]

// HEAD 探测某个资源是否可达（超时视为不可用）
async function probe(url: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

// 记录是否有可用的 ffmpeg wasm CDN 源（决定 audio-video 模块是否可用）
let cdnReachable = false

// 并行探测所有源，返回第一个可用的（不等其它源超时）；全部失败则用默认 jsdelivr
async function resolveBestCdn(): Promise<CdnProvider> {
  return new Promise((resolve) => {
    let settled = false
    let pending = CDN_PROVIDERS.length
    for (const p of CDN_PROVIDERS) {
      probe(p.wasmUrl).then((ok) => {
        if (settled) return
        if (ok) {
          settled = true
          cdnReachable = true
          console.info(`[hushvert] ffmpeg-core.wasm 将使用 CDN 源：${p.name}`)
          resolve(p)
          return
        }
        pending--
        if (pending === 0) {
          settled = true
          cdnReachable = false
          console.warn('[hushvert] 所有 ffmpeg wasm CDN 源探测失败：音/视频转换将不可用（格式已标灰提示）')
          resolve(CDN_PROVIDERS[0]!)
        }
      })
    }
  })
}

// 引擎初始化在探测完成后进行；转换开始前会 await engineReady
const engineReady = (async () => {
  const cdn = await resolveBestCdn()
  configureEngine({
    ffmpeg: {
      // worker/core 必须同源（Chromium 禁止跨域 Worker），本地 vendor 托管；
      // 仅 30MB 的 wasm 从 CDN 拉取
      coreUrl: VENDOR_FFMPEG_CORE,
      wasmUrl: cdn.wasmUrl,
      classWorkerUrl: VENDOR_FFMPEG_WORKER,
    },
    libarchiveWorkerUrl: VENDOR_LIBARCHIVE,
    pdfjsWorkerUrl: VENDOR_PDFJS,
  })
})().catch((err) => {
  console.error('[hushvert] 引擎初始化失败', err)
})

// 各模块引擎资源可用性（undefined = 尚未探测，暂按可用处理，避免首帧误置灰）
const assetReady: Record<string, boolean | undefined> = {}
function moduleReady(moduleName: string | undefined): boolean {
  if (!moduleName) return false
  return assetReady[moduleName] !== false
}

// ============================================================
// DOM 元素（保持不变）
// ============================================================
const fileInput = document.getElementById('fileInput') as HTMLInputElement
const fromFormat = document.getElementById('fromFormat') as HTMLSelectElement
const toFormat = document.getElementById('toFormat') as HTMLSelectElement
const convertBtn = document.getElementById('convertBtn') as HTMLButtonElement
const progressBar = document.getElementById('progressBar') as HTMLProgressElement
const progressText = document.getElementById('progressText') as HTMLSpanElement
const outputArea = document.getElementById('outputArea') as HTMLDivElement
const statusMsg = document.getElementById('statusMsg') as HTMLDivElement

// ============================================================
// 格式映射（保持不变）
// ============================================================
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

// ============================================================
// 扩展名 -> 输入格式（拖拽 / 文件夹批量时自动识别）
// ============================================================
const EXT_FORMAT: Record<string, string> = {
  heic: 'heic', heif: 'heic',
  jpg: 'jpg', jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  jxl: 'jxl',
  bmp: 'bmp',
  tif: 'tiff', tiff: 'tiff',
  svg: 'svg',
  mp3: 'mp3',
  wav: 'wav',
  m4a: 'm4a',
  flac: 'flac',
  ogg: 'ogg',
  mp4: 'mp4',
  mov: 'mov',
  avi: 'avi',
  mkv: 'mkv',
  '7z': '7z',
  tar: 'tar',
  pdf: 'pdf',
  docx: 'docx',
  csv: 'csv',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  xlsx: 'xlsx',
}

// 每种输入格式的扩展名（文件选择器 accept 过滤 & 生成输出文件名）
const FORMAT_EXTS: Record<string, string[]> = {
  heic: ['heic', 'heif'],
  jpg: ['jpg', 'jpeg'],
  png: ['png'],
  webp: ['webp'],
  avif: ['avif'],
  jxl: ['jxl'],
  bmp: ['bmp'],
  tiff: ['tif', 'tiff'],
  svg: ['svg'],
  mp3: ['mp3'],
  wav: ['wav'],
  m4a: ['m4a'],
  flac: ['flac'],
  ogg: ['ogg'],
  mp4: ['mp4'],
  mov: ['mov'],
  avi: ['avi'],
  mkv: ['mkv'],
  '7z': ['7z'],
  tar: ['tar'],
  'tar.gz': ['tar.gz'],
  pdf: ['pdf'],
  docx: ['docx'],
  csv: ['csv'],
  json: ['json'],
  yaml: ['yaml', 'yml'],
  xlsx: ['xlsx'],
}

// 有损图片输出：可自定义质量（png / ico / webm / zip / txt / html 等无损或固定）
const LOSSY_IMG = ['jpg', 'webp', 'avif', 'jxl']

function detectFormat(fileName: string): string | undefined {
  const name = fileName.toLowerCase()
  if (name.endsWith('.tar.gz')) return 'tar.gz'
  const m = /\.([^.]+)$/.exec(name)
  if (!m) return undefined
  return EXT_FORMAT[m[1]]
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// ============================================================
// 输出质量 / 比特率控件（按目标格式显示）
// ============================================================
const qualityWrap = document.getElementById('qualityWrap') as HTMLDivElement
const imgQualityField = document.getElementById('imgQualityField') as HTMLDivElement
const qualityRange = document.getElementById('qualityRange') as HTMLInputElement
const qualityValue = document.getElementById('qualityValue') as HTMLSpanElement
const audioBitrateField = document.getElementById('audioBitrateField') as HTMLDivElement
const bitrateSelect = document.getElementById('bitrateSelect') as HTMLSelectElement

qualityRange.addEventListener('input', () => {
  qualityValue.textContent = qualityRange.value
})

function refreshQualityUI() {
  const to = toFormat.value
  if (to === 'mp3') {
    // MP3：显示比特率
    qualityWrap.style.display = 'flex'
    imgQualityField.style.display = 'none'
    audioBitrateField.style.display = ''
  } else if (LOSSY_IMG.includes(to)) {
    // 有损图片：显示质量滑杆
    qualityWrap.style.display = 'flex'
    imgQualityField.style.display = ''
    audioBitrateField.style.display = 'none'
  } else {
    // PNG / 无损等：无需设置
    qualityWrap.style.display = 'none'
  }
}

// ============================================================
// 队列（多文件 / 文件夹批量转换）
// 目标格式不再在加入队列时锁定，而是在点「开始转换」时
// 按当时选择的「到」格式解析（resolveTarget），避免改下拉后输出还是旧格式
// ============================================================
interface QueueItem { file: File; from: string }

const dropZone = document.querySelector('#dropZone') as HTMLDivElement
const folderInput = document.getElementById('folderInput') as HTMLInputElement
const clearQueueBtn = document.getElementById('clearQueueBtn') as HTMLButtonElement
const queueInfo = document.getElementById('queueInfo') as HTMLSpanElement
const progressWrap = document.getElementById('progressWrap') as HTMLDivElement
const resultsTitle = document.getElementById('resultsTitle') as HTMLDivElement
const resultsCount = document.getElementById('resultsCount') as HTMLSpanElement
const downloadAllBtn = document.getElementById('downloadAllBtn') as HTMLButtonElement

let queue: QueueItem[] = []
const queueKeySet = new Set<string>()
let converting = false
// 本次会话转换成功的所有结果（供「下载全部」打包）
let results: { name: string; blob: Blob }[] = []

function updateQueueUI() {
  const n = queue.length
  queueInfo.textContent = n > 0 ? `📦 队列：${n} 个文件` : ''
  convertBtn.textContent = n > 0 ? `🔄 开始转换（${n}）` : '🔄 开始转换'
  if (n > 0 && !converting) {
    statusMsg.textContent = `📎 已就绪 ${n} 个文件，点击「开始转换」批量处理`
  }
}

function updateResultsCount() {
  const totalRows = outputArea.children.length
  const failRows = outputArea.querySelectorAll('.result-error').length
  const ok = results.length
  resultsTitle.style.display = totalRows > 0 ? 'flex' : 'none'
  downloadAllBtn.hidden = ok === 0
  if (totalRows > 0) {
    if (ok > 0) {
      resultsCount.textContent = failRows > 0 ? `${ok} 成功 · ${failRows} 失败` : `${ok} 个文件`
    } else {
      resultsCount.textContent = `全部失败（${failRows}）`
    }
  } else {
    resultsCount.textContent = ''
  }
}

// 打包时避免同名文件冲突：a.webp、a(1).webp、a(2).webp…
function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const count = seen.get(name) || 0
    seen.set(name, count + 1)
    if (count === 0) return name
    const dot = name.lastIndexOf('.')
    if (dot <= 0) return `${name}(${count})`
    return `${name.slice(0, dot)}(${count})${name.slice(dot)}`
  })
}

// 「下载全部」：把成功结果打包成一个 zip
downloadAllBtn.addEventListener('click', async () => {
  if (results.length === 0) return
  downloadAllBtn.disabled = true
  const originalText = downloadAllBtn.textContent || ''
  downloadAllBtn.textContent = '⏳ 打包中…'
  statusMsg.textContent = `⏳ 正在打包 ${results.length} 个文件…`
  try {
    const names = dedupeNames(results.map((r) => r.name))
    const blob = await buildZip(results.map((r, i) => ({ name: names[i]!, blob: r.blob })))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `converted-${results.length}个文件.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    statusMsg.textContent = `✅ 已打包 ${results.length} 个文件（${formatSize(blob.size)}），请查看浏览器下载`
  } catch (err: any) {
    console.error('打包失败:', err)
    statusMsg.textContent = `❌ 打包失败：${err?.message || err}`
  } finally {
    downloadAllBtn.disabled = false
    downloadAllBtn.textContent = originalText
  }
})

// 解析某输入格式当前应使用的输出目标：优先当前「到」下拉框，
// 若该输入不支持此目标（如 PNG 输入无法输出 PNG），回退到它的第一个可用目标
function resolveTarget(from: string): string {
  const tos = formatPairs[from] || []
  const t = toFormat.value
  if (tos.includes(t)) return t
  return tos[0] || ''
}

// 某些输出目标由「独立模块」实现，不能沿用输入格式的模块：
//  · 输出 ico -> 使用 ico 模块（ico module 会用 canvas 解码光栅图并打包多尺寸 favicon）
// 其余沿用 formatModule[from]
function moduleFor(from: string, to: string): string {
  if (to === 'ico') return 'ico'
  return formatModule[from] || ''
}

// 把一批文件加入队列（拖拽可能混合多种格式，因此逐个按扩展名识别）
function addFiles(fileList: FileList | null) {
  if (converting) {
    statusMsg.textContent = '⏳ 正在转换中，请等待完成后再添加'
    return
  }
  if (!fileList || fileList.length === 0) return

  let added = 0
  let skipped = 0
  let dup = 0
  let unavail = 0
  for (const file of Array.from(fileList)) {
    const from = detectFormat(file.name)
    if (!from || !formatModule[from] || !formatPairs[from]) {
      skipped++
      continue
    }
    if (!moduleReady(formatModule[from])) {
      // 该格式的引擎资源当前不可用（如 ffmpeg CDN 连不上 / 本地 vendor 缺失）
      unavail++
      continue
    }
    const key = `${file.name}|${file.size}|${file.lastModified}`
    if (queueKeySet.has(key)) {
      dup++
      continue
    }
    queueKeySet.add(key)
    queue.push({ file, from })
    added++
  }

  updateQueueUI()
  if (added > 0) {
    const extra: string[] = []
    if (dup > 0) extra.push(`${dup} 个重复`)
    if (skipped > 0) extra.push(`${skipped} 个不支持`)
    if (unavail > 0) extra.push(`${unavail} 个需联网引擎`)
    statusMsg.textContent = `✅ 已加入队列 ${added} 个文件` + (extra.length ? `（${extra.join('，')}）` : '')
  } else if (skipped > 0 || dup > 0 || unavail > 0) {
    const parts: string[] = []
    if (unavail > 0) parts.push(`${unavail} 个需要联网引擎，暂不可用`)
    if (skipped > 0) parts.push(`${skipped} 个不支持格式`)
    if (dup > 0) parts.push(`${dup} 个内容重复`)
    statusMsg.textContent = `⚠️ 没有新增文件（${parts.join('，')}）`
  }
}

// 生成输出文件名（把输入扩展名替换为目标扩展名）
function outputFileName(item: QueueItem, to: string): string {
  const low = item.file.name.toLowerCase()
  for (const ext of FORMAT_EXTS[item.from] || []) {
    if (low.endsWith('.' + ext)) {
      return item.file.name.slice(0, -ext.length - 1) + '.' + to
    }
  }
  return item.file.name.replace(/\.[^.]+$/, '') + '.' + to
}

// 根据目标格式决定要传入引擎的质量 / 比特率选项
function buildOptions(to: string): ConvertOptions {
  if (to === 'mp3') {
    const v = Number(bitrateSelect.value)
    return v > 0 ? { audioBitrateKbps: v } : {}
  }
  if (LOSSY_IMG.includes(to)) {
    const q = Number(qualityRange.value)
    return q > 0 ? { quality: q } : {}
  }
  return {}
}

function appendResult(item: QueueItem, to: string, blob: Blob) {
  const row = document.createElement('div')
  row.className = 'result-item'

  const name = document.createElement('span')
  name.className = 'result-name'
  const badge = document.createElement('span')
  badge.className = 'file-badge'
  badge.textContent = `${item.from.toUpperCase()} → ${to.toUpperCase()}`
  name.appendChild(badge)
  name.appendChild(document.createTextNode(`${item.file.name}（${formatSize(blob.size)}）`))

  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = outputFileName(item, to)
  a.textContent = `📥 下载 ${to.toUpperCase()}`
  a.className = 'download-link'

  row.appendChild(name)
  row.appendChild(a)
  outputArea.appendChild(row)
  results.push({ name: outputFileName(item, to), blob })
  updateResultsCount()
}

function appendError(item: QueueItem, err: any) {
  const row = document.createElement('div')
  row.className = 'result-item result-error'
  const name = document.createElement('span')
  name.className = 'result-name'
  name.textContent = `❌ ${item.file.name}：${err?.message || err}`
  row.appendChild(name)
  outputArea.appendChild(row)
  updateResultsCount()
}

// ============================================================
// 更新目标格式 / 文件选择器过滤（只允许选中的输入格式）
// ============================================================
function updateAccept() {
  const exts = FORMAT_EXTS[fromFormat.value] || []
  fileInput.accept = exts.map(e => '.' + e).join(',')
}

function updateToFormats() {
  const from = fromFormat.value
  const tos = formatPairs[from] || []
  toFormat.innerHTML = tos.map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('')
  if (tos.length > 0) toFormat.value = tos[0]
  updateAccept()
  refreshQualityUI()
  applyFormatAvailability() // 依据引擎资源可用性置灰「从」下拉的不可用格式
}

// 「从」下拉：保留所有格式但把当前引擎不可用的置灰并加 ⚠，不可选中
function applyFormatAvailability() {
  let anyDisabled = false
  for (const opt of Array.from(fromFormat.options)) {
    const ready = moduleReady(formatModule[opt.value])
    const base = (opt.textContent || '').replace(/\s*⚠$/, '')
    opt.disabled = !ready
    opt.textContent = ready ? base : `${base} ⚠`
    if (!ready) anyDisabled = true
  }
  // 若当前选中的格式引擎不可用，自动切到第一个可用项
  if (moduleReady(formatModule[fromFormat.value]) === false) {
    const first = Array.from(fromFormat.options).find((o) => !o.disabled)
    if (first) {
      fromFormat.value = first.value
      updateToFormats()
      return
    }
    statusMsg.textContent = '⚠️ 当前所有格式均不可用（请检查网络后刷新）'
  }
  const hint = document.getElementById('availHint') as HTMLDivElement | null
  if (hint) hint.hidden = !anyDisabled
}

// 探测各模块引擎资源，决定哪些格式可用：
//  libarchive(7z/tar)、pdfjs(pdf 渲染)、ffmpeg(audio-video) 之外均为本地引擎，始终可用
async function bootAvailability() {
  try {
    await engineReady
    const [la, pj] = await Promise.all([
      probe(VENDOR_LIBARCHIVE).catch(() => false),
      probe(VENDOR_PDFJS).catch(() => false),
    ])
    assetReady['archives'] = la
    assetReady['pdf-render'] = pj
    assetReady['audio-video'] = cdnReachable
    console.info(`[hushvert] 可用性探测 → libarchive:${la} pdfjs:${pj} ffmpegCDN:${cdnReachable}`)
    updateToFormats() // 重新应用置灰状态
  } catch (err) {
    console.error('[hushvert] 可用性探测失败', err)
  }
}

fromFormat.addEventListener('change', () => {
  updateToFormats()
})
toFormat.addEventListener('change', refreshQualityUI)
updateToFormats()
bootAvailability()

// ============================================================
// 队列串行转换
// ============================================================
let stallTimer: number | undefined

function clearStall() {
  if (stallTimer !== undefined) {
    clearInterval(stallTimer)
    stallTimer = undefined
  }
}

convertBtn.addEventListener('click', async () => {
  if (converting) return
  if (queue.length === 0) {
    statusMsg.textContent = '⚠️ 请先添加文件（点击上方区域或「📁 上传文件夹」）'
    return
  }
  await engineReady // 确保 CDN 源探测 + 引擎配置已完成

  const items = queue.splice(0)
  queueKeySet.clear()
  updateQueueUI() // 队列已取出，同步清空队列显示
  converting = true
  convertBtn.disabled = true
  results = []
  outputArea.innerHTML = ''
  updateResultsCount()
  progressWrap.classList.add('show')
  progressBar.value = 0
  progressText.textContent = '0%'

  const total = items.length
  let done = 0
  let failed = 0

  try {
    for (let i = 0; i < total; i++) {
      const item = items[i]!
      // 输出目标 = 点转换那一刻选择的目标格式（不再沿用加入队列时的旧格式）
      const to = resolveTarget(item.from)
      const moduleName = moduleFor(item.from, to)

      // 引擎不可用（如该格式需要联网的 ffmpeg 但 CDN 连不上）→ 快速失败，不要空转
      if (!moduleReady(moduleName)) {
        failed++
        appendError(item, new Error('该格式的转换引擎当前不可用（需联网或缺少本地 vendor 资源）'))
        progressBar.value = ((i + 1) / total) * 100
        continue
      }

      convertBtn.textContent = `⏳ 转换中 ${i + 1}/${total}`
      statusMsg.textContent = `🔄 [${i + 1}/${total}] 正在转换 ${item.file.name} → ${to.toUpperCase()}`

      // 卡顿提示：引擎解码/加载阶段通常不回报进度，2 秒无进展就提示用户耐心等待
      const itemStart = Date.now()
      let stallWarned = false
      clearStall()
      stallTimer = window.setInterval(() => {
        if (progressBar.value > 0) {
          clearStall()
          return
        }
        if (!stallWarned && Date.now() - itemStart > 2000) {
          stallWarned = true
          const needNet = ['heic', 'heif', 'mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'mov', 'avi', 'mkv', 'webm', '7z', 'tar', 'tar.gz', 'pdf', 'docx'].includes(item.from)
          statusMsg.textContent = needNet
            ? `⏳ [${i + 1}/${total}] 正在下载/初始化转换引擎（${item.file.name} 需要联网加载引擎，网速慢请耐心等待…）`
            : `⏳ [${i + 1}/${total}] 正在解码大图（${item.file.name}）…请耐心等待`
        }
      }, 500)

      try {
        const blob = await convertFile(
          item.file,
          { from: item.from, to: to, module: moduleName },
          (pct: number) => {
            // 有进展后立即清除卡顿提示
            if (pct > 0 && stallTimer !== undefined) clearStall()
            // 综合整体进度：已完成文件数 + 当前文件进度
            const overall = ((i + pct / 100) / total) * 100
            progressBar.value = overall
            progressText.textContent = `${Math.round(overall)}%`
          },
          buildOptions(to),
        )
        appendResult(item, to, blob)
        done++
      } catch (err: any) {
        failed++
        appendError(item, err)
        console.error(`转换失败 ${item.file.name}:`, err)
      }
      clearStall()
      progressBar.value = ((i + 1) / total) * 100
    }
  } finally {
    clearStall()
    converting = false
    convertBtn.disabled = false
    updateQueueUI() // 恢复按钮文案 / 队列显示
    statusMsg.textContent =
      failed === 0
        ? `✅ 全部转换完成：${done} 个文件（结果在上方，逐个点击下载）`
        : `⚠️ 完成 ${done} 个，失败 ${failed} 个`
    progressText.textContent = '100%'
  }
})

// ============================================================
// 清空队列与结果
// ============================================================
clearQueueBtn.addEventListener('click', () => {
  clearStall()
  queue = []
  queueKeySet.clear()
  converting = false
  convertBtn.disabled = false
  results = []
  queueInfo.textContent = ''
  convertBtn.textContent = '🔄 开始转换'
  progressWrap.classList.remove('show')
  progressBar.value = 0
  outputArea.innerHTML = ''
  updateResultsCount()
  statusMsg.textContent = ''
})

// ============================================================
// 文件上传：点击选择（多选 / 按格式过滤） + 拖拽 + 文件夹
// ============================================================

// 1) 点击上传区域 -> 触发隐藏的 fileInput（accept 已按「从」格式过滤）
dropZone.addEventListener('click', () => {
  if (converting) return
  fileInput.click()
})

// 2) 文件选择框选中（可多选）
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files)
  fileInput.value = ''
})

// 3) 文件夹批量上传（自动识别目录内每种格式）
folderInput.addEventListener('change', () => {
  addFiles(folderInput.files)
  folderInput.value = ''
})

// 4) 拖拽悬停高亮
;['dragenter', 'dragover'].forEach((type) => {
  dropZone.addEventListener(type, (e) => {
    e.preventDefault()
    dropZone.style.borderColor = '#6C3CE1'
  })
})
;['dragleave'].forEach((type) => {
  dropZone.addEventListener(type, () => {
    dropZone.style.borderColor = '#3b82f6'
  })
})

// 5) 拖拽松手 -> 文件全部加入队列（文件夹请用「📁 上传文件夹」按钮）
dropZone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropZone.style.borderColor = '#3b82f6'
  addFiles(e.dataTransfer?.files ?? null)
})