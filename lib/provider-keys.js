
'use strict'

/**
 * Registry API Key — 4 model / 4 tugas / 4 key (Gemini).
 *
 * | Agent     | Env key            | Tugas utama                          |
 * |-----------|--------------------|--------------------------------------|
 * | Chat      | GEMINI_API_KEY     | Jawaban percakapan utama             |
 * | Research  | GEMINI_API_KEY_2   | Riset fakta & ringkas sumber web     |
 * | Thinking  | GEMINI_API_KEY_3   | Analisis mendalam / reasoning        |
 * | Creative  | GEMINI_API_KEY_4   | Penulisan kreatif & poles gaya       |
 *
 * Fallback: jika key utama kosong, coba key chat supaya fitur tidak mati.
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const GEMINI_FLASH_LATEST = process.env.GEMINI_FLASH_MODEL || 'gemini-flash-latest'

/**
 * Satu key utama per agent (+ fallback opsional).
 * model bisa di-override per entry.
 */
const FEATURE_KEYS = {
  // Model 1 — Chat: percakapan cepat & akurat
  chat: [
    { env: 'GEMINI_API_KEY', provider: 'gemini', model: GEMINI_MODEL, role: 'chat' },
    { env: 'GEMINI_API_KEY_2', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'chat-fallback' },
    { env: 'GEMINI_API_KEY_3', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'chat-fallback-3' },
    { env: 'GEMINI_API_KEY_4', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'chat-fallback-4' },
  ],
  // Model 2 — Research: fakta & data web
  research: [
    { env: 'GEMINI_API_KEY_2', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'research' },
    { env: 'GEMINI_API_KEY', provider: 'gemini', model: GEMINI_MODEL, role: 'research-fallback' },
  ],
  // Model 3 — Thinking: reasoning & analisis
  thinking: [
    { env: 'GEMINI_API_KEY_3', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'thinking' },
    { env: 'GEMINI_API_KEY_4', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'thinking-fallback' },
  ],
  // Model 4 — Creative: gaya bahasa & polish
  creative: [
    { env: 'GEMINI_API_KEY_4', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'creative' },
    { env: 'GEMINI_API_KEY_3', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'creative-fallback' },
  ],
  // Upload / vision tetap pakai chat key
  upload: [
    { env: 'GEMINI_API_KEY', provider: 'gemini', model: GEMINI_MODEL, role: 'upload' },
    { env: 'GEMINI_API_KEY_2', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'upload-fallback' },
  ],
  conference: [
    { env: 'GEMINI_API_KEY', provider: 'gemini', model: GEMINI_MODEL, role: 'conf-1' },
    { env: 'GEMINI_API_KEY_2', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'conf-2' },
    { env: 'GEMINI_API_KEY_3', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'conf-3' },
    { env: 'GEMINI_API_KEY_4', provider: 'gemini', model: GEMINI_FLASH_LATEST, role: 'conf-4' },
  ],
}

function entryModel(entry) {
  return entry.model || GEMINI_MODEL
}

function entryUrl() {
  return GEMINI_URL
}


/* ===== BYOK: user Groq keys (request-scoped) ===== */
let _requestUserKeys = []

function setRequestUserKeys(keys) {
  _requestUserKeys = Array.isArray(keys)
    ? keys.filter((k) => typeof k === 'string' && k.trim().length >= 20).map((k) => k.trim())
    : []
}

function getRequestUserKeys() {
  return _requestUserKeys.slice()
}

function clearRequestUserKeys() {
  _requestUserKeys = []
}

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

function buildUserKeyEntries(role = 'chat') {
  return _requestUserKeys.map((key, i) => ({
    env: `USER_GROQ_${i + 1}`,
    key,
    provider: 'groq',
    model: GROQ_MODEL,
    url: GROQ_URL,
    role: `${role}-byok-${i + 1}`,
  }))
}

function getFeatureKeys(feature) {
  // BYOK: utamakan key Groq milik user (min 4 slot diisi user)
  const userEntries = buildUserKeyEntries(feature)
  if (userEntries.length > 0) return userEntries

  const build = (list) =>
    list
      .map((e) => {
        const key = process.env[e.env]
        if (typeof key !== 'string' || key === '') return null
        return {
          env: e.env,
          key,
          provider: e.provider || 'gemini',
          model: entryModel(e),
          url: e.provider === 'groq' ? GROQ_URL : entryUrl(e),
          role: e.role || feature,
        }
      })
      .filter(Boolean)

  const list = FEATURE_KEYS[feature] || FEATURE_KEYS.chat
  let entries = build(list)
  if (entries.length === 0 && feature !== 'chat') {
    entries = build(FEATURE_KEYS.chat)
  }
  return entries
}

function getDefaultKey(feature = 'chat') {
  const keys = getFeatureKeys(feature)
  return keys[0] || null
}

function getGroqKeys() {
  const seen = new Set()
  const out = []
  for (const list of Object.values(FEATURE_KEYS)) {
    for (const e of list) {
      const k = process.env[e.env]
      if (typeof k === 'string' && k && !seen.has(k)) {
        seen.add(k)
        out.push(k)
      }
    }
  }
  return out
}

/** Ringkasan peran agent (untuk meta / debug UI). */
function getAgentRoster() {
  return [
    { id: 'chat', name: 'Chat', env: 'GEMINI_API_KEY', task: 'Jawaban percakapan utama' },
    { id: 'research', name: 'Research', env: 'GEMINI_API_KEY_2', task: 'Riset fakta & sumber web' },
    { id: 'thinking', name: 'Thinking', env: 'GEMINI_API_KEY_3', task: 'Analisis & reasoning mendalam' },
    { id: 'creative', name: 'Creative', env: 'GEMINI_API_KEY_4', task: 'Penulisan kreatif & polish gaya' },
  ]
}

let counter = 0

function nextKeyIndex(total) {
  if (!total || total < 1) return 0
  const idx = counter % total
  counter = (counter + 1) % 1_000_000
  return idx
}

module.exports = {
  setRequestUserKeys,
  getRequestUserKeys,
  clearRequestUserKeys,

  getFeatureKeys,
  getDefaultKey,
  getGroqKeys,
  getAgentRoster,
  nextKeyIndex,
  GROQ_URL,
  GEMINI_URL,
  GEMINI_MODEL,
  GEMINI_FLASH_LATEST,
  FEATURE_KEYS,
}
