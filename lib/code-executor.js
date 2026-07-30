/**
 * 🧠 Thinker & Researcher — Model AI untuk Thinking + Web Research
 * 
 * - Thinking Model: menganalisa, merencanakan, dan berpikir sebelum menjawab
 * - Web Research Model: mencari informasi dan memberikan data faktual
 */

import { SandboxError } from './sandbox.js'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// ===== KONFIGURASI MODEL =====
const MODELS = {
  thinking: {
    apiKey: () => process.env.GROQ_API_KEY_2,
    model: 'llama-3.1-8b-instant',
    maxTokens: 150,
    label: 'Thinking Model',
  },
  research: {
    apiKey: () => process.env.GROQ_API_KEY_3,
    model: 'llama-3.1-8b-instant',
    maxTokens: 150,
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
    if (!res.ok) throw new SandboxError('MODEL_ERROR', `${modelConfig.label} error (${res.status})`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err.name === 'AbortError') throw new SandboxError('MODEL_TIMEOUT', `${modelConfig.label} timeout`)
    throw new SandboxError('MODEL_FAIL', `${modelConfig.label} gagal: ${err.message}`)
  } finally { clearTimeout(timeout) }
}

// ===== THINKING PROMPT =====
const THINKING_PROMPT = `Kamu adalah Thinking Model AI. Tugasmu:

1. ANALISA pertanyaan user secara mendalam
2. PECAH masalah menjadi langkah-langkah logis
3. Identifikasi pola, koneksi, dan implikasi
4. Beri reasoning yang jelas dan terstruktur
5. Simpulkan dengan jawaban yang akurat

Gunakan format berikut:
🧠 **Analisis:** (analisa mendalam)
📋 **Langkah:** (langkah-langkah solusi)
💡 **Kesimpulan:** (jawaban akhir)`

// ===== WEB RESEARCH PROMPT =====
const RESEARCH_PROMPT = `Kamu adalah Web Research AI. Tugasmu mencari dan menyajikan informasi.

1. Berikan informasi faktual dan akurat
2. Sertakan data, statistik, dan fakta spesifik
3. Sebutkan sumber informasi (nama website/organisasi)
4. Bedakan antara fakta dan opini
5. Jika info tidak pasti, akui keterbatasan

Gunakan format berikut:
🔍 **Hasil Research:** (informasi yang ditemukan)
📊 **Data & Fakta:** (detail spesifik)
🔗 **Sumber:** (referensi informasi)`

// ===== THINKING + RESEARCH PIPELINE =====
export async function thinkAndResearch(question) {
  const result = {
    thinking: '',
    research: '',
    answer: '',
    error: null,
    modelsUsed: [],
  }

  try {
    // Step 1: Thinking dulu
    const thinkResult = await callModel(MODELS.thinking, THINKING_PROMPT, question)
    result.modelsUsed.push('Thinking Model')
    result.thinking = thinkResult

    // Step 2: Research berdasarkan hasil thinking
    const researchQuery = `Berdasarkan analisa ini:\n${thinkResult}\n\nLakukan research mendalam tentang topik: ${question}`
    const researchResult = await callModel(MODELS.research, RESEARCH_PROMPT, researchQuery)
    result.modelsUsed.push('Web Research')
    result.research = researchResult

    // Step 3: Gabungkan hasil
    result.answer = `${result.thinking}\n\n${result.research}`
    result.error = null

  } catch (err) {
    result.error = err instanceof SandboxError ? err.message : `Error: ${err.message}`
  }

  return result
}

// ===== SINGLE MODEL CALLS (untuk penggunaan terpisah) =====
export async function think(question) {
  try {
    const result = await callModel(MODELS.thinking, THINKING_PROMPT, question)
    return { success: true, content: result, model: 'Thinking Model' }
  } catch (err) {
    return { success: false, error: err.message, model: 'Thinking Model' }
  }
}

export async function research(query) {
  try {
    const result = await callModel(MODELS.research, RESEARCH_PROMPT, query)
    return { success: true, content: result, model: 'Web Research' }
  } catch (err) {
    return { success: false, error: err.message, model: 'Web Research' }
  }
}

export { MODELS }
