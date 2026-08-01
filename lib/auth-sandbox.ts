/* ===== AUTH SANDBOX (TS: session tamu terisolasi → localStorage) =====
 * Alur: menu login → AuthSandbox (sanitasi + rate limit + buat session) → localStorage/browser
 */

export type GuestSession = {
  method: 'guest'
  guestId: string
  name: string
  loginAt: number
  expiresAt: number
}

const AUTH_KEY = 'zanco_auth_v1'
const AUTH_RATE_KEY = 'zanco_auth_rate_v1'
const RATE_LIMIT = { windowMs: 60_000, maxLogins: 10 }
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 hari

export function sanitizeGuestName(raw: string): string {
  if (typeof raw !== 'string') return 'Tamu'
  // Buang karakter kontrol (kecuali newline/tab) lalu rapikan spasi
  let clean = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'Tamu'
  return clean.slice(0, 24)
}

type RateRecord = { count: number; resetAt: number }

function readRateRecord(): RateRecord {
  try {
    const raw = localStorage.getItem(AUTH_RATE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RateRecord> | null
      if (parsed && typeof parsed.count === 'number' && typeof parsed.resetAt === 'number') {
        return { count: parsed.count, resetAt: parsed.resetAt }
      }
    }
  } catch { /* abaikan */ }
  return { count: 0, resetAt: Date.now() + RATE_LIMIT.windowMs }
}

function canLogin(): boolean {
  const rec = readRateRecord()
  const now = Date.now()
  if (now > rec.resetAt) return true
  return rec.count < RATE_LIMIT.maxLogins
}

function recordLogin(): void {
  try {
    const now = Date.now()
    const rec = readRateRecord()
    if (now > rec.resetAt) {
      rec.count = 0
      rec.resetAt = now + RATE_LIMIT.windowMs
    }
    rec.count++
    localStorage.setItem(AUTH_RATE_KEY, JSON.stringify(rec))
  } catch { /* abaikan */ }
}

function makeGuestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* abaikan */ }
  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function loadSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GuestSession | null
    if (!parsed || parsed.method !== 'guest' || typeof parsed.expiresAt !== 'number') return null
    if (Date.now() > parsed.expiresAt) {
      clearSession()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveSession(session: GuestSession): void {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(session)) } catch { /* abaikan */ }
}

export function clearSession(): void {
  try { localStorage.removeItem(AUTH_KEY) } catch { /* abaikan */ }
}

export function guestLogin(rawName: string): { session: GuestSession | null; rateLimited: boolean } {
  if (!canLogin()) return { session: null, rateLimited: true }

  const name = sanitizeGuestName(rawName)
  const now = Date.now()
  const session: GuestSession = {
    method: 'guest',
    guestId: makeGuestId(),
    name,
    loginAt: now,
    expiresAt: now + SESSION_TTL_MS,
  }

  recordLogin()
  saveSession(session)
  return { session, rateLimited: false }
}

export function isLoggedIn(session: GuestSession | null): session is GuestSession {
  return !!session && Date.now() <= session.expiresAt
}
