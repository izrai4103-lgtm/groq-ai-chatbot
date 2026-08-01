/**
 * 🧠 Thinker & Researcher — Model AI untuk Thinking + Web Research
 * 
 * - Thinking Model: menganalisa, merencanakan, dan berpikir sebelum menjawab
 * - Web Research Model: mencari informasi dan memberikan data faktual
 */

import { SandboxError } from './sandbox.js'
import { JailbreakScanner, JAILBREAK_POLICY_PROMPT, verdictToError } from './jailbreak-scanner.js'
import { BASE_SYSTEM_PROMPT } from './schema-prompt.js'
import { fetchWebResearch, formatWebResults } from './web-research.js'

// System prompt ringkas untuk model pembantu (Thinking/Research).
// Prompt penuh ~3.300 token; dikirim 2x per request bisa tembus batas
// TPM Groq (6.000/menit) → 413. Versi ringkas ini tetap dari schema.json
// (identitas + inti perilaku + gaya bicara) namun hemat token.
const SUB_SYSTEM_PROMPT = (() => {
  const s = BASE_SYSTEM_PROMPT
  return s.length <= 1800 ? s : s.slice(0, s.lastIndexOf('\n', 1800))
})()
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const jailbreakScanner = new JailbreakScanner()

// ===== KONFIGURASI MODEL =====
const MODELS = {
  thinking: {
    apiKey: () => process.env.GROQ_API_KEY_2,
    model: 'llama-3.1-8b-instant',
    maxTokens: 160,
    label: 'Thinking Model',
  },
  research: {
    apiKey: () => process.env.GROQ_API_KEY_3,
    model: 'llama-3.1-8b-instant',
    maxTokens: 160,
    label: 'Web Research',
  }
}

// ===== CALL MODEL GROQ =====
async function callModel(modelConfig, systemPrompt, userMessage) {
  const apiKey = modelConfig.apiKey()
  if (!apiKey) {
    throw new SandboxError('MODEL_KEY_MISSING', `API Key ${modelConfig.label} tidak tersedia`)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: modelConfig.maxTokens,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.text()).slice(0, 300) } catch (e) { /* ignore */ }
      console.error(`[callModel ${modelConfig.label}] Groq ${res.status}: ${detail}`)
      throw new SandboxError('MODEL_ERROR', `${modelConfig.label} error (${res.status})`)
    }
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err.name === 'AbortError') throw new SandboxError('MODEL_TIMEOUT', `${modelConfig.label} timeout`)
    throw new SandboxError('MODEL_FAIL', `${modelConfig.label} gagal: ${err.message}`)
  } finally { clearTimeout(timeout) }
}

// ===== BLOK SUMBER (link asli dari hasil web, ditambahkan otomatis) =====
function buildSourceBlock(results, limit = 6) {
  const seen = new Set()
  const list = []
  for (const r of results || []) {
    if (list.length >= limit) break
    const name = String(r.source || r.title || '').trim()
    if (!name || !r.url) continue
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    list.push(`- [${name}](${r.url})`)
  }
  return list.length ? `\n\n🔗 **Sumber:**\n${list.join('\n')}` : ''
}

// ===== THINKING PROMPT =====
const THINKING_PROMPT = `${SUB_SYSTEM_PROMPT}

Saat bertugas sebagai mode THINKING, ikuti langkah berikut:

1. ANALISA pertanyaan user secara mendalam
2. PECAH masalah menjadi langkah-langkah logis
3. Identifikasi pola, koneksi, dan implikasi
4. Beri reasoning yang jelas dan terstruktur
5. Simpulkan dengan jawaban yang akurat

Gunakan format berikut:
🧠 **Analisis:** (analisa mendalam)
📋 **Langkah:** (langkah-langkah solusi)
💡 **Kesimpulan:** (jawaban akhir)

${JAILBREAK_POLICY_PROMPT}`

// ===== WEB RESEARCH PROMPT =====
const RESEARCH_PROMPT = `${SUB_SYSTEM_PROMPT}

Saat bertugas sebagai mode WEB RESEARCH, kamu merangkum hasil pencarian web sungguhan:

1. Jawab berdasarkan fakta dari hasil pencarian web yang diberikan user
2. Sertakan data, statistik, dan fakta spesifik
3. Sebutkan nama sumber/website secara singkat setelah tiap poin (contoh: (Sumber: Kompas.com)) — link lengkap ditambahkan otomatis di akhir
4. Bedakan antara fakta dan opini
5. Jika hasil web tidak mencukupi, akui keterbatasan dengan jujur

Gunakan format berikut:
🔍 **Hasil Research:** (informasi yang ditemukan)
📊 **Data & Fakta:** (detail spesifik)
🔗 **Sumber:** (referensi informasi)

${JAILBREAK_POLICY_PROMPT}`

// ===== THINKING + RESEARCH PIPELINE =====
export async function thinkAndResearch(question, userId = 'anonymous', useWeb = false) {
  const result = {
    thinking: '',
    research: '',
    answer: '',
    error: null,
    modelsUsed: [],
    blockCode: null,
  }

  try {
    // Step 0: Jailbreak scan (sebelum pesan sampai ke model AI)
    const scan = await jailbreakScanner.scan(question, userId)
    if (scan.verdict === 'banned' || scan.verdict === 'block') {
      const err = verdictToError(scan)
      result.blockCode = err.code
      result.error = err.message
      return result
    }

    // Step 1: Thinking dulu
    const thinkResult = await callModel(MODELS.thinking, THINKING_PROMPT, question)
    result.modelsUsed.push('Thinking Model')
    result.thinking = thinkResult

    // Step 2: Research — pakai hasil pencarian web sungguhan bila useWeb aktif
    let researchQuery
    let web = null
    if (useWeb) {
      web = await fetchWebResearch(question)
      if (web.ok) {
        researchQuery = `Pertanyaan: ${question}\n\nHasil pencarian web (fakta dari sumber):\n${formatWebResults(web.results, web.related)}\n\nSusun jawaban faktual berdasarkan hasil tersebut dan sebutkan sumbernya.`
      } else {
        researchQuery = `Lakukan riset web tentang: ${question}. Catatan: sumber web tidak tersedia saat ini, jawab sebaik mungkin.`
      }
    } else {
      researchQuery = `Berdasarkan analisa ini:\n${thinkResult}\n\nLakukan research mendalam tentang topik: ${question}`
    }
    const researchResult = await callModel(MODELS.research, RESEARCH_PROMPT, researchQuery)
    const sourceBlock = useWeb && web && web.ok ? buildSourceBlock(web.results) : ''
    result.modelsUsed.push('Web Research')
    result.research = researchResult + sourceBlock

    // Step 3: Gabungkan hasil
    result.answer = `${result.thinking}\n\n${result.research}`
    result.error = null

  } catch (err) {
    const raw = err instanceof SandboxError ? err.message : `Error: ${err.message}`
    result.error = /413|Request too large|tokens per minute|TPM/i.test(raw)
      ? 'Batas token per menit model tercapai. Tunggu sebentar lalu coba lagi.'
      : raw
  }

  return result
}

// ===== SINGLE MODEL CALLS (untuk penggunaan terpisah) =====
export async function think(question, userId = 'anonymous') {
  try {
    const scan = await jailbreakScanner.scan(question, userId)
    if (scan.verdict === 'banned' || scan.verdict === 'block') {
      const err = verdictToError(scan)
      return { success: false, error: err.message, model: 'Thinking Model', blockCode: err.code }
    }
    const result = await callModel(MODELS.thinking, THINKING_PROMPT, question)
    return { success: true, content: result, model: 'Thinking Model' }
  } catch (err) {
    return { success: false, error: err.message, model: 'Thinking Model' }
  }
}

export async function research(query, userId = 'anonymous', useWeb = true) {
  try {
    const scan = await jailbreakScanner.scan(query, userId)
    if (scan.verdict === 'banned' || scan.verdict === 'block') {
      const err = verdictToError(scan)
      return { success: false, error: err.message, model: 'Web Research', blockCode: err.code }
    }
    let userMessage = query
    let web = null
    if (useWeb) {
      web = await fetchWebResearch(query)
      if (web.ok) {
        userMessage = `Pertanyaan: ${query}\n\nHasil pencarian web (fakta dari sumber):\n${formatWebResults(web.results, web.related)}\n\nSusun jawaban faktual berdasarkan hasil tersebut dan sebutkan sumbernya.`
      } else {
        userMessage = `Lakukan riset web tentang: ${query}. Catatan: sumber web tidak tersedia saat ini, jawab sebaik mungkin.`
      }
    }
    const result = await callModel(MODELS.research, RESEARCH_PROMPT, userMessage)
    const sourceBlock = useWeb && web && web.ok ? buildSourceBlock(web.results) : ''
    return { success: true, content: result + sourceBlock, model: 'Web Research' }
  } catch (err) {
    return { success: false, error: err.message, model: 'Web Research' }
  }
}

export { MODELS }
