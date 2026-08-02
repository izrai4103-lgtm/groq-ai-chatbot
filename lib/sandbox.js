/**
 * 🔒 AI Sandbox — Isolasi & Proteksi Model AI
 * 
 * Fitur:
 * - Rate limiting per IP
 * - Sanitasi & validasi input
 * - Content filter
 * - Isolasi error dari model
 * - Timeout handling
 */

// ===== JAILBREAK SCANNER (deteksi & blokir prompt injection) =====
import { JailbreakScanner, JAILBREAK_POLICY_PROMPT, verdictToError } from './jailbreak-scanner.js'
import { BASE_SYSTEM_PROMPT } from './schema-prompt.js'

const jailbreakScanner = new JailbreakScanner()

// ===== RATE LIMITER =====
const rateStore = new Map()

const RATE_LIMIT = {
  windowMs: 60_000,    // 1 menit
  maxRequests: 150,      // max 150 request per window
}

function getRateLimit(ip) {
  const now = Date.now()
  const record = rateStore.get(ip) || { count: 0, resetAt: now + RATE_LIMIT.windowMs }

  if (now > record.resetAt) {
    record.count = 0
    record.resetAt = now + RATE_LIMIT.windowMs
  }

  record.count++
  rateStore.set(ip, record)

  // Bersihin cache lama setiap 100 request
  if (rateStore.size > 1000) {
    const cutoff = now - RATE_LIMIT.windowMs
    for (const [key, val] of rateStore) {
      if (val.resetAt < cutoff) rateStore.delete(key)
    }
  }

  return {
    allowed: record.count <= RATE_LIMIT.maxRequests,
    remaining: Math.max(0, RATE_LIMIT.maxRequests - record.count),
    resetAt: record.resetAt,
  }
}

// ===== INPUT SANITIZER =====
const MAX_INPUT_LENGTH = 8000
const MAX_MESSAGES = 20

function sanitizeInput(text) {
  if (typeof text !== 'string') return ''
  // Strip kontrol karakter (kecuali newline/tab)
  let clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  // Batasi panjang
  clean = clean.slice(0, MAX_INPUT_LENGTH)
  return clean.trim()
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    return { valid: false, error: 'Messages harus berupa array' }
  }
  if (messages.length === 0) {
    return { valid: false, error: 'Messages tidak boleh kosong' }
  }
  if (messages.length > MAX_MESSAGES) {
    return { valid: false, error: `Maksimal ${MAX_MESSAGES} pesan` }
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') {
      return { valid: false, error: 'Format pesan tidak valid' }
    }
    if (!['user', 'assistant', 'system'].includes(msg.role)) {
      return { valid: false, error: `Role "${msg.role}" tidak dikenal` }
    }
    if (typeof msg.content !== 'string') {
      return { valid: false, error: 'Content harus string' }
    }
    if (msg.content.length > MAX_INPUT_LENGTH) {
      return { valid: false, error: `Pesan terlalu panjang (max ${MAX_INPUT_LENGTH} karakter)` }
    }
  }

  return { valid: true }
}

// ===== CONTENT FILTER =====
const BLOCKED_PATTERNS = [
  /https?:\/\/[^\s]*\.(exe|dll|bat|cmd|msi|sh|scr|pif|vbs|ps1)/i,
]

function filterContent(text) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: 'Konten mencurigakan terdeteksi' }
    }
  }
  return { blocked: false }
}

// ===== MODEL FETCHER (TERISOLASI) =====
async function fetchModel(messages) {
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
  const apiKey = process.env.GROQ_API_KEY

  if (!apiKey) {
    throw new SandboxError('AI_MODEL_UNAVAILABLE', 'Kunci API model tidak tersedia')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000) // 15 detik timeout

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${JAILBREAK_POLICY_PROMPT}` },
          ...messages,
        ],
        temperature: 0.7,
        max_tokens: 160,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new SandboxError(
        'AI_MODEL_ERROR',
        `Model AI error (${res.status})`,
        { status: res.status, detail: errBody }
      )
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''

    if (!content) {
      throw new SandboxError('AI_EMPTY_RESPONSE', 'Model AI mengembalikan respon kosong')
    }

    return { success: true, content }
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err.name === 'AbortError') {
      throw new SandboxError('AI_TIMEOUT', 'Model AI timeout (15 detik)')
    }
    throw new SandboxError('AI_UNKNOWN', 'Gagal menghubungi model AI', { detail: err.message })
  } finally {
    clearTimeout(timeout)
  }
}

// ===== CUSTOM ERROR =====
class SandboxError extends Error {
  constructor(code, message, meta = {}) {
    super(message)
    this.name = 'SandboxError'
    this.code = code
    this.meta = meta
  }
}

// ===== MAIN SANDBOX EXECUTOR =====
export async function executeInSandbox({ messages, ip }) {
  const results = {
    success: false,
    content: null,
    error: null,
    meta: {},
  }

  try {
    // 1. Validasi input
    const validation = validateMessages(messages)
    if (!validation.valid) {
      return { ...results, error: { code: 'INVALID_INPUT', message: validation.error } }
    }

    // 2. Sanitasi
    const sanitized = messages.map(m => ({
      ...m,
      content: sanitizeInput(m.content),
    }))

    // Hapus pesan yang jadi kosong setelah sanitasi
    const filtered = sanitized.filter(m => m.content.length > 0)
    if (filtered.length === 0) {
      return { ...results, error: { code: 'EMPTY_AFTER_SANITIZE', message: 'Pesan kosong setelah filter' } }
    }

    // 3. Content filter
    for (const msg of filtered) {
      const check = filterContent(msg.content)
      if (check.blocked) {
        return { ...results, error: { code: 'CONTENT_BLOCKED', message: check.reason } }
      }
    }

    // 3b. Jailbreak scan (sebelum pesan sampai ke model AI)
    const clientIp = ip || 'anonymous'
    const lastUser = [...filtered].reverse().find(m => m.role === 'user')
    if (lastUser) {
      const scan = await jailbreakScanner.scan(lastUser.content, clientIp)
      if (scan.verdict === 'banned' || scan.verdict === 'block') {
        const err = verdictToError(scan)
        return { ...results, error: { code: err.code, message: err.message, meta: scan } }
      }
      if (scan.verdict === 'flag') {
        results.meta.jailbreak = {
          verdict: scan.verdict,
          riskScore: scan.riskScore,
          reasons: scan.reasons,
          matchedPatterns: scan.matchedPatterns,
        }
      }
    }

    // 4. Rate limit
    const rate = getRateLimit(clientIp)
    results.meta.rateLimit = { remaining: rate.remaining, resetAt: rate.resetAt }

    if (!rate.allowed) {
      return {
        ...results,
        error: {
          code: 'RATE_LIMITED',
          message: `Terlalu banyak request. Tunggu ${Math.ceil((rate.resetAt - Date.now()) / 1000)} detik`,
        }
      }
    }

    // 5. Eksekusi model (terisolasi)
    const modelResult = await fetchModel(filtered)
    results.success = true
    results.content = modelResult.content

  } catch (err) {
    if (err instanceof SandboxError) {
      results.error = { code: err.code, message: err.message }
    } else {
      results.error = { code: 'SANDBOX_ERROR', message: 'Internal sandbox error' }
    }
  }

  return results
}

export { SandboxError }
