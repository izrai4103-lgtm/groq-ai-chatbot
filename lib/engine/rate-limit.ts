import type { RateLimitInfo } from './types'

/* ===== Rate limiter sliding window (TS) — 150 request / menit per IP ===== */
const RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 150,
}

interface Record {
  count: number
  resetAt: number
}

const store = new Map<string, Record>()

export function checkRateLimit(ip: string): RateLimitInfo {
  const now = Date.now()
  const record = store.get(ip) ?? { count: 0, resetAt: now + RATE_LIMIT.windowMs }

  if (now > record.resetAt) {
    record.count = 0
    record.resetAt = now + RATE_LIMIT.windowMs
  }

  record.count++
  store.set(ip, record)

  if (store.size > 1000) {
    const cutoff = now - RATE_LIMIT.windowMs
    for (const [key, val] of store) {
      if (val.resetAt < cutoff) store.delete(key)
    }
  }

  return {
    allowed: record.count <= RATE_LIMIT.maxRequests,
    remaining: Math.max(0, RATE_LIMIT.maxRequests - record.count),
    resetAt: record.resetAt,
  }
}
