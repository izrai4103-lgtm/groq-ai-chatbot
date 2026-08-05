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
const { getFeatureKeys, nextKeyIndex } = require('./provider-keys.js')
const { recordRateLimit, recordUsage } = require('./token-usage.js')
import { MATH_TOOL, runMathTool } from './math-tool.js'
import { RUN_CODE_TOOL, executeRunCodeTool } from './code-runner.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

/** Rapikan output model: runtuhkan whitespace patologis (em-space dll). */
function normalizeOutput(s) {
  if (!s) return ''
  return s
    .replace(/[\u00a0\u2000-\u200b\u3000\t]+/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/\n +/g, '\n')
    .trim()
}

/** Anggap jawaban gagal jika didominasi whitespace (model "nyangkut"). */
function isPathological(s, normalized) {
  if (!s) return true
  const ratio = 1 - normalized.length / s.length
  return ratio > 0.6 && normalized.length < 120
}

/* ===== Daftar tool yang didaftarkan ke semua model ===== */
export const AI_TOOLS = [
  portfolioTools.analyzeWebsiteTool,
  portfolioTools.generatePortfolioPdfTool,
  MATH_TOOL,
  RUN_CODE_TOOL,
]

/* ===== Panduan penggunaan tool untuk model ===== */
export const TOOL_GUIDANCE_PROMPT = `
## TOOL AI

Kamu punya 4 tool:
1. analyze_website — buka URL asli di server, ambil info+screenshot+tes dasar. Pakai saat user minta laporan dari URL.
2. generate_portfolio_pdf — buat PDF portofolio dari data terkumpul.
3. hitung_math — hitung angka sederhana secara akurat (aritmatika, desimal, akar, pangkat, faktorial, comb/perm).
4. run_code — EKSEKUSI JavaScript di sandbox lokal (tanpa API key). Pakai untuk algoritma, simulasi, transform data. Wajib console.log atau return. Tidak ada file/network/process.

Alur:
- Ada URL: analyze_website → rangkum → generate_portfolio_pdf → sampaikan link PDF persis dari tool.
- Tanpa URL: kumpulkan data → generate_portfolio_pdf → sampaikan link.
- analyze_website gagal (ok:false) → beri tahu user, jangan mengarang.
- Ada hitungan angka (pecahan, desimal, persen, akar, pangkat, integral tentu, jumlah huruf, dll) → panggil hitung_math dulu, jawab sesuai hasil tool.
- Soal peluang → hitung pakai hitung_math (contoh P(X=4) pada n=10,p=0.3: comb(10,4)*0.3^4*0.7^6).

PENTING:
- Minta portofolio/PDF → LANGSUNG panggil tool.
- Argumen tool: JSON valid, tanpa teks tambahan.
- Link PDF sudah lengkap: tulis URL-nya persis di jawaban.
- Jawaban angka harus sesuai hasil hitung_math, bukan tebakan.
- JANGAN pernah menulis dua nilai berbeda untuk hal yang sama — jika ragu, panggil hitung_math sekali lagi dan pakai hasil terbaru.
`

const MAX_TOOL_ROUNDS = 6

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
      case 'hitung_math':
        result = runMathTool(args)
        break
      case 'run_code':
        result = await executeRunCodeTool(args)
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

/* ===== Satu panggilan model dengan tools (tanpa loop) ===== */
// POST ke provider (Groq/Gemini) dengan failover antar key fitur:
// kena 429/5xx -> coba key berikutnya; semua key habis -> tunggu lalu ulang.
async function fetchGroqOnce({ feature = 'chat', body, signal }) {
  const keys = getFeatureKeys(feature)
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
      const entry = keys[(startIdx + i) % keys.length]
      const res = await fetch(entry.url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${entry.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, model: entry.model }),
        signal,
      })
      if (!RETRYABLE_STATUS.has(res.status)) return res
      if (res.status === 429) recordRateLimit(res.headers)
      failed = res
      await sleep(400)
    }
    return failed
  }

  // Coba langsung dulu, lalu ulangi sampai 3x kalau masih 429/5xx.
  let last = await tryKeys()
  for (let attempt = 0; attempt < 1; attempt++) {
    if (last && !RETRYABLE_STATUS.has(last.status)) return last
    // Semua key kena 429/5xx: tunggu reset window TPM (Retry-After /
    // x-ratelimit-reset-tokens) lalu coba lagi.
    const hdrs = (last || { headers: { get: () => '' } }).headers
    const retryAfter = Number(hdrs?.get?.('retry-after') || 0)
    const resetSec = Number(hdrs?.get?.('x-ratelimit-reset-tokens') || 0)
    const wait = Math.min(Math.max(retryAfter || 0, resetSec || 0, 1_000), 3_000)
    if (wait > 0) await sleep(wait)
    const next = await tryKeys()
    if (next && !RETRYABLE_STATUS.has(next.status)) return next
    last = next || last
  }
  return last
}

async function callGroqOnce({ feature = 'chat', model, systemPrompt, messages, tools, temperature, maxTokens, timeoutMs }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const makeBody = (temp, tokens) => ({
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: temp,
      max_tokens: tokens ?? maxTokens,
      tools,
      tool_choice: 'auto',
    })

    let res = await fetchGroqOnce({ feature, body: makeBody(temperature), signal: controller.signal })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // Retry sekali saat model gagal menghasilkan argumen tool yang valid.
      const isToolFail = res.status === 400 && detail.includes('tool_use_failed')
      if (isToolFail) {
        res = await fetchGroqOnce({ feature, body: makeBody(0.2, maxTokens), signal: controller.signal })
        if (res.ok) {
          const d2 = await res.json()
          const m2 = d2.choices?.[0]?.message
          recordUsage(model, 'tool', d2.usage?.total_tokens, d2.usage?.completion_tokens)
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
    recordUsage(model, 'tool', data.usage?.total_tokens, data.usage?.completion_tokens)
    const toolCalls = (message?.tool_calls || []).map(tc => ({
      id: tc.id || '',
      name: tc.function?.name || '',
      arguments: tc.function?.arguments || '{}',
    }))

    // max_tokens kecil bisa memotong argumen tool -> ulangi sekali
    // dengan ruang lebih besar supaya JSON argumen tool tidak terpotong.
    const truncated =
      data.choices?.[0]?.finish_reason === 'length' ||
      toolCalls.some(tc => {
        try { JSON.parse(tc.arguments); return false } catch { return true }
      })
    if (truncated && maxTokens < 1028) {
      const res2 = await fetchGroqOnce({ feature, body: makeBody(0.2, Math.max(maxTokens, 1028)), signal: controller.signal })
      if (res2.ok) {
        const d2 = await res2.json()
        const m2 = d2.choices?.[0]?.message
        recordUsage(model, 'tool', d2.usage?.total_tokens, d2.usage?.completion_tokens)
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
  feature = 'chat',
  model,
  systemPrompt,
  messages,
  tools = AI_TOOLS,
  maxTokens = 1028,
  temperature = 0.7,
  timeoutMs = 90_000,
}) {
  const keys = getFeatureKeys(feature)
  if (keys.length === 0) {
    const e = new Error('MODEL_KEY_MISSING')
    throw e
  }
  const resolvedModel = model || keys[0].model

  const chatMessages = [...messages]
  let finalContent = ''

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await callGroqOnce({ feature, model: resolvedModel, systemPrompt, messages: chatMessages, tools, temperature, maxTokens, timeoutMs })

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

    let done = false
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

      // PDF berhasil dibuat -> jawaban final disusun server (hemat ronde model).
      if (
        tc.name === 'generate_portfolio_pdf' &&
        toolResult &&
        typeof toolResult === 'object' &&
        toolResult.ok !== false &&
        toolResult.url
      ) {
        finalContent = `Portofolio PDF siap! Download: ${toolResult.url}`
        done = true
      }
    }
    if (done) break
  }

  const rawFinal = finalContent
  const normFinal = normalizeOutput(rawFinal)
  return isPathological(rawFinal, normFinal) ? '' : normFinal
}
