/**
 * 🗣️ Model Conference — 4 AI Models + Gemini Web Research
 * 
 * Chat, Thinking, Research, Creative berdiskusi + Gemini untuk web search
 */

import { SandboxError } from './sandbox.js'

// ===== PERSONA MASING-MASING MODEL =====
const PERSONAS = {
  chat: {
    apiKey: () => process.env.GROQ_API_KEY,
    model: 'llama-3.1-8b-instant',
    maxTokens: 300,
    name: '🗣️ Chat',
    personality: `Kamu adalah CHAT, model yang ramah dan komunikatif.
Gaya bicaramu santai, mudah dipahami, dan suka mengajak diskusi.
Kamu berbicara dalam bahasa Indonesia yang natural.`,
  },
  thinking: {
    apiKey: () => process.env.GROQ_API_KEY_2,
    model: 'llama-3.1-8b-instant',
    maxTokens: 550,
    name: '🧠 Thinking',
    personality: `Kamu adalah THINKING, model analitis dan logis.
Gaya bicaramu terstruktur, suka memecah masalah, dan melihat dari berbagai sudut pandang.
Kamu berbicara dalam bahasa Indonesia yang terstruktur.`,
  },
  research: {
    apiKey: () => process.env.GROQ_API_KEY_3,
    model: 'llama-3.1-8b-instant',
    maxTokens: 550,
    name: '🔍 Research',
    personality: `Kamu adalah RESEARCH, model yang berbasis fakta dan data.
Gaya bicaramu informatif, suka memberikan sumber, angka, dan bukti.
Kamu berbicara dalam bahasa Indonesia yang faktual.`,
  },
  creative: {
    apiKey: () => process.env.GROQ_API_KEY_4,
    model: 'llama-3.1-8b-instant',
    maxTokens: 550,
    name: '🎨 Creative',
    personality: `Kamu adalah CREATIVE, model yang imajinatif dan inovatif.
Gaya bicaramu unik, suka memberikan perspektif baru, analogi menarik, dan ide-ide out-of-the-box.
Kamu berbicara dalam bahasa Indonesia yang kreatif.`,
  },
  gemini: {
    apiKey: () => process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    maxTokens: 1024,
    name: '🌐 Google',
    personality: `Kamu adalah GOOGLE SEARCH, model yang melakukan pencarian web secara akurat.
Tugasmu mencari informasi terkini dari internet dan menyajikannya dengan sumber terpercaya.
Gunakan data aktual, statistik, dan referensi dari web.
Kamu berbicara dalam bahasa Indonesia.`,
  }
}

// ===== CALL MODEL GROQ =====
async function callGroq(config, systemPrompt, messages) {
  const apiKey = config.apiKey()
  if (!apiKey) throw new SandboxError('MODEL_KEY_MISSING', `API Key ${config.name} tidak tersedia`)
  
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.7,
        max_tokens: config.maxTokens,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new SandboxError('MODEL_ERROR', `${config.name} error (${res.status})`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err.name === 'AbortError') throw new SandboxError('MODEL_TIMEOUT', `${config.name} timeout`)
    throw new SandboxError('MODEL_FAIL', `${config.name} gagal: ${err.message}`)
  } finally { clearTimeout(timeout) }
}

// ===== CALL MODEL GEMINI =====
async function callGemini(config, systemPrompt, messages) {
  const apiKey = config.apiKey()
  if (!apiKey) throw new SandboxError('MODEL_KEY_MISSING', 'API Key Gemini tidak tersedia')

  const lastMsg = messages[messages.length - 1]?.content || ''
  
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: `${systemPrompt}\n\n${lastMsg}` }]
          }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: config.maxTokens,
          },
          // Grounding dengan Google Search
          tools: [{ googleSearch: {} }],
        }),
        signal: controller.signal,
      }
    )
    if (!res.ok) {
      const errText = await res.text()
      throw new SandboxError('GEMINI_ERROR', `Google error (${res.status})`)
    }
    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err.name === 'AbortError') throw new SandboxError('GEMINI_TIMEOUT', 'Google timeout')
    throw new SandboxError('GEMINI_FAIL', `Google gagal: ${err.message}`)
  } finally { clearTimeout(timeout) }
}

// ===== DISKUSI MULTI-MODEL =====
export async function holdConference(topic, rounds = 2) {
  const result = { topic, rounds: [], conclusion: '', error: null, modelsUsed: [] }
  const modelOrder = ['chat', 'thinking', 'research', 'creative']
  const history = {}
  const skippedModels = new Set()

  try {
    // Research dulu via Gemini/Google (grounding search)
    let webResults = ''
    try {
      const geminiConfig = PERSONAS.gemini
      webResults = await callGemini(geminiConfig,
        `Cari informasi terbaru dan akurat tentang topik ini dari web. Berikan fakta, data, dan sumber. Gunakan bahasa Indonesia.`,
        [{ role: 'user', content: topic }]
      )
      result.modelsUsed.push('🌐 Google Search')
    } catch (err) {
      webResults = `[Google Search tidak tersedia: ${err.message}]`
    }

    for (let round = 1; round <= rounds; round++) {
      const roundData = { round, responses: [] }

      for (const modelId of modelOrder) {
        if (skippedModels.has(modelId)) continue
        
        const config = PERSONAS[modelId]
        result.modelsUsed.push(config.name)

        let context = `Topik: ${topic}\n\n`
        context += `Ini ROUND ${round} dari ${rounds}.\n\n`
        
        // Sertakan hasil web research di round 1
        if (round === 1 && webResults) {
          context += `📡 **Hasil Google Search:**\n${webResults}\n\n`
        }

        if (round === 1) {
          context += `${config.name}, berikan pendapatmu sebagai orang pertama berdasarkan data di atas.\n`
        } else {
          context += `Tanggapi diskusi sebelumnya, setuju/tidak setuju, atau tambah perspektif baru.\n\n`
          for (const [otherId, otherHistory] of Object.entries(history)) {
            if (otherId !== modelId && otherHistory[round - 1]) {
              context += `[${PERSONAS[otherId]?.name || otherId} round ${round - 1}]:\n${otherHistory[round - 1]}\n\n`
            }
          }
        }

        const allPersonalities = Object.values(PERSONAS).map(p => p.personality).join('\n')
        const sysPrompt = `${config.personality}\n\n${allPersonalities}\n\nKalian diskusi bersama. Jawab sebagai karaktermu.`

        // Delay antar panggilan
        if (roundData.responses.length > 0) await new Promise(r => setTimeout(r, 1500))

        try {
          const response = await callGroq(config, sysPrompt, [{ role: 'user', content: context }])
        if (!history[modelId]) history[modelId] = {}
          history[modelId][round] = response
          roundData.responses.push({ model: config.name, content: response })
        } catch (err) {
          roundData.responses.push({ model: config.name, content: `[${config.name} tidak merespon: ${err.message}]`, error: true })
          skippedModels.add(modelId)
        }
      }
      result.rounds.push(roundData)
    }

    // Kesimpulan akhir
    let ctx = `Topik: ${topic}\n\nWeb Research:\n${webResults}\n\nDiskusi:\n`
    for (const rd of result.rounds) {
      ctx += `=== ROUND ${rd.round} ===\n`
      for (const r of rd.responses) ctx += `${r.model}: ${r.content}\n\n`
    }
    ctx += `Buat KESIMPULAN AKHIR yang merangkum semua perspektif.`

    const conclusion = await callGroq(PERSONAS.chat,
      `Rangkum diskusi multi-AI tentang ${topic} jadi kesimpulan padat, jelas, bahasa Indonesia.`,
      [{ role: 'user', content: ctx }]
    )
    result.conclusion = conclusion

  } catch (err) {
    result.error = err instanceof SandboxError ? err.message : `Error: ${err.message}`
  }

  return result
}

export { PERSONAS }
