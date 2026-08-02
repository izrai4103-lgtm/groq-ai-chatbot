/**
 * 🔋 Token Usage Tracker — estimasi sisa token Groq (kuota per menit).
 *
 * - Mencatat total_tokens dari tiap jawaban model (bucket TPM org dipakai
 *   bersama oleh semua API key).
 * - Mencatat header rate-limit asli Groq saat kena 429
 *   (x-ratelimit-remaining-tokens / x-ratelimit-limit-tokens) sebagai
 *   snapshot paling akurat.
 * - getTokenUsage() menghitung window geser 60 detik vs limit
 *   (default 6000 TPM untuk llama-3.1-8b-instant).
 */

const WINDOW_MS = 60_000
const DEFAULT_LIMIT = 6000

let events = [] // [{ bucket, kind, tokens, ts }]
let snapshot = null // { remaining, limit, resetAt, ts }

function prune() {
  const now = Date.now()
  events = events.filter((e) => now - e.ts < WINDOW_MS)
}

export function recordUsage(bucket, kind, tokens) {
  const n = Number(tokens)
  if (!Number.isFinite(n) || n <= 0) return
  events.push({ bucket, kind, tokens: n, ts: Date.now() })
  prune()
}

export function recordRateLimit(headers) {
  const remaining = Number(headers.get('x-ratelimit-remaining-tokens'))
  const limit = Number(headers.get('x-ratelimit-limit-tokens'))
  const resetSec = Number(headers.get('x-ratelimit-reset-tokens'))
  if (!Number.isFinite(remaining) || remaining < 0) return
  snapshot = {
    remaining,
    limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
    resetAt:
      Number.isFinite(resetSec) && resetSec > 0
        ? Date.now() + resetSec * 1000
        : Date.now() + WINDOW_MS,
    ts: Date.now(),
  }
}

export function getTokenUsage() {
  prune()
  const now = Date.now()
  const snapshotFresh = snapshot && now - snapshot.ts < 90_000
  const limit = snapshotFresh ? snapshot.limit : DEFAULT_LIMIT
  const used = events.reduce((s, e) => s + e.tokens, 0)
  let remaining = Math.max(0, limit - used)
  let source = 'estimate'
  if (snapshotFresh && snapshot.remaining < remaining) {
    remaining = Math.max(0, Math.floor(snapshot.remaining))
    source = 'ratelimit'
  }
  const perModel = {}
  for (const e of events) {
    perModel[e.kind] = (perModel[e.kind] || 0) + e.tokens
  }
  // Waktu reset (ms): pakai snapshot 429 kalau masih fresh, kalau tidak
  // pakai momen token tertua keluar dari window 60 detik.
  let resetAt = null
  if (snapshotFresh) {
    resetAt = snapshot.resetAt
  } else if (events.length > 0) {
    const oldest = Math.min(...events.map((e) => e.ts))
    resetAt = oldest + WINDOW_MS
  }
  return {
    windowSec: WINDOW_MS / 1000,
    limit,
    used,
    remaining,
    source,
    resetAt,
    perModel,
  }
}
