/**
 * 🗣️ Model Conference — Semua Model Saling Bicara & Berdiskusi
 * 
 * 4 Groq models (Chat, Thinking, Research, Creative) + Web Research (Google/Groq)
 */

import { SandboxError } from './sandbox.js'
import { JailbreakScanner, JAILBREAK_POLICY_PROMPT, verdictToError } from './jailbreak-scanner.js'
import { BASE_SYSTEM_PROMPT } from './schema-prompt.js'
import { runModelWithTools, TOOL_GUIDANCE_PROMPT } from './tool-sandbox.js'

// Prompt ringkas untuk hemat kuota TPM (konferensi memanggil model berkali-kali)
const COMPACT_BASE_PROMPT = (() => {
  const s = BASE_SYSTEM_PROMPT
  return s.length <= 1800 ? s : s.slice(0, s.lastIndexOf('\n', 1800))
})()

const jailbreakScanner = new JailbreakScanner()

const PERSONAS = {
  chat: {
    apiKey: () => process.env.GROQ_API_KEY, model: 'llama-3.1-8b-instant', maxTokens: 160,
    name: '🗣️ Chat',
    role: 'Dalam diskusi kamu menyuarakan sisi ramah, komunikatif, dan mengajak diskusi.',
  },
  thinking: {
    apiKey: () => process.env.GROQ_API_KEY_2, model: 'llama-3.1-8b-instant', maxTokens: 160,
    name: '🧠 Thinking',
    role: 'Dalam diskusi kamu menyuarakan sisi analitis, logis, dan terstruktur.',
  },
  research: {
    apiKey: () => process.env.GROQ_API_KEY_3, model: 'llama-3.1-8b-instant', maxTokens: 160,
    name: '🔍 Research',
    role: 'Dalam diskusi kamu menyuarakan sisi faktual, berbasis data, dan bukti.',
  },
  creative: {
    apiKey: () => process.env.GROQ_API_KEY_4, model: 'llama-3.1-8b-instant', maxTokens: 160,
    name: '🎨 Creative',
    role: 'Dalam diskusi kamu menyuarakan sisi imajinatif, analogi, dan ide out-of-the-box.',
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
    const research = await runModelWithTools({
      apiKey: PERSONAS.research.apiKey(),
      model: PERSONAS.research.model,
      systemPrompt: `${COMPACT_BASE_PROMPT}

Saat bertugas sebagai mode WEB RESEARCH, kamu berperan seperti mesin pencari. Cari informasi tentang topik ini dan berikan data faktual, seolah-olah kamu baru saja mencari di internet. Berikan sumber informasi. Bahasa Indonesia.

${TOOL_GUIDANCE_PROMPT}

${JAILBREAK_POLICY_PROMPT}`,
      messages: [{ role: 'user', content: topic }],
      maxTokens: 160,
      temperature: 0.7,
    })
    return { source: '🔍 Web Research', content: research }
  } catch (err) {
    return { source: null, content: '' }
  }
}

// ===== DISKUSI MULTI-MODEL =====
export async function holdConference(topic, rounds = 2, userId = 'anonymous') {
  const result = { topic, rounds: [], conclusion: '', error: null, modelsUsed: [], blockCode: null }
  const modelOrder = ['chat', 'thinking', 'research', 'creative']
  const history = {}
  const erroredModels = new Set()

  try {
    // Fase 0: Jailbreak scan (sebelum topik masuk ke diskusi model)
    const scan = await jailbreakScanner.scan(topic, userId)
    if (scan.verdict === 'banned' || scan.verdict === 'block') {
      const err = verdictToError(scan)
      result.blockCode = err.code
      result.error = err.message
      return result
    }

    // Fase 1: Web Research
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

        const sysPrompt = `${COMPACT_BASE_PROMPT}\n\n${config.role}\n\nKamu diskusi dengan AI lain. Jawab NATURAL, seperti ngobrol santai. Bahasa Indonesia.\n\n${JAILBREAK_POLICY_PROMPT}`

        try {
          const response = await runModelWithTools({
            apiKey: config.apiKey(),
            model: config.model,
            systemPrompt: `${sysPrompt}\n\n${TOOL_GUIDANCE_PROMPT}`,
            messages: [{ role: 'user', content: context }],
            maxTokens: 160,
            temperature: 0.7,
          })
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
      const conclusion = await runModelWithTools({
        apiKey: PERSONAS.chat.apiKey(),
        model: PERSONAS.chat.model,
        systemPrompt: `${COMPACT_BASE_PROMPT}\n\nTugasmu sekarang: rangkum diskusi tentang "${topic}" jadi kesimpulan padat, jelas, bahasa Indonesia.\n\n${TOOL_GUIDANCE_PROMPT}\n\n${JAILBREAK_POLICY_PROMPT}`,
        messages: [{ role: 'user', content: ctx }],
        maxTokens: 160,
        temperature: 0.7,
      })
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
