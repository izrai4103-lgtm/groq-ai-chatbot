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
import { runModelWithTools, TOOL_GUIDANCE_PROMPT } from './tool-sandbox.js'

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
function buildSourceBlock(results, limit = 20) {
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

Hari ini: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}.

Saat bertugas sebagai mode THINKING, ikuti langkah berikut:

1. ANALISA pertanyaan user secara mendalam
2. PECAH masalah menjadi langkah-langkah logis
3. Identifikasi pola, koneksi, dan implikasi
4. Beri reasoning yang jelas dan terstruktur
5. Simpulkan dengan jawaban yang akurat

Catatan penting:
- Jawab langsung dengan keyakinan berdasarkan pengetahuanmu.
- JANGAN menolak menjawab hanya karena merasa data kamu usang — fakta terkini akan diverifikasi oleh mode riset web.
- Jangan menyebut 'data hingga tahun X' atau 'cutoff' kecuali benar-benar perlu.

Gunakan format berikut:
🧠 **Analisis:** (analisa mendalam)
📋 **Langkah:** (langkah-langkah solusi)
💡 **Kesimpulan:** (jawaban akhir)

${JAILBREAK_POLICY_PROMPT}`

// ===== WEB RESEARCH PROMPT =====
const RESEARCH_PROMPT = `${SUB_SYSTEM_PROMPT}

Hari ini: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}.

Saat bertugas sebagai mode WEB RESEARCH, jawab PERTANYAAN user secara LANGSUNG, TEGAS, dan AKURAT:

1. Jawab langsung pertanyaannya lebih dulu (satu-dua kalimat tegas dan jelas), baru berikan detail pendukung dari hasil pencarian
2. BACA BAGIAN 'ISI ARTIKEL' yang disertakan — itu teks asli berita/artikel dari sumbernya. Gunakan fakta dari DALAM artikel (bukan cuma judul/ringkasan) sebagai bukti jawaban
3. Kutip fakta, data, dan nama sumber setelah tiap poin (contoh: (Sumber: Wikipedia)) — link lengkap ditambahkan otomatis di akhir
4. ABAIKAN hasil yang tidak relevan dengan pertanyaan (misal turnamen sepak bola 'Piala Presiden' saat user bertanya presiden negara — itu noise, jangan dibahas)
5. Kalau hasil web kurang relevan, tetap jawab berdasarkan pengetahuan umummu, lalu tandai bagian mana yang didukung hasil web
6. JANGAN pernah menjawab 'tidak ada informasi' selama kamu masih bisa menjawab — menjawab 'tidak ada informasi' padahal bisa menjawab adalah kegagalan
7. Bedakan fakta dan opini; akui keterbatasan hanya bila benar-benar tidak bisa menjawab
8. JANGAN membuat daftar link sumber sendiri di akhir jawaban — blok sumber lengkap sudah ditambahkan otomatis oleh sistem

Gunakan format berikut:
🔍 **Hasil Research:** (jawaban langsung + informasi yang ditemukan)
📊 **Data & Fakta:** (detail spesifik + sumber)

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

    // Step 1: Thinking (dilewati saat web research aktif — riset web adalah
    // sumber fakta utama dan menghemat kuota token per menit)
    let thinkResult = ''
    if (!useWeb) {
      thinkResult = await runModelWithTools({
        apiKey: MODELS.thinking.apiKey(),
        model: MODELS.thinking.model,
        systemPrompt: `${THINKING_PROMPT}\n\n${TOOL_GUIDANCE_PROMPT}`,
        messages: [{ role: 'user', content: question }],
        maxTokens: 1200,
        temperature: 0.3,
      })
      result.modelsUsed.push('Thinking Model')
      result.thinking = thinkResult
    }

    // Step 2: Research — pakai hasil pencarian web sungguhan bila useWeb aktif
    let researchQuery
    let web = null
    if (useWeb) {
      web = await fetchWebResearch(question)
      if (web.ok) {
        researchQuery = `Pertanyaan: ${question}\n\nHasil pencarian web (fakta dari sumber):\n${formatWebResults(web.results, web.related)}\n\nJawab langsung pertanyaannya berdasarkan hasil web (bukan ringkasan hasil), dan sebutkan sumbernya.`
      } else {
        researchQuery = `Lakukan riset web tentang: ${question}. Catatan: sumber web tidak tersedia saat ini, jawab sebaik mungkin.`
      }
    } else {
      researchQuery = `Berdasarkan analisa ini:\n${thinkResult}\n\nLakukan research mendalam tentang topik: ${question}`
    }
    const researchResult = await runModelWithTools({
      apiKey: MODELS.research.apiKey(),
      model: MODELS.research.model,
      systemPrompt: `${RESEARCH_PROMPT}\n\n${TOOL_GUIDANCE_PROMPT}`,
      messages: [{ role: 'user', content: researchQuery }],
      maxTokens: 1200,
      temperature: 0.3,
    })
    const sourceBlock = useWeb && web && web.ok ? buildSourceBlock(web.results) : ''
    result.modelsUsed.push('Web Research')
    result.research = researchResult + sourceBlock

    // Step 3: Gabungkan hasil (saat web aktif, riset faktual adalah jawaban utama)
    result.answer = useWeb ? result.research : `${result.thinking}\n\n${result.research}`
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
    const result = await runModelWithTools({
      apiKey: MODELS.thinking.apiKey(),
      model: MODELS.thinking.model,
      systemPrompt: `${THINKING_PROMPT}\n\n${TOOL_GUIDANCE_PROMPT}`,
      messages: [{ role: 'user', content: question }],
      maxTokens: 1200,
      temperature: 0.3,
    })
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
    const result = await runModelWithTools({
      apiKey: MODELS.research.apiKey(),
      model: MODELS.research.model,
      systemPrompt: `${RESEARCH_PROMPT}\n\n${TOOL_GUIDANCE_PROMPT}`,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1200,
      temperature: 0.3,
    })
    const sourceBlock = useWeb && web && web.ok ? buildSourceBlock(web.results) : ''
    return { success: true, content: result + sourceBlock, model: 'Web Research' }
  } catch (err) {
    return { success: false, error: err.message, model: 'Web Research' }
  }
}

export { MODELS }
