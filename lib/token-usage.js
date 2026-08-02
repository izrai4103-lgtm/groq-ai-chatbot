/**
 * 🔋 Token Usage Tracker — estimasi sisa token Groq (kuota per menit).
 *
 * - Mencatat total_tokens dari tiap jawaban model (bucket TPM org dipakai
 *   bersama oleh semua API key).
 * - Mencatat header rate-limit asli Groq saat kena 429
 *   (x-ratelimit-remaining-tokens / x-ratelimit-limit-tokens) sebagai
 *   snapshot paling akurat.
 * - Vercel serverless tidak membagikan memori antar instance, jadi snapshot
 *   juga dipersist ke Vercel Blob (kalau BLOB_READ_WRITE_TOKEN tersedia)
 *   dan digabung saat dibaca.
 */

const WINDOW_MS = 60_000
const DEFAULT_LIMIT = 6000
const BLOB_PATH = 'groq-token-usage.json'
const BLOB_CACHE_MS = 2000

let events = [] // [{ id, bucket, kind, tokens, ts }]
let snapshot = null // { remaining, limit, resetAt, ts }
let seq = 0

let blobUrl = null
let blobCache = null // { events, snapshot, ts }
let blobCacheTs = 0
let flushTimer = null
let flushing = false

const nowMs = () => Date.now()

function prune(list) {
  const t = nowMs()
  return list.filter((e) => t - e.ts < WINDOW_MS)
}

function mergeEvents(a, b) {
  const map = new Map()
  for (const e of [...a, ...b]) map.set(e.id, e)
  return prune([...map.values()]).sort((x, y) => x.ts - y.ts)
}

export function recordUsage(bucket, kind, tokens) {
  const n = Number(tokens)
  if (!Number.isFinite(n) || n <= 0) return
  const ts = nowMs()
  events.push({
    id: `${ts}-${++seq}-${Math.random().toString(36).slice(2, 7)}`,
    bucket,
    kind,
    tokens: n,
    ts,
  })
  events = prune(events)
  scheduleFlush()
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
        ? nowMs() + resetSec * 1000
        : nowMs() + WINDOW_MS,
    ts: nowMs(),
  }
  scheduleFlush()
}

/* ===== Persist ke Vercel Blob (opsional, untuk multi-instance serverless) ===== */
function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

async function ensureBlobUrl() {
  if (!blobEnabled()) return null
  if (blobUrl) return blobUrl
  try {
    const { list } = await import('@vercel/blob')
    const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 })
    blobUrl = blobs[0]?.url || null
  } catch (e) { /* ignore */ }
  return blobUrl
}

async function readRemote() {
  if (!blobEnabled()) return null
  try {
    const url = await ensureBlobUrl()
    if (!url) return null
    const { get } = await import('@vercel/blob')
    const res = await get(url, { access: 'private', timeout: 4000 })
    if (!res || typeof res.text !== 'function') return null
    const txt = await res.text()
    if (!txt) return null
    const parsed = JSON.parse(txt)
    if (parsed && Array.isArray(parsed.events)) return parsed
  } catch (e) { /* ignore */ }
  return null
}

async function writeRemote(data) {
  if (!blobEnabled()) return
  try {
    const { put } = await import('@vercel/blob')
    const res = await put(BLOB_PATH, JSON.stringify(data), {
      access: 'private',
      contentType: 'application/json',
      cacheControlMaxAge: 0,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    blobUrl = res.url
  } catch (e) { /* ignore */ }
}

function scheduleFlush() {
  if (!blobEnabled() || flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, 500)
}

async function flush() {
  if (flushing) return
  flushing = true
  try {
    const remote = await readRemote()
    const merged = mergeEvents(remote?.events || [], events)
    events = merged
    await writeRemote({ ts: nowMs(), events: merged, snapshot })
    blobCache = { events: merged, snapshot, ts: nowMs() }
    blobCacheTs = nowMs()
  } catch (e) { /* ignore */ }
  finally {
    flushing = false
  }
}

export async function flushTokenUsage() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await flush()
}

export async function getTokenUsage() {
  events = prune(events)
  let mergedEvents = events
  let mergedSnapshot = snapshot

  if (blobEnabled()) {
    if (nowMs() - blobCacheTs > BLOB_CACHE_MS) {
      const remote = await readRemote()
      if (remote) {
        mergedEvents = mergeEvents(remote.events || [], events)
        if (remote.snapshot && (!mergedSnapshot || remote.snapshot.ts >= mergedSnapshot.ts)) {
          mergedSnapshot = remote.snapshot
        }
        blobCache = { events: mergedEvents, snapshot: mergedSnapshot, ts: nowMs() }
        blobCacheTs = nowMs()
      }
    } else if (blobCache) {
      mergedEvents = mergeEvents(blobCache.events || [], events)
      mergedSnapshot = blobCache.snapshot || mergedSnapshot
    }
  }

  const t = nowMs()
  const freshSnapshot = mergedSnapshot && t - mergedSnapshot.ts < 90_000
  const limit = freshSnapshot ? mergedSnapshot.limit : DEFAULT_LIMIT
  const used = mergedEvents.reduce((s, e) => s + e.tokens, 0)
  let remaining = Math.max(0, limit - used)
  let source = 'estimate'
  if (freshSnapshot && mergedSnapshot.remaining < remaining) {
    remaining = Math.max(0, Math.floor(mergedSnapshot.remaining))
    source = 'ratelimit'
  }

  // Waktu reset (ms): pakai snapshot 429 kalau masih fresh, kalau tidak
  // pakai momen token tertua keluar dari window 60 detik.
  let resetAt = null
  if (freshSnapshot) {
    resetAt = mergedSnapshot.resetAt
  } else if (mergedEvents.length > 0) {
    const oldest = Math.min(...mergedEvents.map((e) => e.ts))
    resetAt = oldest + WINDOW_MS
  }

  const perModel = {}
  for (const e of mergedEvents) {
    perModel[e.kind] = (perModel[e.kind] || 0) + e.tokens
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
