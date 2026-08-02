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

/* ===== Daftar tool yang didaftarkan ke semua model ===== */
export const AI_TOOLS = [
  portfolioTools.analyzeWebsiteTool,
  portfolioTools.generatePortfolioPdfTool,
]

/* ===== Panduan penggunaan tool untuk model ===== */
export const TOOL_GUIDANCE_PROMPT = `
## FUNGSI TAMBAHAN (TOOL AI)

Kamu punya 2 fungsi (tool) yang bisa dipanggil sendiri:

1. analyze_website — membuka URL website sungguhan di server lalu mengambil judul, deskripsi, heading, cuplikan teks, screenshot, status HTTP, waktu load, mobile-friendly, dan error console. Gunakan saat user minta portofolio/laporan dari sebuah URL (misal "buatkan portofolio dari website https://..."). Setelah hasilnya masuk, rangkum fitur & kesan website itu dengan kata-katamu sendiri, jangan salin mentah-mentah.

2. generate_portfolio_pdf — membuat file PDF portofolio profesional dari data yang sudah terkumpul lewat percakapan (nama, jabatan, ringkasan, skill, pengalaman, proyek, pendidikan, kontak). Panggil HANYA setelah data penting lengkap; jangan mengarang data yang belum disebutkan user.

Alur yang benar:
- User minta portofolio dari URL → panggil analyze_website → rangkum hasilnya → panggil generate_portfolio_pdf (screenshot dari hasil analisis boleh dipakai di projects[].screenshot) → sampaikan link PDF yang dikembalikan tool ke user.
- User minta portofolio tanpa URL → kumpulkan data lewat obrolan dulu → panggil generate_portfolio_pdf → sampaikan link PDF.
- Kalau analyze_website gagal (ok: false) → beri tahu user, jangan mengarang data website.
`

const MAX_TOOL_ROUNDS = 4

/* ===== Eksekusi tool yang diminta model ===== */
export async function executeTool(name, args) {
  switch (name) {
    case 'analyze_website':
      return portfolioTools.runAnalyzeWebsite(args)
    case 'generate_portfolio_pdf':
      return portfolioTools.runGeneratePortfolioPdf(args)
    default:
      return { ok: false, error: `Tool tidak dikenal: ${name}` }
  }
}

/* ===== Satu panggilan Groq dengan tools (tanpa loop) ===== */
async function callGroqOnce({ apiKey, model, systemPrompt, messages, tools, temperature, maxTokens, timeoutMs }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature,
        max_tokens: maxTokens,
        tools,
        tool_choice: 'auto',
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const err = new Error(`AI error (${res.status})`)
      err.status = res.status
      err.detail = detail.slice(0, 300)
      throw err
    }

    const data = await res.json()
    const message = data.choices?.[0]?.message
    return {
      content: message?.content ?? '',
      toolCalls: (message?.tool_calls || []).map(tc => ({
        id: tc.id || '',
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '{}',
      })),
    }
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
  maxTokens = 1400,
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
