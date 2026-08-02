'use strict'

/**
 * Rotasi & failover kunci API Groq.
 *
 * Groq free tier memberi jatah ~6000 TPM per API key. Dengan memakai
 * beberapa key (GROQ_API_KEY, GROQ_API_KEY_2, _3, _4) secara round-robin
 * dan berpindah key saat kena 429, beban tersebar dan request tetap jalan
 * meski satu key sedang kena batas.
 */

const KEY_ENVS = ['GROQ_API_KEY', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3', 'GROQ_API_KEY_4']

let counter = 0

/**
 * Daftar key yang tersedia di environment (sudah difilter yang kosong).
 * @returns {string[]}
 */
function getGroqKeys() {
  return KEY_ENVS.map((name) => process.env[name]).filter((k) => typeof k === 'string')
}

/** Index key berikutnya secara round-robin (per instance serverless). */
function nextKeyIndex(total) {
  const idx = counter % total
  counter = (counter + 1) % 1_000_000
  return idx
}

module.exports = { getGroqKeys, nextKeyIndex }
