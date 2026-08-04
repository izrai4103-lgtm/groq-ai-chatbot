/**
 * 🗣️ Model Conference — Semua Model Saling Bicara & Berdiskusi
 * 
 * 4 Groq models (Chat, Thinking, Research, Creative) + Web Research (Google/Groq)
 */

import { SandboxError } from './sandbox.js'
import { JailbreakScanner, JAILBREAK_POLICY_PROMPT, verdictToError } from './jailbreak-scanner.js'
import { BASE_SYSTEM_PROMPT } from './schema-prompt.js'
import { MATH_TUTOR_PROMPT } from './math-tutor-prompt.js'
import { runModelWithTools, TOOL_GUIDANCE_PROMPT } from './tool-sandbox.js'

// Prompt ringkas untuk hemat kuota TPM (konferensi memanggil model berkali-kali)
const COMPACT_BASE_PROMPT = (() => {
  const s = BASE_SYSTEM_PROMPT
  return s.length <= 1800 ? s : s.slice(0, s.lastIndexOf('\n', 1800))
})()

const jailbreakScanner = new JailbreakScanner()

const PERSONAS = {
  chat: {
    name: '🗣️ Chat',
    role: 'Dalam diskusi kamu menyuarakan sisi ramah, komunikatif, dan mengajak diskusi.',
  },
  thinking: {
    name: '🧠 Thinking',
    role: 'Dalam diskusi kamu menyuarakan sisi analitis, logis, dan terstruktur.',
  },
  research: {
    name: '🔍 Research',
    role: 'Dalam diskusi kamu menyuarakan sisi faktual, berbasis data, dan bukti.',
  },
  creative: {
    name: '🎨 Creative',
    role: 'Dalam diskusi kamu menyuarakan sisi imajinatif, analogi, dan ide out-of-the-box.',
  },
}

// Konferensi memakai fitur 'conference' = key Gemini khusus (bukan berebut key Groq chat).
const CONFERENCE_FEATURE = 'conference'

// ===== WEB RESEARCH (Groq Research) =====
async function webResearch(topic) {
  try {
    const research = await runModelWithTools({
      feature: CONFERENCE_FEATURE,
      systemPrompt: `${COMPACT_BASE_PROMPT}

KEMAMPUAN MATEMATIKA (otak tambahan, terpisah dari identitas utama):
${MATH_TUTOR_PROMPT}

Saat bertugas sebagai mode WEB RESEARCH, kamu berperan seperti mesin pencari. Cari informasi tentang topik ini dan berikan data faktual singkat (maksimal 120 kata), seolah-olah kamu baru saja mencari di internet. Berikan sumber informasi. Bahasa Indonesia.

${TOOL_GUIDANCE_PROMPT}

${JAILBREAK_POLICY_PROMPT}`,
      messages: [{ role: 'user', content: topic }],
      tools: [],
      maxTokens: 250,
      timeoutMs: 30_000,
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
          await new Promise(r => setTimeout(r, 500))

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

        const sysPrompt = `${COMPACT_BASE_PROMPT}\n\n${config.role}\n\nKEMAMPUAN MATEMATIKA (otak tambahan, terpisah dari identitas utama):\n${MATH_TUTOR_PROMPT}\n\nKamu diskusi dengan AI lain. Jawab NATURAL dan RINGKAS (maksimal 120 kata), seperti ngobrol santai. Bahasa Indonesia.\n\n${JAILBREAK_POLICY_PROMPT}`

        try {
          const response = await runModelWithTools({
            feature: CONFERENCE_FEATURE,
            systemPrompt: `${sysPrompt}\n\n${TOOL_GUIDANCE_PROMPT}`,
            messages: [{ role: 'user', content: context }],
            tools: [],
            maxTokens: 250,
            timeoutMs: 30_000,
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
      await new Promise(r => setTimeout(r, 500))
      const conclusion = await runModelWithTools({
        feature: CONFERENCE_FEATURE,
        systemPrompt: `${COMPACT_BASE_PROMPT}\n\nTugasmu sekarang: rangkum diskusi tentang "${topic}" jadi kesimpulan padat, jelas, bahasa Indonesia (maksimal 150 kata).\n\nKEMAMPUAN MATEMATIKA (otak tambahan, terpisah dari identitas utama):\n${MATH_TUTOR_PROMPT}\n\n${TOOL_GUIDANCE_PROMPT}\n\n${JAILBREAK_POLICY_PROMPT}`,
        messages: [{ role: 'user', content: ctx }],
        tools: [],
        maxTokens: 250,
        timeoutMs: 30_000,
        temperature: 0.7,
      })
      result.conclusion = conclusion
    } catch (err) {
      // Fallback: kalau model perangkum gagal, susun kesimpulan dari
      // jawaban diskusi yang berhasil supaya tidak kosong.
      const ok = result.rounds
        .flatMap((rd) => rd.responses)
        .filter((r) => !r.error && r.content)
        .map((r) => r.content)
      result.conclusion = ok.length
        ? 'Rangkuman dari diskusi:\n\n' + ok[ok.length - 1].slice(0, 900)
        : '[Kesimpulan tidak tersedia]'
    }

  } catch (err) {
    result.error = err instanceof SandboxError ? err.message : `Error: ${err.message}`
  }

  return result
}

export { PERSONAS }
