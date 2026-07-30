/**
 * 🗣️ Model Conference — 3 AI Models Saling Berbicara
 * 
 * Chat, Thinking, dan Web Research berdiskusi dalam rounds,
 * saling menanggapi, dan menghasilkan kesimpulan bersama.
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
  }
}

// ===== CALL MODEL =====
async function callModel(modelConfig, systemPrompt, messages) {
  const apiKey = modelConfig.apiKey()
  if (!apiKey) {
    throw new SandboxError('MODEL_KEY_MISSING', `API Key ${modelConfig.name} tidak tersedia`)
  }
  
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature: 0.7,
        max_tokens: modelConfig.maxTokens,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new SandboxError('MODEL_ERROR', `${modelConfig.name} error (${res.status})`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err.name === 'AbortError') throw new SandboxError('MODEL_TIMEOUT', `${modelConfig.name} timeout`)
    throw new SandboxError('MODEL_FAIL', `${modelConfig.name} gagal: ${err.message}`)
  } finally {
    clearTimeout(timeout)
  }
}

// ===== DISKUSI MULTI-MODEL =====
export async function holdConference(topic, rounds = 2) {
  const result = {
    topic,
    rounds: [],
    conclusion: '',
    error: null,
    modelsUsed: [],
  }

  const modelOrder = ['chat', 'thinking', 'research']
  const history = {} // Riwayat per model

  try {
    for (let round = 1; round <= rounds; round++) {
      const roundData = { round, responses: [] }

      for (const modelId of modelOrder) {
        const config = PERSONAS[modelId]
        result.modelsUsed.push(config.name)

        // Bangun konteks dari history
        let context = `Topik: ${topic}\n\n`
        context += `Ini adalah ROUND ${round} dari ${rounds} round diskusi.\n\n`

        if (round === 1) {
          context += `Kamu adalah ${config.name}. Berikan pendapat/pemikiranmu tentang topik ini sebagai orang pertama.\n`
          context += `Jangan menyebut dirimu sendiri sebagai "AI" atau "model". Langsung bahas topiknya.\n`
        } else {
          context += `Ini ROUND ${round}. Kamu bisa menanggapi apa yang dikatakan model lain, setuju/tidak setuju, atau menambahkan perspektif baru.\n\n`
          
          // Tambahkan apa yang model lain katakan di round sebelumnya
          for (const [otherId, otherHistory] of Object.entries(history)) {
            if (otherId !== modelId && otherHistory[round - 1]) {
              context += `[${PERSONAS[otherId].name} berkata di round ${round - 1}]:\n${otherHistory[round - 1]}\n\n`
            }
          }
          
          context += `${config.name}, sekarang giliranmu menanggapi di round ${round}:\n`
        }

        const systemPrompt = `${config.personality}\n\n${PERSONAS.chat.personality}\n${PERSONAS.thinking.personality}\n${PERSONAS.research.personality}\n\nKalian sedang diskusi bersama. Jawab sebagai karaktermu sendiri.`

        const response = await callModel(config, systemPrompt, [
          { role: 'user', content: context }
        ])

        // Simpan ke history
        if (!history[modelId]) history[modelId] = {}
        history[modelId][round] = response

        roundData.responses.push({
          model: config.name,
          content: response,
        })
      }

      result.rounds.push(roundData)
    }

    // Final: Sintesis kesimpulan
    const finalModel = PERSONAS.chat
    let synthesisContext = `Topik: ${topic}\n\nBerikut adalah hasil diskusi ${rounds} rounds antara 3 AI:\n\n`
    
    for (const roundData of result.rounds) {
      synthesisContext += `=== ROUND ${roundData.round} ===\n`
      for (const resp of roundData.responses) {
        synthesisContext += `${resp.model}: ${resp.content}\n\n`
      }
    }

    synthesisContext += `Berdasarkan diskusi di atas, buatlah KESIMPULAN AKHIR yang merangkum semua perspektif.`

    const conclusion = await callModel(finalModel,
      `Kamu adalah CHAT, model yang ramah. Tugasmu sekarang adalah merangkum diskusi antara 3 AI (Chat, Thinking, Research) tentang suatu topik menjadi kesimpulan yang padat, jelas, dan mudah dipahami. Gunakan bahasa Indonesia.`,
      [{ role: 'user', content: synthesisContext }]
    )

    result.conclusion = conclusion

  } catch (err) {
    result.error = err instanceof SandboxError ? err.message : `Error: ${err.message}`
  }

  return result
}

export { PERSONAS }
