'use strict'

/**
 * Registry API Key per fitur — Groq + Gemini.
 *
 * Tiap fitur memakai 2 API key (utama + cadangan) dengan provider bisa
 * berbeda (Groq atau Gemini via endpoint OpenAI-compatible). Dengan
 * memisahkan key per fitur, kuota TPM tiap fitur tidak saling berebut
 * (Groq ~6.000 TPM/key, Gemini punya kuota sendiri).
 *
 * Pemetaan (13 key: 9 Groq + 4 Gemini):
 *  - chat       : GROQ_API_KEY, GROQ_API_KEY_2
 *  - thinking   : GROQ_API_KEY_3, GROQ_API_KEY_4
 *  - research   : GROQ_API_KEY_5, GROQ_API_KEY_6
 *  - creative   : GROQ_API_KEY_7, GROQ_API_KEY_8
 *  - upload     : GROQ_API_KEY_9, GEMINI_API_KEY
 *  - conference : GEMINI_API_KEY_2, GEMINI_API_KEY_3, GEMINI_API_KEY_4
 *
 * Catatan model Gemini: key 1 bisa pakai gemini-2.5-flash, sedangkan
 * key 2/3/4 (akun baru) harus pakai gemini-flash-latest.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

const GROQ_MODEL = 'openai/gpt-oss-120b'
const GEMINI_MODEL = 'gemini-2.5-flash'

/** Daftar key per fitur: { env, provider, model? } */
const FEATURE_KEYS = {
  chat: [
    { env: 'GROQ_API_KEY', provider: 'groq' },
    { env: 'GROQ_API_KEY_2', provider: 'groq' },
  ],
  thinking: [
    { env: 'GROQ_API_KEY_3', provider: 'groq' },
    { env: 'GROQ_API_KEY_4', provider: 'groq' },
  ],
  research: [
    { env: 'GROQ_API_KEY_5', provider: 'groq' },
    { env: 'GROQ_API_KEY_6', provider: 'groq' },
  ],
  creative: [
    { env: 'GROQ_API_KEY_7', provider: 'groq' },
    { env: 'GROQ_API_KEY_8', provider: 'groq' },
  ],
  upload: [
    { env: 'GROQ_API_KEY_9', provider: 'groq' },
    { env: 'GEMINI_API_KEY', provider: 'gemini' },
  ],
  conference: [
    { env: 'GEMINI_API_KEY_2', provider: 'gemini', model: 'gemini-flash-latest' },
    { env: 'GEMINI_API_KEY_3', provider: 'gemini', model: 'gemini-flash-latest' },
    { env: 'GEMINI_API_KEY_4', provider: 'gemini', model: 'gemini-flash-latest' },
  ],
}

function entryModel(entry) {
  if (entry.model) return entry.model
  return entry.provider === 'gemini' ? GEMINI_MODEL : GROQ_MODEL
}

function entryUrl(entry) {
  return entry.provider === 'gemini' ? GEMINI_URL : GROQ_URL
}

/**
 * Resolve daftar key siap pakai untuk sebuah fitur.
 * @param {string} feature nama fitur (chat/thinking/research/creative/upload/conference)
 * @returns {Array<{env:string,key:string,provider:string,model:string,url:string}>}
 */
function getFeatureKeys(feature) {
  const build = (list) =>
    list
      .map((e) => {
        const key = process.env[e.env]
        if (typeof key !== 'string' || key === '') return null
        return { env: e.env, key, provider: e.provider, model: entryModel(e), url: entryUrl(e) }
      })
      .filter(Boolean)

  const list = FEATURE_KEYS[feature] || FEATURE_KEYS.chat
  let entries = build(list)
  // Fallback: kalau fitur ini belum dikonfigurasi env-nya (mis. conference
  // butuh Gemini tapi project hanya punya key Groq), pakai key fitur chat
  // supaya fitur tetap berfungsi, bukan mengembalikan daftar kosong.
  if (entries.length === 0 && feature !== 'chat') {
    entries = build(FEATURE_KEYS.chat)
  }
  return entries
}

/** Semua key Groq yang tersedia (dipakai untuk pemakaian umum/fallback). */
function getGroqKeys() {
  return Object.values(FEATURE_KEYS)
    .flat()
    .filter((e) => e.provider === 'groq')
    .map((e) => process.env[e.env])
    .filter((k) => typeof k === 'string' && k !== '')
}

let counter = 0

/** Index key berikutnya secara round-robin (per instance serverless). */
function nextKeyIndex(total) {
  const idx = counter % total
  counter = (counter + 1) % 1_000_000
  return idx
}

module.exports = {
  getFeatureKeys,
  getGroqKeys,
  nextKeyIndex,
  GROQ_URL,
  GEMINI_URL,
  GROQ_MODEL,
  GEMINI_MODEL,
}
