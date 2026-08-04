'use strict'

/**
 * Registry API Key per fitur — GEMINI SAJA (2026-08).
 *
 * 4 key Gemini dari Google AI Studio:
 *  - GEMINI_API_KEY (Gemini 1)      : bisa memakai gemini-2.5-flash
 *  - GEMINI_API_KEY_2/3/4 (2,3,4)   : hanya gemini-flash-latest
 *
 * Semua fitur memakai key Gemini lewat endpoint OpenAI-compatible.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_FLASH_LATEST = 'gemini-flash-latest'

/** Daftar key per fitur: { env, provider, model? } */
const FEATURE_KEYS = {
  chat: [
    { env: 'GEMINI_API_KEY', provider: 'gemini' },
    { env: 'GEMINI_API_KEY_2', provider: 'gemini', model: GEMINI_FLASH_LATEST },
  ],
  thinking: [
    { env: 'GEMINI_API_KEY_3', provider: 'gemini', model: GEMINI_FLASH_LATEST },
    { env: 'GEMINI_API_KEY_4', provider: 'gemini', model: GEMINI_FLASH_LATEST },
  ],
  research: [
    { env: 'GEMINI_API_KEY', provider: 'gemini' },
    { env: 'GEMINI_API_KEY_2', provider: 'gemini', model: GEMINI_FLASH_LATEST },
  ],
  creative: [
    { env: 'GEMINI_API_KEY_3', provider: 'gemini', model: GEMINI_FLASH_LATEST },
    { env: 'GEMINI_API_KEY_4', provider: 'gemini', model: GEMINI_FLASH_LATEST },
  ],
  upload: [
    { env: 'GEMINI_API_KEY', provider: 'gemini' },
    { env: 'GEMINI_API_KEY_2', provider: 'gemini', model: GEMINI_FLASH_LATEST },
  ],
  conference: [
    { env: 'GEMINI_API_KEY', provider: 'gemini' },
    { env: 'GEMINI_API_KEY_2', provider: 'gemini', model: GEMINI_FLASH_LATEST },
    { env: 'GEMINI_API_KEY_3', provider: 'gemini', model: GEMINI_FLASH_LATEST },
    { env: 'GEMINI_API_KEY_4', provider: 'gemini', model: GEMINI_FLASH_LATEST },
  ],
}

function entryModel(entry) {
  return entry.model || GEMINI_MODEL
}

function entryUrl() {
  return GEMINI_URL
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
  // Fallback: kalau fitur ini belum dikonfigurasi env-nya, pakai key fitur
  // chat supaya fitur tetap berfungsi, bukan daftar kosong.
  if (entries.length === 0 && feature !== 'chat') {
    entries = build(FEATURE_KEYS.chat)
  }
  return entries
}

/** Key default (key pertama fitur) + url/model siap pakai. */
function getDefaultKey(feature = 'chat') {
  const keys = getFeatureKeys(feature)
  return keys[0] || null
}

/** Semua key Gemini yang tersedia (dipakai untuk pemakaian umum/fallback). */
function getGroqKeys() {
  return Object.values(FEATURE_KEYS)
    .flat()
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
  getDefaultKey,
  getGroqKeys,
  nextKeyIndex,
  GROQ_URL,
  GEMINI_URL,
  GEMINI_MODEL,
  GEMINI_FLASH_LATEST,
}
