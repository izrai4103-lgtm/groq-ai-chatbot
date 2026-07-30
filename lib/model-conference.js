/**
 * 🗣️ Model Conference — Semua Model Saling Bicara & Berdiskusi
 * 
 * 4 Groq models (Chat, Thinking, Research, Creative) + Web Research (Google/Groq)
 */

import { SandboxError } from './sandbox.js'

const PERSONAS = {
  chat: {
    apiKey: () => process.env.GROQ_API_KEY, model: 'llama-3.1-8b-instant', maxTokens: 150,
    name: '🗣️ Chat',
    personality: `Kamu adalah CHAT, model yang ramah dan komunikatif. Gaya bicaramu santai, mudah dipahami, dan suka mengajak diskusi.`,
  },
  thinking: {
    apiKey: () => process.env.GROQ_API_KEY_2, model: 'llama-3.1-8b-instant', maxTokens: 150,
    name: '🧠 Thinking',
    personality: `Kamu adalah THINKING, model analitis dan logis. Gaya bicaramu terstruktur, suka memecah masalah.`,
  },
  research: {
    apiKey: () => process.env.GROQ_API_KEY_3, model: 'llama-3.1-8b-instant', maxTokens: 150,
    name: '🔍 Research',
    personality: `Kamu adalah RESEARCH, model berbasis fakta. Gaya bicaramu informatif, suka memberikan sumber, angka, dan bukti.`,
  },
  creative: {
    apiKey: () => process.env.GROQ_API_KEY_4, model: 'llama-3.1-8b-instant', maxTokens: 150,
    name: '🎨 Creative',
    personality: `Kamu adalah CREATIVE, model imajinatif. Gaya bicaramu unik, suka perspektif baru, analogi, dan ide out-of-the-box.`,
  },
}

// ===== CALL GROQ =====
async function callGroq(config, systemPrompt, messages) {
  const apiKey = config.apiKey()
  if (!apiKey) throw new SandboxError('MODEL_KEY_MISSING', `Key ${config.name} tidak tersedia`)
  
  for (let retry = 0; retry <= 2; retry++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000)
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
      clearTimeout(timeout)
      if (res.status === 429 && retry < 2) { await new Promise(r => setTimeout(r, 3000)); continue }
      if (!res.ok) throw new SandboxError('MODEL_ERROR', `${config.name} error (${res.status})`)
      const data = await res.json()
      return data.choices?.[0]?.message?.content || ''
    } catch (err) {
      if (err instanceof SandboxError) throw err
      if (retry < 2) { await new Promise(r => setTimeout(r, 3000)); continue }
      throw err
    }
  }
}

// ===== WEB RESEARCH (Groq Research) =====
async function webResearch(topic) {
  try {
    const research = await callGroq(PERSONAS.research,
      `Kamu adalah mesin pencari web. Cari informasi tentang topik ini dan berikan data faktual, seolah-olah kamu baru saja mencari di internet. Berikan sumber informasi. Bahasa Indonesia.`,
      [{ role: 'user', content: topic }]
    )
    return { source: '🔍 Web Research', content: research }
  } catch (err) {
    return { source: null, content: '' }
  }
}

// ===== DISKUSI MULTI-MODEL =====
export async function holdConference(topic, rounds = 2) {
  const result = { topic, rounds: [], conclusion: '', error: null, modelsUsed: [] }
  const modelOrder = ['chat', 'thinking', 'research', 'creative']
  const history = {}
  const erroredModels = new Set()

  try {
    // Fase 0: Web Research
    const webResults = await webResearch(topic)
    if (webResults.source) result.modelsUsed.push(webResults.source)

    // Fase 1-2: Diskusi
    for (let round = 1; round <= rounds; round++) {
      const roundData = { round, responses: [] }

      for (const modelId of modelOrder) {
        if (erroredModels.has(modelId)) continue
        const config = PERSONAS[modelId]
        result.modelsUsed.push(config.name)

        if (roundData.responses.length > 0 || round > 1)
          await new Promise(r => setTimeout(r, 2000))

        let context = `🏁 **${topic}**\n\n`
        if (webResults.content) context += `📡 **Web Research (${webResults.source}):**\n${webResults.content}\n\n`
        
        const prev = []
        for (const [oid, rh] of Object.entries(history))
          for (const [r, c] of Object.entries(rh))
            if (parseInt(r) < round || (parseInt(r) === round && oid !== modelId))
              prev.push(`[${PERSONAS[oid]?.name||oid} Round ${r}]: ${c}`)
        if (prev.length) context += `📋 **Diskusi:**\n${prev.join('\n\n')}\n\n`

        context += `🎯 **Giliran ${config.name} Round ${round}:**\n`
        context += round === 1 ? `Berikan pendapatmu tentang topik ini.` : `Tanggapi pendapat model lain.`

        const sysPrompt = `${config.personality}\n\nKamu diskusi dengan AI lain. Jawab NATURAL, seperti ngobrol santai. Bahasa Indonesia.`

        try {
          const response = await callGroq(config, sysPrompt, [{ role: 'user', content: context }])
          if (!history[modelId]) history[modelId] = {}
          history[modelId][round] = response
          roundData.responses.push({ model: config.name, content: response })
        } catch (err) {
          roundData.responses.push({ model: config.name, content: `[${config.name} tidak hadir]`, error: true })
          erroredModels.add(modelId)
        }
      }
      result.rounds.push(roundData)
    }

    // Kesimpulan
    let ctx = `🏁 ${topic}\n\n📡 Web Research:\n${webResults.content || '-'}\n\n`
    for (const rd of result.rounds) {
      ctx += `\n=== ROUND ${rd.round} ===\n`
      for (const r of rd.responses) ctx += `${r.model}: ${r.content}\n\n`
    }
    ctx += `Buat KESIMPULAN AKHIR yang merangkum semua perspektif.`

    try {
      await new Promise(r => setTimeout(r, 2000))
      const conclusion = await callGroq(PERSONAS.chat,
        `Rangkum diskusi tentang "${topic}" jadi kesimpulan padat, jelas, bahasa Indonesia.`,
        [{ role: 'user', content: ctx }]
      )
      result.conclusion = conclusion
    } catch (err) {
      result.conclusion = `[Kesimpulan tidak tersedia]`
    }

  } catch (err) {
    result.error = err instanceof SandboxError ? err.message : `Error: ${err.message}`
  }

  return result
}

export { PERSONAS }
