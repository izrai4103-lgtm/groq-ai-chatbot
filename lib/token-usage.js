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

// Kuota token per-user: login (punya guestId) 20k, belum login 10k.
// Direset otomatis setiap 1 menit (window bergulir, sinkron dengan TPM Groq).
const USER_BLOB_PATH = 'groq-user-tokens.json'
const USER_QUOTA_LOGIN = 20000
const USER_QUOTA_GUEST = 10000
const USER_WINDOW_MS = 60 * 1000
const USER_CACHE_MS = 2000

let events = [] // [{ id, bucket, kind, tokens, ts }]
let snapshot = null // { remaining, limit, resetAt, ts }
let seq = 0
let totalRecorded = 0
let totalCompletionRecorded = 0

let userMapCache = null
let userMapCacheTs = 0
let userMapUrl = null
let userMapWriteChain = Promise.resolve()
/** In-memory map — selalu aktif (serverless instance). Blob = sinkron multi-instance. */
let memoryUserMap = Object.create(null)

let blobUrl = null
let blobCache = null // { events, snapshot, ts }
let blobCacheTs = 0
let flushTimer = null
let flushChain = Promise.resolve()

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

export function recordUsage(bucket, kind, tokens, completion) {
  const n = Number(tokens)
  const c = Number(completion)
  if (Number.isFinite(c) && c >= 0) totalCompletionRecorded += c
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
  totalRecorded += n
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
    // Query cache-buster wajib: CDN blob menyimpan salinan lama per URL,
    // jadi URL unik (`cache=0&t=...`) memaksa ambil data terbaru.
    const cacheBust = url.includes('?') ? '&' : '?'
    const fetchUrl = `${url}${cacheBust}cache=0&t=${nowMs()}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    let res
    try {
      res = await fetch(fetchUrl, {
        headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null
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
  // Rantai promise agar beberapa pemicu (timer + route) tidak tumpang tindih,
  // dan pemanggil yang meng-await selalu menunggu write benar-benar selesai.
  const run = async () => {
    try {
      const remote = await readRemote()
      const merged = mergeEvents(remote?.events || [], events)
      events = merged
      await writeRemote({ ts: nowMs(), events: merged, snapshot })
      blobCache = { events: merged, snapshot, ts: nowMs() }
      blobCacheTs = nowMs()
    } catch (e) { /* ignore */ }
  }
  flushChain = flushChain.then(run)
  return flushChain
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

  // Selalu sediakan resetAt (akhir window menit) supaya countdown UI tidak kosong
  if (!resetAt || resetAt <= t) {
    resetAt = Math.ceil((t + 1) / WINDOW_MS) * WINDOW_MS
  }

  const pct = limit > 0 ? remaining / limit : 1
  // Burn rate: token/detik dalam window aktif
  const windowStart = t - WINDOW_MS
  const recent = mergedEvents.filter((e) => e.ts >= windowStart)
  const recentUsed = recent.reduce((s, e) => s + e.tokens, 0)
  const elapsedSec = Math.max(1, (t - (recent.length ? Math.min(...recent.map((e) => e.ts)) : t)) / 1000)
  const burnPerSec = recentUsed / elapsedSec
  const etaSec = burnPerSec > 0 ? Math.round(remaining / burnPerSec) : null

  let urgency = 'ok'
  if (remaining <= 0) urgency = 'empty'
  else if (pct <= 0.1) urgency = 'critical'
  else if (pct <= 0.25) urgency = 'low'
  else if (pct <= 0.5) urgency = 'mid'

  return {
    windowSec: WINDOW_MS / 1000,
    limit,
    used,
    remaining,
    source,
    resetAt,
    perModel,
    pct: Math.round(pct * 1000) / 1000,
    burnPerSec: Math.round(burnPerSec * 10) / 10,
    etaSec,
    urgency,
    serverNow: t,
  }
}

/* ============================================================
 * KUOTA TOKEN PER-USER — login (guestId) 20k/menit, guest 10k/menit.
 * Window tetap per menit kalender (batas menit berikutnya) supaya
 * countdown real-time selalu ada, bahkan sebelum ada pemakaian.
 * In-memory selalu aktif; Blob (opsional) sinkron multi-instance.
 * ============================================================ */

/** Akhir window menit kalender berikutnya (ms epoch). */
function windowEnd(now = nowMs()) {
  return Math.ceil((now + 1) / USER_WINDOW_MS) * USER_WINDOW_MS
}

function isRecValid(rec, now) {
  return (
    rec &&
    typeof rec.used === 'number' &&
    typeof rec.resetAt === 'number' &&
    rec.resetAt > now
  )
}

async function ensureUserMapUrl() {
  if (!blobEnabled()) return null
  if (userMapUrl) return userMapUrl
  try {
    const { list } = await import('@vercel/blob')
    const { blobs } = await list({ prefix: USER_BLOB_PATH, limit: 1 })
    userMapUrl = blobs[0]?.url || null
  } catch (e) { /* ignore */ }
  return userMapUrl
}

async function readUserMap() {
  // Mulai dari memory (cepat + selalu ada)
  const local = { ...memoryUserMap }
  if (!blobEnabled()) return local
  try {
    const url = await ensureUserMapUrl()
    if (!url) return local
    const cacheBust = url.includes('?') ? '&' : '?'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    let res
    try {
      res = await fetch(`${url}${cacheBust}cache=0&t=${nowMs()}`, {
        headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return local
    const txt = await res.text()
    if (!txt) return local
    const remote = JSON.parse(txt)
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return local
    // Gabung: ambil used tertinggi per key dalam window yang sama
    const now = nowMs()
    const merged = { ...remote }
    for (const [k, v] of Object.entries(local)) {
      const r = merged[k]
      if (!isRecValid(v, now)) continue
      if (!isRecValid(r, now) || v.used >= (r.used || 0)) merged[k] = v
    }
    return merged
  } catch (e) { /* ignore */ }
  return local
}

async function writeUserMap(map) {
  memoryUserMap = { ...map }
  userMapCache = map
  userMapCacheTs = nowMs()
  if (!blobEnabled()) return
  try {
    const { put } = await import('@vercel/blob')
    const res = await put(USER_BLOB_PATH, JSON.stringify(map), {
      access: 'private',
      contentType: 'application/json',
      cacheControlMaxAge: 0,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    userMapUrl = res.url
  } catch (e) { /* ignore */ }
}

/** Total token yang pernah tercatat (untuk diff pemakaian per request). */
export function getTotalRecorded() {
  return totalRecorded
}

/** Total token KELUARAN (completion) — dasar kuota per-user. */
export function getCompletionRecorded() {
  return totalCompletionRecorded
}

/**
 * Status kuota seorang user.
 * @param {string} key guestId, atau `ip:<alamat>` untuk yang belum login.
 * @param {boolean} isLoggedIn true = kuota 20k, false = 10k.
 */
function buildUserStatus(rec, isLoggedIn, now) {
  const quota = isLoggedIn ? USER_QUOTA_LOGIN : USER_QUOTA_GUEST
  const end = windowEnd(now)
  if (isRecValid(rec, now)) {
    const remaining = Math.max(0, quota - (rec.used || 0))
    const pct = quota > 0 ? remaining / quota : 1
    return {
      isLoggedIn,
      quota,
      used: rec.used || 0,
      remaining,
      resetAt: rec.resetAt || end,
      serverNow: now,
      pct: Math.round(pct * 1000) / 1000,
      urgency: remaining <= 0 ? 'empty' : pct <= 0.1 ? 'critical' : pct <= 0.25 ? 'low' : pct <= 0.5 ? 'mid' : 'ok',
    }
  }
  return {
    isLoggedIn,
    quota,
    used: 0,
    remaining: quota,
    resetAt: end,
    serverNow: now,
    pct: 1,
    urgency: 'ok',
  }
}

export async function getUserTokenStatus(key, isLoggedIn) {
  const now = nowMs()

  // Memory dulu (instance ini), lalu merge Blob bila ada — pilih used tertinggi di window yang sama
  if (blobEnabled()) {
    try {
      let remote
      if (userMapCache && now - userMapCacheTs <= USER_CACHE_MS) {
        remote = userMapCache
      } else {
        remote = await readUserMap()
        userMapCache = remote
        userMapCacheTs = now
      }
      for (const [k, v] of Object.entries(remote || {})) {
        const local = memoryUserMap[k]
        if (!isRecValid(v, now)) continue
        if (!isRecValid(local, now) || (v.used || 0) >= (local.used || 0)) {
          memoryUserMap[k] = v
        }
      }
    } catch (e) { /* ignore */ }
  }

  const rec = key ? memoryUserMap[key] : null
  return buildUserStatus(rec, isLoggedIn, now)
}

/** Kurangi sisa token user setelah satu request selesai (ditunggu route). */
export async function deductUserTokens(key, isLoggedIn, tokens) {
  const n = Number(tokens)
  if (!Number.isFinite(n) || n <= 0 || !key) return null
  const run = async () => {
    try {
      const now = nowMs()
      const end = windowEnd(now)
      // Mulai dari memory, merge remote jika ada
      let map = { ...memoryUserMap }
      if (blobEnabled()) {
        try {
          const remote = await readUserMap()
          for (const [k, v] of Object.entries(remote || {})) {
            const local = map[k]
            if (!isRecValid(v, now)) continue
            if (!isRecValid(local, now) || (v.used || 0) >= (local.used || 0)) map[k] = v
          }
        } catch (e) { /* ignore */ }
      }
      const rec = map[key]
      const valid = isRecValid(rec, now)
      const resetAt = valid ? (rec.resetAt || end) : end
      const base = valid ? (rec.used || 0) : 0
      map[key] = { used: base + Math.round(n), resetAt }
      // Selalu update memory (meski Blob gagal / tidak ada)
      memoryUserMap = { ...map }
      userMapCache = map
      userMapCacheTs = now
      await writeUserMap(map)
      return buildUserStatus(map[key], isLoggedIn, now)
    } catch (e) {
      // Fallback memory-only
      try {
        const now = nowMs()
        const end = windowEnd(now)
        const rec = memoryUserMap[key]
        const valid = isRecValid(rec, now)
        const resetAt = valid ? (rec.resetAt || end) : end
        const base = valid ? (rec.used || 0) : 0
        memoryUserMap[key] = { used: base + Math.round(n), resetAt }
        return buildUserStatus(memoryUserMap[key], isLoggedIn, now)
      } catch (e2) {
        return null
      }
    }
  }
  userMapWriteChain = userMapWriteChain.then(run, run)
  return userMapWriteChain
}
