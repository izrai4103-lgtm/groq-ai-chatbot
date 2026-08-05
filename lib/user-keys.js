/**
 * BYOK — Bring Your Own Key (Groq)
 * Tiap user (guestId) bisa menyimpan minimal 4 API key Groq untuk rotasi.
 * Disimpan di localStorage browser (client-side).
 */

export const MIN_USER_KEYS = 4
export const MAX_USER_KEYS = 10
const STORAGE_PREFIX = 'zanco_groq_keys_v1:'

export function normalizeGroqKey(raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/\s+/g, '')
}

export function isValidGroqKeyFormat(key) {
  const k = normalizeGroqKey(key)
  // Groq keys biasanya gsk_... ; terima juga key panjang generik
  if (k.length < 20) return false
  if (k.length > 200) return false
  return true
}

export function loadUserKeys(guestId) {
  if (typeof window === 'undefined') return emptySlots()
  try {
    const id = guestId || 'anonymous'
    const raw = localStorage.getItem(STORAGE_PREFIX + id)
    if (!raw) return emptySlots()
    const parsed = JSON.parse(raw)
    const arr = Array.isArray(parsed) ? parsed : []
    const keys = arr
      .map((k) => normalizeGroqKey(k))
      .filter(Boolean)
      .slice(0, MAX_USER_KEYS)
    return padSlots(keys)
  } catch {
    return emptySlots()
  }
}

export function saveUserKeys(guestId, keys) {
  if (typeof window === 'undefined') return false
  try {
    const id = guestId || 'anonymous'
    const cleaned = (Array.isArray(keys) ? keys : [])
      .map((k) => normalizeGroqKey(k))
      .filter((k) => k && isValidGroqKeyFormat(k))
      .slice(0, MAX_USER_KEYS)
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(cleaned))
    return true
  } catch {
    return false
  }
}

export function getActiveUserKeys(guestId) {
  return loadUserKeys(guestId).filter((k) => isValidGroqKeyFormat(k))
}

function emptySlots() {
  return Array.from({ length: MIN_USER_KEYS }, () => '')
}

function padSlots(keys) {
  const out = [...keys]
  while (out.length < MIN_USER_KEYS) out.push('')
  return out.slice(0, Math.max(MIN_USER_KEYS, out.length))
}

/** Validasi array key dari client (server-side). */
export function sanitizeClientKeys(input) {
  if (!Array.isArray(input)) return []
  const out = []
  const seen = new Set()
  for (const item of input) {
    const k = normalizeGroqKey(item)
    if (!isValidGroqKeyFormat(k)) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(k)
    if (out.length >= MAX_USER_KEYS) break
  }
  return out
}
