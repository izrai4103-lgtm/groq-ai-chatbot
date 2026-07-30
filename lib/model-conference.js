/**
 * 🗣️ Model Conference — Semua Model Saling Bicara & Berdiskusi
 * 
 * 4 Groq models (Chat, Thinking, Research, Creative) + Google Search
 * Mereka diskusi bergiliran, saling menanggapi, dan menghasilkan kesimpulan.
 */

import { SandboxError } from './sandbox.js'

// ===== PERSONA =====
const PERSONAS = {
  chat: {
    apiKey: () => process.env.GROQ_API_KEY,
    model: 'llama-3.1-8b-instant',
    maxTokens: 300,
    name: '🗣️ Chat',
    personality: `Kamu adalah CHAT, model yang ramah dan komunikatif. Gaya bicaramu santai, mudah dipahami, dan suka mengajak diskusi.`,
  },
  thinking: {
    apiKey: () => process.env.GROQ_API_KEY_2,
    model: 'llama-3.1-8b-instant',
    maxTokens: 550,
    name: '🧠 Thinking',
    personality: `Kamu adalah THINKING, model analitis dan logis. Gaya bicaramu terstruktur, suka memecah masalah, dan melihat dari berbagai sudut pandang.`,
  },
  research: {
    apiKey: () => process.env.GROQ_API_KEY_3,
    model: 'llama-3.1-8b-instant',
    maxTokens: 550,
    name: '🔍 Research',
    personality: `Kamu adalah RESEARCH, model yang berbasis fakta dan data. Gaya bicaramu informatif, suka memberikan sumber, angka, dan bukti.`,
  },
  creative: {
    apiKey: () => process.env.GROQ_API_KEY_4,
    model: 'llama-3.1-8b-instant',
    maxTokens: 550,
    name: '🎨 Creative',
    personality: `Kamu adalah CREATIVE, model yang imajinatif dan inovatif. Gaya bicaramu unik, suka memberikan perspektif baru, analogi menarik, dan ide-ide out-of-the-box.`,
  },
  gemini: {
    apiKey: () => process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    maxTokens: 1024,
    name: '🌐 Google',
    personality: `Kamu adalah GOOGLE SEARCH, mencari informasi akurat dari web dengan sumber terpercaya.`,
  }
}

// ===== CALL DENGAN RETRY =====
async function callWithRetry(fn, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (err.message?.includes('429') && i < maxRetries) {
        const wait = (i + 1) * 3000
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      throw err
    }
  }
}

// ===== CALL GROQ =====
async function callGroq(config, systemPrompt, messages) {
  const apiKey = config.apiKey()
  if (!apiKey) throw new SandboxError('MODEL_KEY_MISSING', `API Key ${config.name} tidak tersedia`)

  return callWithRetry(async () => {
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
      if (res.status === 429) throw new Error(`429 Rate limited: ${config.name}`)
      if (!res.ok) throw new SandboxError('MODEL_ERROR', `${config.name} error (${res.status})`)
      const data = await res.json()
      return data.choices?.[0]?.message?.content || ''
    } catch (err) {
      if (err instanceof SandboxError) throw err
      if (err.name === 'AbortError') throw new SandboxError('MODEL_TIMEOUT', `${config.name} timeout`)
      throw err // Biar di-retry
    } finally { clearTimeout(timeout) }
  })
}

// ===== CALL GEMINI =====
async function callGemini(config, systemPrompt, messages) {
  const apiKey = config.apiKey()
  if (!apiKey) throw new SandboxError('MODEL_KEY_MISSING', 'API Key Gemini tidak tersedia')
  const lastMsg = messages[messages.length - 1]?.content || ''

  return callWithRetry(async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${lastMsg}` }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: config.maxTokens },
            tools: [{ googleSearch: {} }], // Grounding dengan Google Search
          }),
          signal: controller.signal,
        }
      )
      if (res.status === 429) throw new Error('429 Rate limited: Google')
      if (!res.ok) throw new SandboxError('GEMINI_ERROR', `Google error (${res.status})`)
      const data = await res.json()
      return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } catch (err) {
      if (err instanceof SandboxError) throw err
      if (err.name === 'AbortError') throw new SandboxError('GEMINI_TIMEOUT', 'Google timeout')
      throw err
    } finally { clearTimeout(timeout) }
  })
}

// ===== DISKUSI MULTI-MODEL =====
export async function holdConference(topic, rounds = 2) {
  const result = { topic, rounds: [], conclusion: '', error: null, modelsUsed: [] }
  const modelOrder = ['chat', 'thinking', 'research', 'creative']
  const history = {}
  const erroredModels = new Set()

  try {
    // === FASE 0: Google Search ===
    let webResults = ''
    try {
      webResults = await callGemini(PERSONAS.gemini,
        `Cari informasi terbaru dan akurat tentang "${topic}" dari web. Berikan fakta, data, dan sumber. Bahasa Indonesia.`,
        [{ role: 'user', content: topic }]
      )
      result.modelsUsed.push('🌐 Google Search')
    } catch (err) {
      webResults = `[Google Search: ${err.message}]`
    }

    // === FASE 1-2: Diskusi Bergiliran ===
    for (let round = 1; round <= rounds; round++) {
      const roundData = { round, responses: [] }

      for (const modelId of modelOrder) {
        if (erroredModels.has(modelId)) continue
        const config = PERSONAS[modelId]
        result.modelsUsed.push(config.name)

        // Delay antar model (kecuali yang pertama)
        if (roundData.responses.length > 0 || (result.rounds.length > 0)) {
          await new Promise(r => setTimeout(r, 2000))
        }

        // Bangun konteks diskusi
        let context = `🏁 **Topik:** ${topic}\n\n`
        
        // Sertakan hasil Google Search
        if (webResults) context += `📡 **Web Research:**\n${webResults}\n\n`
        
        // Sertakan history diskusi
        const prevResponses = []
        for (const [otherId, rounds_] of Object.entries(history)) {
          for (const [r, content] of Object.entries(rounds_)) {
            if (parseInt(r) < round || (parseInt(r) === round && otherId !== modelId)) {
              prevResponses.push(`[${PERSONAS[otherId]?.name || otherId} Round ${r}]: ${content}`)
            }
          }
        }
        if (prevResponses.length > 0) {
          context += `📋 **Diskusi sebelumnya:**\n${prevResponses.join('\n\n')}\n\n`
        }

        context += `🎯 **Giliran ${config.name} (Round ${round}):**\n`
        if (round === 1) {
          context += `Berikan pendapat dan analisamu tentang topik ini.`
        } else {
          context += `Tanggapi pendapat model lain, setuju/tidak setuju, atau beri perspektif baru.`
        }

        const allPersonas = Object.values(PERSONAS).slice(0, 4).map(p => p.personality).join('\n')
        const sysPrompt = `${config.personality}\n\nPESAN PENTING: Kamu sedang diskusi dengan:\n${allPersonas}\n\nJawab sebagai karaktermu sendiri secara NATURAL. Bicaralah seperti sedang ngobrol santai dengan teman-teman AI lainnya. Tidak perlu formal. Gunakan bahasa Indonesia.`

        try {
          // Panggil model dengan delay
          const response = await callGroq(config, sysPrompt, [{ role: 'user', content: context }])
          if (!history[modelId]) history[modelId] = {}
          history[modelId][round] = response
          roundData.responses.push({ model: config.name, content: response })
        } catch (err) {
          roundData.responses.push({ model: config.name, content: `[${config.name} tidak bisa hadir: ${err.message}]`, error: true })
          erroredModels.add(modelId)
        }
      }
      result.rounds.push(roundData)
    }

    // === FASE AKHIR: Kesimpulan ===
    let ctx = `🏁 Topik: ${topic}\n\n📡 Web Research:\n${webResults || '-'}\n\n`
    for (const rd of result.rounds) {
      ctx += `\n=== ROUND ${rd.round} ===\n`
      for (const r of rd.responses) ctx += `${r.model}: ${r.content}\n\n`
    }
    ctx += `\nBuat KESIMPULAN AKHIR yang merangkum semua perspektif dari setiap model.`

    let conclusion = ''
    try {
      await new Promise(r => setTimeout(r, 2000))
      conclusion = await callGroq(PERSONAS.chat,
        `Kamu adalah moderator diskusi. Rangkum diskusi multi-AI tentang "${topic}" menjadi kesimpulan yang padat, jelas, dan mencakup semua sudut pandang. Gunakan bahasa Indonesia.`,
        [{ role: 'user', content: ctx }]
      )
    } catch (err) {
      conclusion = `[Kesimpulan tidak tersedia: ${err.message}]`
    }
    result.conclusion = conclusion

  } catch (err) {
    result.error = err instanceof SandboxError ? err.message : `Error: ${err.message}`
  }

  return result
}

export { PERSONAS }
