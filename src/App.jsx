import { useEffect, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import './App.css'
import './refresh.css'

const sizeOf = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : bytes < 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`

const buildSmartImageBlob = async (file, compact, enhanceGraphics) => {
  const bitmap = await createImageBitmap(file.file)
  const maxSide = compact ? 1600 : 2000
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d', { alpha: false })
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.filter = enhanceGraphics ? 'contrast(1.08) saturate(1.12) brightness(1.02)' : 'none'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const candidates = compact
    ? [
        { mimeType: 'image/webp', quality: 0.7 },
        { mimeType: 'image/jpeg', quality: 0.72 },
        { mimeType: 'image/webp', quality: 0.55 },
        { mimeType: 'image/jpeg', quality: 0.62 }
      ]
    : [
        { mimeType: 'image/webp', quality: 0.82 },
        { mimeType: 'image/jpeg', quality: 0.86 },
        { mimeType: 'image/webp', quality: 0.74 },
        { mimeType: 'image/jpeg', quality: 0.8 }
      ]

  let best = file.file
  let bestInfo = { type: file.type, quality: 1, extension: file.name.split('.').pop() }

  for (const candidate of candidates) {
    const blob = await new Promise((resolve) => {
      canvas.toBlob((result) => resolve(result || file.file), candidate.mimeType, candidate.quality)
    })

    if (blob.size < best.size) {
      best = blob
      bestInfo = {
        type: candidate.mimeType,
        quality: candidate.quality,
        extension: candidate.mimeType.includes('jpeg') ? 'jpg' : 'webp'
      }
    }
  }

  return { blob: best, info: bestInfo }
}

const buildBetaImageBlob = async (file, enhanceGraphics) => {
  const bitmap = await createImageBitmap(file.file)
  const maxSide = 640
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.filter = enhanceGraphics ? 'contrast(1.04) saturate(1.06)' : 'none'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const qualities = [0.42, 0.3, 0.22, 0.16, 0.1, 0.06]
  let best = file.file
  for (const quality of qualities) {
    const blob = await new Promise((resolve) => {
      canvas.toBlob((result) => resolve(result || file.file), 'image/webp', quality)
    })
    if (blob.size < best.size) best = blob
  }

  return { blob: best, info: { extension: 'webp' } }
}

function App() {
  const [files, setFiles] = useState([])
  const [theme, setTheme] = useState('light')
  const [mode, setMode] = useState('compact')
  const [tab, setTab] = useState('smart')
  const [enhance, setEnhance] = useState(true)
  const [running, setRunning] = useState(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const inputRef = useRef(null)
  const ffmpegRef = useRef(null)

  useEffect(() => { localStorage.setItem('luma-theme', theme) }, [theme])
  useEffect(() => {
    const onKey = (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); inputRef.current?.click() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const addFiles = (incoming) => {
    const next = Array.from(incoming).map((file) => ({ id: `${file.name}-${file.lastModified}-${file.size}`, file, name: file.name, type: file.type, size: file.size, status: 'ready' }))
    setFiles((current) => [...current, ...next.filter((item) => !current.some((file) => file.id === item.id))])
  }
  const removeFile = (id) => setFiles((current) => current.filter((file) => file.id !== id))

  const compress = async (file) => {
    if (running) return
    setRunning(file.id); setProgress(0); setMessage('')
    try {
      if (file.type.startsWith('image/')) {
        const isBeta = tab === 'beta'
        const compact = mode === 'compact'
        const { blob, info } = isBeta
          ? await buildBetaImageBlob(file, enhance)
          : await buildSmartImageBlob(file, compact, enhance)
        const result = blob.size < file.size ? blob : file.file
        const url = URL.createObjectURL(result)
        const extension = result === file.file ? file.name.split('.').pop() : info.extension
        setFiles((current) => current.map((item) => item.id === file.id ? { ...item, status: 'done', outputUrl: url, outputName: `luma-${file.name.replace(/\.[^.]+$/, '')}.${extension}`, outputSize: result.size, unchanged: result === file.file } : item))
        setProgress(100); setRunning(null); return
      }
      const ffmpeg = ffmpegRef.current || new FFmpeg(); ffmpegRef.current = ffmpeg
      ffmpeg.on('progress', ({ progress: value }) => setProgress(Math.round(value * 100)))
      if (!ffmpeg.loaded) { const base = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'; await ffmpeg.load({ coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'), wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm') }) }
      const safe = file.id.replace(/[^a-z0-9]/gi, '').slice(-16) || 'media'; const input = `input-${safe}.${file.name.split('.').pop()}`; const output = `output-${safe}.mp4`
      await ffmpeg.writeFile(input, await fetchFile(file.file))
      const isCompact = mode === 'compact'
      const isBeta = tab === 'beta'
      const filter = enhance
        ? 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,eq=contrast=1.08:saturation=1.1:brightness=0.02,unsharp=5:5:0.8:5:5:0.0'
        : 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos'
      const args = isBeta
        ? ['-y', '-i', input, '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '34', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k', '-ac', '1', '-movflags', '+faststart', '-shortest', output]
        : isCompact
        ? ['-y', '-i', input, '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', output]
        : ['-y', '-i', input, '-vf', filter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', output]
      await ffmpeg.exec(args)
      const data = await ffmpeg.readFile(output); const blob = new Blob([data], { type: 'video/mp4' }); const url = URL.createObjectURL(blob)
      setFiles((current) => current.map((item) => item.id === file.id ? { ...item, status: 'done', outputUrl: url, outputName: `luma-${file.name.replace(/\.[^.]+$/, '')}.mp4`, outputSize: blob.size, ratio: file.size / blob.size } : item))
      setRunning(null)
    } catch (error) { setFiles((current) => current.map((item) => item.id === file.id ? { ...item, status: 'error' } : item)); setMessage(error instanceof Error ? error.message : 'Не удалось обработать файл'); setRunning(null) }
  }

  return <div className={`app-shell ${theme}`}>
    <header className="topbar">
      <button className="brand" onClick={() => setFiles([])}>Luma</button>
      <div className="topbar-center"><span className="live-dot" /> ЛОКАЛЬНАЯ ОБРАБОТКА <b>·</b> {files.length}</div>
      <div className="top-actions">
        <button className="top-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☼' : '◐'} Тема</button>
        <button className="top-button" onClick={() => inputRef.current?.click()}>Открыть файлы</button>
      </div>
    </header>

    <main className="workbench">
      <nav className="compression-tabs" aria-label="Режимы сжатия">
        <button className={tab === 'smart' ? 'active' : ''} onClick={() => setTab('smart')}>Smart compression</button>
        <button className={tab === 'beta' ? 'active beta-tab' : 'beta-tab'} onClick={() => setTab('beta')}>Beta · 600× lab</button>
      </nav>
      <div className="page-head">
        <div>
          <p className="breadcrumb">LUMA / MEDIA WORKSPACE</p>
          <h1>Сжатие медиа</h1>
          <p>Меньше размер. Та же приватность.</p>
        </div>
        <div className="hero-cluster">
          <div className="hero-pill"><span className="mini-dot" /> Без облака</div>
          <div className="hero-pill"><span className="mini-dot" /> Локально</div>
          <div className="hero-pill"><span className="mini-dot" /> Быстро</div>
        </div>
      </div>

      <section className="stats-strip">
        <div className="stat-card">
          <span>Локальная обработка</span>
          <strong>100% на устройстве</strong>
        </div>
        <div className="stat-card">
          <span>Режимы</span>
          <strong>Careful / Smart</strong>
        </div>
        <div className="stat-card">
          <span>Форматы</span>
          <strong>Видео + изображение</strong>
        </div>
      </section>

      <section className="drop-panel">
        <div className="drop-copy">
          <span className="section-tag">01 / ДОБАВЬТЕ ФАЙЛЫ</span>
          <h2>Перетащите медиа сюда</h2>
          <p>{tab === 'beta' ? 'Экспериментальная лаборатория: до 600× на подходящих изображениях. Фактический коэффициент зависит от деталей исходника.' : mode === 'compact' ? 'Сильное сжатие с умной обработкой деталей: уменьшение размера без заметного падения качества.' : 'Бережный режим сохраняет исходные пиксели и оптимизирует без агрессивного ухудшения.'}</p>
          <div className="mode-switch">
            <button className={mode === 'careful' ? 'active' : ''} onClick={() => setMode('careful')}>Без потерь</button>
            <button className={mode === 'compact' ? 'active' : ''} onClick={() => setMode('compact')}>Сильное сжатие</button>
          </div>
          {tab === 'beta' && <div className="beta-note">BETA · результат зависит от деталей исходника</div>}
          <button className={`top-button ${enhance ? 'active' : ''}`} onClick={() => setEnhance((value) => !value)}>
            {enhance ? 'Улучшение: ВКЛ' : 'Улучшение: ВЫКЛ'}
          </button>
          <button className="primary-button" onClick={() => inputRef.current?.click()}>Выбрать файлы <span>↗</span></button>
          <input ref={inputRef} type="file" multiple accept="video/*,image/*" onChange={(event) => addFiles(event.target.files)} />
          {running && <div className="engine-status"><span className="engine-dot processing" />Обработка · {progress}%</div>}
          {message && <div className="engine-error">{message}</div>}
        </div>
        <div className="drop-symbol">＋<span>или перетащите</span></div>
      </section>

      <section className="files-section">
        <div className="section-header">
          <div>
            <span className="section-tag">02 / РЕЗУЛЬТАТЫ</span>
            <h2>{files.length ? 'Ваши файлы' : 'Начните с одного файла'}</h2>
          </div>
          {files.length > 0 && <button className="clear-button" onClick={() => setFiles([])}>Очистить всё</button>}
        </div>

        {files.length ? <div className="file-table">
          <div className="table-head"><span>ИМЯ</span><span>ТИП</span><span>РАЗМЕР</span><span>ДЕЙСТВИЕ</span></div>
          {files.map((file) => <div className="file-line" key={file.id}><span className="file-name"><i className={file.type.startsWith('image') ? 'image' : 'video'}>{file.type.startsWith('image') ? '▧' : '▶'}</i>{file.name}</span><span>{file.type.split('/')[1]?.toUpperCase() || 'ФАЙЛ'}</span><span>{sizeOf(file.status === 'done' && file.outputSize ? file.outputSize : file.size)}{file.status === 'done' && file.outputSize && <small className="ratio"> · {Math.max(1, Math.round(file.size / file.outputSize))}×</small>}</span><span className="file-status">{file.status === 'done' ? <a href={file.outputUrl} download={file.outputName}>Скачать</a> : <button disabled={Boolean(running)} onClick={() => compress(file)}>{file.status === 'error' ? 'Повторить' : 'Сжать'}</button>}<button className="remove-button" onClick={() => removeFile(file.id)}>×</button></span></div>)}
        </div> : <div className="empty-table"><span>＋</span><p>Файлов пока нет</p><small>Нажмите «Открыть файлы» или перетащите их в верхнюю область.</small></div>}
      </section>
    </main>

    <footer><span>LUMA / 2026</span><span>ЛОКАЛЬНО · БЕЗ БАЗЫ · БЕЗ ОБЛАКА</span><span>v1.0</span></footer>
  </div>
}

export default App
