/* ============================================================
 * 👁️ Vision Engine — scan & identifikasi file untuk Zanco-Ai
 *
 * Alur: file masuk → VISION (scan/identifikasi) → PILLOW
 * (analisis gambar) → sandbox → semua models AI.
 *
 * - Gambar : Pillow (Python) menganalisis teknis + model vision
 *            Groq (qwen3.6-27b) mengidentifikasi isi.
 * - Dokumen: vision membaca isi file (PDF/DOCX/TXT/kode/CSV/JSON).
 * - Audio  : Whisper (Groq) transkripsi.
 *
 * Pillow dipakai saat Python+PIL tersedia (dev); di Vercel yang
 * tidak punya runtime Python, otomatis fallback ke sharp dengan
 * hasil analisis yang setara.
 * ============================================================ */
import { spawnSync } from 'child_process'
import { statSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { EngineError } from './groq'
import { getFeatureKeys } from '../provider-keys'

/* ===== Konstanta ===== */
const GROQ_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const VISION_MODEL = process.env.VISION_MODEL || 'gemini-2.5-flash'
const WHISPER_MODEL = 'whisper-large-v3-turbo'
const MAX_FILE_BYTES = 4 * 1024 * 1024 // batas body Vercel 4.5MB
const MAX_REPORT_CHARS = 3500

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'ico', 'svg'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'oga'])
const DOC_EXTS = new Set([
  'pdf', 'docx', 'txt', 'md', 'csv', 'json', 'js', 'ts', 'jsx', 'tsx',
  'html', 'htm', 'css', 'py', 'log', 'xml', 'yaml', 'yml', 'ini', 'sql', 'sh',
])

export interface VisionResult {
  kind: 'image' | 'document' | 'audio'
  name: string
  context: string
  detail?: string
}

interface PillowInfo {
  engine: string
  width?: number
  height?: number
  format?: string
  mode?: string
  exif?: Record<string, string>
  colors?: Array<{ hex: string; count: number }>
  brightness?: number | null
}

/* ===== Helper kecil ===== */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function getVisionEntry() {
  // Vision memakai key fitur upload (sekarang Gemini).
  const uploadKeys = getFeatureKeys('upload')
  const entry = uploadKeys[0]
  const key = entry?.key || process.env.GEMINI_API_KEY || process.env.GROQ_VISION_KEY || ''
  if (!key) throw new EngineError('AI_MODEL_UNAVAILABLE', 'Kunci API vision tidak tersedia')
  return { key, url: entry?.url || GEMINI_URL }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

const COLOR_NAMES: Array<[string, string]> = [
  ['#ff0000', 'merah'], ['#ff8c00', 'oranye'], ['#ffff00', 'kuning'], ['#00ff00', 'hijau'],
  ['#00ffff', 'cyan'], ['#0000ff', 'biru'], ['#800080', 'ungu'], ['#ff00ff', 'magenta'],
  ['#ffc0cb', 'pink'], ['#a52a2a', 'cokelat'], ['#808080', 'abu-abu'], ['#ffffff', 'putih'],
  ['#000000', 'hitam'], ['#008000', 'hijau tua'], ['#000080', 'biru tua'], ['#ffd700', 'emas'],
  ['#c0c0c0', 'perak'], ['#f5f5dc', 'krem'], ['#ffa500', 'jingga'], ['#40e0d0', 'turquoise'],
]

function nearestColorName(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  let best = 'warna', bestDist = Infinity
  for (const [h2, name] of COLOR_NAMES) {
    const r2 = parseInt(h2.slice(1, 3), 16), g2 = parseInt(h2.slice(3, 5), 16), b2 = parseInt(h2.slice(5, 7), 16)
    const dist = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2
    if (dist < bestDist) { bestDist = dist; best = name }
  }
  return best
}

/* ===== PILLOW (analisis gambar) ===== */
async function pillowAnalyze(buffer: Buffer): Promise<PillowInfo> {
  const fromPython = tryPythonPillow(buffer)
  if (fromPython) return fromPython
  return analyzeImageSharp(buffer)
}

function tryPythonPillow(buffer: Buffer): PillowInfo | null {
  try {
    const scriptPath = path.join(process.cwd(), 'lib', 'pillow', 'analyze.py')
    const res = spawnSync('python3', [scriptPath], {
      input: buffer,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
      encoding: 'utf-8',
    })
    if (res.status === 0 && res.stdout) {
      const data = JSON.parse(res.stdout) as PillowInfo & { ok?: boolean }
      if (data.ok) return data
    }
  } catch {
    /* python/PIL tidak tersedia → fallback sharp */
  }
  return null
}

async function analyzeImageSharp(buffer: Buffer): Promise<PillowInfo> {
  const sharp = (await import('sharp')).default
  const meta = await sharp(buffer).metadata()
  const stats = await sharp(buffer).stats()
  const { data, info } = await sharp(buffer)
    .resize(32, 32, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const buckets = new Map<number, number>()
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i] >> 3, g = data[i + 1] >> 3, b = data[i + 2] >> 3
    const key = (r << 10) | (g << 5) | b
    buckets.set(key, (buckets.get(key) || 0) + 1)
  }
  const colors = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, count]) => {
      const r = ((k >> 10) & 31) << 3
      const g = ((k >> 5) & 31) << 3
      const b = (k & 31) << 3
      return { hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''), count }
    })

  const mean = stats.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3
  return {
    engine: 'sharp',
    width: meta.width ?? info.width,
    height: meta.height ?? info.height,
    format: (meta.format || 'unknown').toUpperCase(),
    mode: 'RGB',
    exif: meta.orientation ? { Orientation: String(meta.orientation) } : {},
    colors,
    brightness: Math.round((mean / 255) * 100 * 10) / 10,
  }
}

/* ===== Persiapan gambar untuk model vision ===== */
async function prepareImageForVision(buffer: Buffer): Promise<string> {
  const sharp = (await import('sharp')).default
  const out = await sharp(buffer)
    .rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  return `data:image/jpeg;base64,${out.toString('base64')}`
}

/* ===== Panggilan model vision Groq (dengan retry) ===== */
async function callGroqVision(system: string, content: unknown): Promise<string> {
  const { key: apiKey, url: visionUrl } = getVisionEntry()
  const body = {
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  }

  let lastDetail = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    try {
      const res = await fetch(visionUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        lastDetail = detail
        if (res.status === 429 || /over capacity|rate limit|try again/i.test(detail)) {
          await sleep(2000 * (attempt + 1))
          continue
        }
        throw new EngineError('AI_MODEL_ERROR', `Vision model error (${res.status})`, { detail })
      }
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      let contentText = data.choices?.[0]?.message?.content?.trim() || ''
      // Buang blok reasoning qwen (<think>...</think>) agar konteks tetap bersih
      contentText = contentText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      if (contentText) return contentText
      lastDetail = 'empty response'
      await sleep(1000 * (attempt + 1))
    } catch (err) {
      if (err instanceof EngineError) throw err
      lastDetail = err instanceof Error ? err.message : String(err)
      if (err instanceof Error && err.name === 'AbortError') {
        await sleep(1000 * (attempt + 1))
        continue
      }
      throw new EngineError('AI_UNKNOWN', 'Gagal memanggil vision model', { detail: lastDetail })
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new EngineError('AI_MODEL_ERROR', 'Vision model sedang sibuk, coba lagi nanti', { detail: lastDetail })
}

/* ===== SCAN GAMBAR (identifikasi) — degrade halus bila model sibuk ===== */
async function scanImage(buffer: Buffer): Promise<string | null> {
  try {
    const dataUrl = await prepareImageForVision(buffer)
    const system = [
      'Kamu adalah mesin SCAN & IDENTIFIKASI gambar milik Zanco-Ai.',
      'Lihat gambar dengan teliti, lalu berikan hasil scan dalam Bahasa Indonesia:',
      '- Isi/subjek utama gambar',
      '- Objek, orang, atau teks yang terlihat (tulis ulang teks yang terbaca)',
      '- Warna dominan dan suasana gambar',
      '- Detail teknis yang relevan',
      'Maksimal 200 kata. Langsung ke hasil scan, tanpa basa-basi, tanpa mengulang instruksi.',
    ].join('\n')
    return await callGroqVision(system, [
      { type: 'text', text: 'Scan gambar ini secara detail dan identifikasi isinya.' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ])
  } catch (err) {
    console.error('Vision scan error:', err instanceof Error ? err.message : err)
    return null
  }
}

/* ===== BACA DOKUMEN ===== */
async function extractText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === 'pdf') {
    const { PDFParse } = await import('pdf-parse')
    // Pastikan worker pdfjs ditemukan (Vercel/Next kadang melewatkan file-nya)
    for (const rel of [
      'node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs',
      'node_modules/pdf-parse/dist/worker/pdf.worker.mjs',
    ]) {
      try {
        const abs = path.join(process.cwd(), rel)
        statSync(abs)
        PDFParse.setWorker(pathToFileURL(abs).href)
        break
      } catch {
        /* coba lokasi berikutnya */
      }
    }
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    return result.text || ''
  }
  if (ext === 'docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value || ''
  }
  // Teks polos: buang karakter aneh, jaga yang terbaca saja
  const raw = buffer.toString('utf8').replace(/\uFFFD/g, '')
  return raw.trim()
}

async function readDocument(name: string, text: string): Promise<string | null> {
  try {
    const system = [
      'Kamu adalah mesin PEMBACA DOKUMEN milik Zanco-Ai.',
      'Baca isi dokumen lalu berikan dalam Bahasa Indonesia:',
      '- Identifikasi jenis dokumen',
      '- Ringkasan isi dokumen',
      '- Poin-poin penting / data kunci yang ditemukan',
      'Maksimal 250 kata. Langsung ke hasil, tanpa mengulang instruksi.',
    ].join('\n')
    return await callGroqVision(system, `Nama file: ${name}\n\nIsi dokumen:\n"""\n${truncate(text, 7000)}\n"""`)
  } catch (err) {
    console.error('Vision doc error:', err instanceof Error ? err.message : err)
    return null
  }
}

/* ===== TRANSKRIPSI AUDIO (Whisper) ===== */
async function transcribeAudio(buffer: Buffer, name: string): Promise<string> {
  // Whisper hanya tersedia di Groq; dengan Gemini, transkripsi audio dinonaktifkan.
  const apiKey = process.env.GROQ_API_KEY || ''
  if (!apiKey) {
    throw new EngineError('AI_MODEL_UNAVAILABLE', 'Transkripsi audio butuh key Groq (whisper)')
  }
  const fd = new FormData()
  fd.append('file', new Blob([buffer as unknown as BlobPart]), name)
  fd.append('model', WHISPER_MODEL)
  fd.append('response_format', 'json')
  fd.append('language', 'id')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(GROQ_AUDIO_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: fd,
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new EngineError('AI_MODEL_ERROR', `Whisper error (${res.status})`, { detail })
    }
    const data = await res.json() as { text?: string }
    return (data.text || '').trim()
  } catch (err) {
    if (err instanceof EngineError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new EngineError('AI_TIMEOUT', 'Transkripsi audio timeout')
    }
    throw new EngineError('AI_UNKNOWN', 'Gagal transkripsi audio', {
      detail: err instanceof Error ? err.message : String(err),
    })
  } finally {
    clearTimeout(timeout)
  }
}

/* ===== PIPELINE UTAMA ===== */
export async function runVisionPipeline(file: File): Promise<VisionResult> {
  const name = file.name || 'lampiran'
  const ext = (name.split('.').pop() || '').toLowerCase()
  const buffer = Buffer.from(await file.arrayBuffer())

  if (buffer.length === 0) throw new EngineError('INVALID_INPUT', 'File kosong')
  if (buffer.length > MAX_FILE_BYTES) {
    throw new EngineError('INVALID_INPUT', 'File terlalu besar (maks 4MB)')
  }

  const type = (file.type || '').toLowerCase()
  if (IMAGE_EXTS.has(ext) || type.startsWith('image/')) return analyzeImage(name, buffer)
  if (AUDIO_EXTS.has(ext) || type.startsWith('audio/')) return analyzeAudio(name, buffer)
  if (DOC_EXTS.has(ext)) return analyzeDocument(name, buffer, ext)

  throw new EngineError(
    'INVALID_INPUT',
    `Tipe file "${ext || 'unknown'}" belum didukung. Gunakan gambar (JPG/PNG/WebP/GIF/BMP), dokumen (PDF/DOCX/TXT/CSV/JSON/kode), atau audio (MP3/WAV/M4A/AAC).`,
  )
}

/* ===== Gambar: Pillow + Vision ===== */
async function analyzeImage(name: string, buffer: Buffer): Promise<VisionResult> {
  const info = await pillowAnalyze(buffer)
  const visionText = await scanImage(buffer)

  const lines: string[] = [`[📎 LAMPIRAN: ${name} — tipe: gambar]`, '']
  lines.push('=== ANALISIS GAMBAR (Pillow) ===')
  if (info.width && info.height) lines.push(`- Dimensi: ${info.width}x${info.height} px`)
  if (info.format) lines.push(`- Format: ${info.format}`)
  if (info.mode) lines.push(`- Mode warna: ${info.mode}`)
  if (typeof info.brightness === 'number') lines.push(`- Kecerahan rata-rata: ${info.brightness}%`)
  if (info.colors && info.colors.length) {
    const colors = info.colors.slice(0, 5).map(c => `${c.hex} (${nearestColorName(c.hex)})`).join(', ')
    lines.push(`- Warna dominan: ${colors}`)
  }
  const exif = info.exif || {}
  if (exif.DateTime || exif.DateTimeOriginal) lines.push(`- Waktu pengambilan: ${exif.DateTimeOriginal || exif.DateTime}`)
  if (exif.Make || exif.Model) lines.push(`- Kamera: ${[exif.Make, exif.Model].filter(Boolean).join(' ')}`)
  lines.push('')

  if (visionText) {
    lines.push('=== SCAN VISION (identifikasi) ===', visionText, '')
  } else {
    lines.push('(Vision model sedang sibuk — gunakan analisis teknis Pillow di atas. JANGAN mengaku tidak bisa melihat gambar.)', '')
  }

  lines.push('PENTING: User melampirkan file ini. Analisis di atas adalah hasil scan Anda terhadap file tersebut. Anda SUDAH melihat/baca isinya. Jawab langsung pertanyaan user berdasarkan analisis — jangan pernah mengaku tidak bisa melihat/membaca file.')
  return { kind: 'image', name, context: truncate(lines.join('\n'), MAX_REPORT_CHARS) }
}

/* ===== Dokumen: Vision membaca isi ===== */
async function analyzeDocument(name: string, buffer: Buffer, ext: string): Promise<VisionResult> {
  let raw = ''
  let extractError = ''
  try {
    raw = await extractText(buffer, ext)
  } catch (err) {
    extractError = err instanceof Error ? err.message : String(err)
    console.error('Extract text error:', extractError)
  }

  if (!raw) {
    return {
      kind: 'document',
      name,
      detail: extractError,
      context: `[📎 LAMPIRAN: ${name} — tipe: dokumen]\n\nIsi dokumen tidak bisa diekstrak otomatis. ${extractError ? 'Detail teknis: ' + extractError : ''}`,
    }
  }

  const visionRead = await readDocument(name, raw)
  const lines: string[] = [`[📎 LAMPIRAN: ${name} — tipe: dokumen]`, '']
  if (visionRead) {
    lines.push('=== VISION MEMBACA DOKUMEN ===', visionRead, '')
  } else {
    lines.push('(Vision model sedang sibuk — gunakan isi dokumen di bawah ini. JANGAN mengaku tidak bisa membaca dokumen.)', '')
    lines.push('=== ISI DOKUMEN ===', truncate(raw, 3000), '')
  }
  lines.push('PENTING: User melampirkan file ini. Analisis di atas adalah hasil scan Anda terhadap file tersebut. Anda SUDAH melihat/baca isinya. Jawab langsung pertanyaan user berdasarkan analisis — jangan pernah mengaku tidak bisa melihat/membaca file.')
  return { kind: 'document', name, context: truncate(lines.join('\n'), MAX_REPORT_CHARS) }
}

/* ===== Audio: Whisper ===== */
async function analyzeAudio(name: string, buffer: Buffer): Promise<VisionResult> {
  const text = await transcribeAudio(buffer, name)
  if (!text) {
    throw new EngineError('AI_EMPTY_RESPONSE', 'Audio tidak bisa ditranskripsi (mungkin kosong atau tidak jelas)')
  }
  const context = [
    `[🎤 LAMPIRAN: ${name} — tipe: audio]`,
    '',
    '=== TRANSCRIPT (Whisper) ===',
    truncate(text, 3500),
    '',
    'Konteks lampiran ini membantu menjawab pertanyaan/permintaan user yang ada di pesan user. Jawab langsung tanpa menyebut konteks ini.',
  ].join('\n')
  return { kind: 'audio', name, context }
}
