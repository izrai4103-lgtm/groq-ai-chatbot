import type { RateLimitInfo } from './types'

/* ===== Rate limiter sliding window (TS) — 150 request / menit per IP =====
 * Selaras dengan engine-go RateLimiter. Digunakan oleh runChat / sandbox.
 */
export const RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 150,
} as const

interface Record {
  count: number
  resetAt: number
}

const store = new Map<string, Record>()

/** Bersihkan entri kedaluwarsa agar memori stabil di edge runtime. */
function cleanup(now: number) {
  if (store.size <= 1000) return
  const cutoff = now - RATE_LIMIT.windowMs
  for (const [key, val] of store) {
    if (val.resetAt < cutoff) store.delete(key)
  }
}

export function checkRateLimit(ip: string): RateLimitInfo {
  const now = Date.now()
  const record = store.get(ip) ?? { count: 0, resetAt: now + RATE_LIMIT.windowMs }

  if (now > record.resetAt) {
    record.count = 0
    record.resetAt = now + RATE_LIMIT.windowMs
  }

  record.count++
  store.set(ip, record)
  cleanup(now)

  return {
    allowed: record.count <= RATE_LIMIT.maxRequests,
    remaining: Math.max(0, RATE_LIMIT.maxRequests - record.count),
    resetAt: record.resetAt,
  }
}

/** Jumlah key aktif di store (monitoring / debug). */
export function rateLimitStoreSize(): number {
  return store.size
}
