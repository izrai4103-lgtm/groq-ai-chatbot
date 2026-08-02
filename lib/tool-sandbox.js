/**
 * 🧰 AI Tool Sandbox — tool AI yang bisa dipakai SEMUA model
 * (chat, thinking, research, creative) lewat Groq function calling.
 *
 * Alur integrasi: sandbox → semua models AI.
 *
 * Modul ini satu-satunya tempat yang:
 *  - mendaftarkan skema tool (AI_TOOLS)
 *  - menjelaskan cara pakai tool ke model (TOOL_GUIDANCE_PROMPT)
 *  - mengeksekusi tool yang diminta model (executeTool)
 *  - menjalankan loop tool-calling untuk model apa pun (runModelWithTools)
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const portfolioTools = require('./portfolioPdfTool.js')
const { getGroqKeys, nextKeyIndex } = require('./groq-keys.js')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

/* ===== Daftar tool yang didaftarkan ke semua model ===== */
export const AI_TOOLS = [
  portfolioTools.analyzeWebsiteTool,
  portfolioTools.generatePortfolioPdfTool,
]

/* ===== Panduan penggunaan tool untuk model ===== */
export const TOOL_GUIDANCE_PROMPT = `
## TOOL AI

Kamu punya 2 tool:
1. analyze_website — buka URL sungguhan di server, ambil judul/deskripsi/heading/teks/screenshot/status HTTP/waktu load/mobile-friendly/error console. Pakai saat user minta portofolio/laporan dari URL. Rangkum fitur website dengan katamu sendiri (jangan salin mentah), lalu panggil generate_portfolio_pdf.
2. generate_portfolio_pdf — buat PDF portofolio dari data yang terkumpul (nama, jabatan, skill, pengalaman, proyek, kontak). Panggil setelah data lengkap; jangan mengarang.

Alur:
- Dari URL: panggil analyze_website → rangkum → panggil generate_portfolio_pdf → sampaikan link PDF dari tool.
- Tanpa URL: kumpulkan data dulu → panggil generate_portfolio_pdf → sampaikan link.
- analyze_website gagal (ok:false) → beri tahu user, jangan mengarang.

PENTING:
- Saat user minta portofolio/PDF, LANGSUNG panggil tool — jangan menolak.
- Argumen tool: JSON lengkap & valid, tanpa teks di luar JSON.
- Jika tool gagal, coba sekali lagi dengan data ringkas.
- Link PDF dari tool sudah lengkap: sampaikan persis, jangan ubah/tambah domain.
- Saat menyampaikan link PDF, tulis URL lengkapnya di jawabanmu (contoh: "Download: <url>"), jangan menyebut "link di atas" atau sejenisnya.
`

const MAX_TOOL_ROUNDS = 3

/* ===== Eksekusi tool yang diminta model ===== */
export async function executeTool(name, args) {
  let result
  try {
    switch (name) {
      case 'analyze_website':
        result = await portfolioTools.runAnalyzeWebsite(args)
        break
      case 'generate_portfolio_pdf':
        result = await portfolioTools.runGeneratePortfolioPdf(args)
        break
      default:
        result = { ok: false, error: `Tool tidak dikenal: ${name}` }
    }
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  // Screenshot base64 bisa puluhan ribu token — jangan dikirim utuh ke model
  // (bikin request berikutnya melewati batas konteks/TPM). Data lain tetap utuh.
  if (result && typeof result.screenshot === 'string' && result.screenshot.length > 4000) {
    result = { ...result, screenshot: `[screenshot tersedia, dilewati dari konteks model: ${result.screenshot.length} chars]` }
  }

  console.log(`[tool] ${name} ->`, JSON.stringify(result).slice(0, 600))
  return result
}

/* ===== Satu panggilan Groq dengan tools (tanpa loop) ===== */
// POST ke Groq dengan failover antar key (mengurangi error 429):
// kena 429/5xx -> coba key berikutnya; semua key habis -> tunggu lalu ulang.
async function fetchGroqOnce({ body, signal }) {
  const keys = getGroqKeys()
  if (keys.length === 0) {
    const e = new Error('MODEL_KEY_MISSING')
    throw e
  }

  // Mulai dari key bergiliran (round-robin + offset menit) supaya beban tersebar.
  const minuteOffset = Math.floor(Date.now() / 60_000) % keys.length
  const startIdx = (nextKeyIndex(keys.length) + minuteOffset) % keys.length

  const tryKeys = async () => {
    let failed = null
    for (let i = 0; i < keys.length; i++) {
      const apiKey = keys[(startIdx + i) % keys.length]
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (!RETRYABLE_STATUS.has(res.status)) return res
      failed = res
      await sleep(400)
    }
    return failed
  }

  const first = await tryKeys()
  if (first && !RETRYABLE_STATUS.has(first.status)) return first

  // Semua key kena 429/5xx: tunggu reset (hormati Retry-After, maks 45 dtk)
  // lalu coba sekali lagi sebelum menyerah.
  const retryAfter = Number((first || { headers: { get: () => '' } }).headers?.get?.('retry-after') || 0)
  const wait = Math.min(retryAfter || 20_000, 45_000)
  if (wait > 0) await sleep(wait)
  const second = await tryKeys()
  if (second && !RETRYABLE_STATUS.has(second.status)) return second
  return second || first
}

async function callGroqOnce({ model, systemPrompt, messages, tools, temperature, maxTokens, timeoutMs }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const makeBody = (temp, tokens) => ({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: temp,
      max_tokens: tokens ?? maxTokens,
      tools,
      tool_choice: 'auto',
    })

    let res = await fetchGroqOnce({ body: makeBody(temperature), signal: controller.signal })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // Retry sekali saat model gagal menghasilkan argumen tool yang valid.
      const isToolFail = res.status === 400 && detail.includes('tool_use_failed')
      if (isToolFail) {
        res = await fetchGroqOnce({ body: makeBody(0.2, Math.max(maxTokens, 800)), signal: controller.signal })
        if (res.ok) {
          const d2 = await res.json()
          const m2 = d2.choices?.[0]?.message
          return {
            content: m2?.content ?? '',
            toolCalls: (m2?.tool_calls || []).map(tc => ({
              id: tc.id || '',
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '{}',
            })),
          }
        }
      }
      const detail2 = await res.text().catch(() => '')
      const hint = res.status === 429 ? ' — kuota Groq penuh, coba lagi sebentar' : ''
      const err = new Error(`AI error (${res.status})${hint}`)
      err.status = res.status
      err.detail = detail2.slice(0, 300)
      throw err
    }

    const data = await res.json()
    const message = data.choices?.[0]?.message
    const toolCalls = (message?.tool_calls || []).map(tc => ({
      id: tc.id || '',
      name: tc.function?.name || '',
      arguments: tc.function?.arguments || '{}',
    }))

    // max_tokens kecil (160) bisa memotong argumen tool -> ulangi sekali
    // dengan ruang lebih besar supaya JSON argumen tool tidak terpotong.
    const truncated =
      data.choices?.[0]?.finish_reason === 'length' ||
      toolCalls.some(tc => {
        try { JSON.parse(tc.arguments); return false } catch { return true }
      })
    if (truncated && maxTokens < 800) {
      const res2 = await fetchGroqOnce({ body: makeBody(0.2, 800), signal: controller.signal })
      if (res2.ok) {
        const d2 = await res2.json()
        const m2 = d2.choices?.[0]?.message
        return {
          content: m2?.content ?? '',
          toolCalls: (m2?.tool_calls || []).map(tc => ({
            id: tc.id || '',
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '{}',
          })),
        }
      }
    }

    return { content: message?.content ?? '', toolCalls }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      const e = new Error(`Model AI timeout (${timeoutMs / 1000} detik)`)
      e.code = 'AI_TIMEOUT'
      throw e
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Jalankan model Groq dengan function calling + eksekusi tool,
 * untuk model apa pun (chat, thinking, research, creative).
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.systemPrompt
 * @param {Array} opts.messages  pesan role user/assistant/tool
 * @param {Array} [opts.tools]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>} konten akhir setelah tool selesai dijalankan
 */
export async function runModelWithTools({
  apiKey,
  model,
  systemPrompt,
  messages,
  tools = AI_TOOLS,
  maxTokens = 160,
  temperature = 0.7,
  timeoutMs = 60_000,
}) {
  if (!apiKey) {
    throw new Error('MODEL_KEY_MISSING')
  }

  const chatMessages = [...messages]
  let finalContent = ''

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await callGroqOnce({ apiKey, model, systemPrompt, messages: chatMessages, tools, temperature, maxTokens, timeoutMs })

    if (!res.toolCalls || res.toolCalls.length === 0) {
      finalContent = res.content
      break
    }

    chatMessages.push({
      role: 'assistant',
      content: res.content || null,
      tool_calls: res.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    })

    for (const tc of res.toolCalls) {
      let toolResult
      try {
        const args = JSON.parse(tc.arguments || '{}')
        toolResult = await executeTool(tc.name, args)
      } catch (e) {
        toolResult = { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      chatMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
      })
    }
  }

  return finalContent
}
