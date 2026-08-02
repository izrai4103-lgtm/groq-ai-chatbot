/* ============================================================
 * 🔧 Mesin Utama AI (TypeScript)
 * Pipeline chat lengkap + orkestrasi thinking & conference.
 * Menggantikan jalur utama sebelumnya (lib/sandbox.js) untuk /api/chat.
 * ============================================================ */
import { JailbreakScanner, JAILBREAK_POLICY_PROMPT, verdictToError } from '../jailbreak-scanner'
import { thinkAndResearch } from '../code-executor'
import { holdConference } from '../model-conference'
import { callGroqWithTools, EngineError } from './groq'
import type { GroqToolDefinition, GroqToolMessage } from './groq'
import { AI_TOOLS, TOOL_GUIDANCE_PROMPT, executeTool } from '@/lib/tool-sandbox'
import { BASE_SYSTEM_PROMPT } from '../schema-prompt'
import { checkRateLimit } from './rate-limit'
import type { ChatMessage, EngineErrorCode, EngineResult, ModelKind, ScanResult } from './types'

const jailbreakScanner = new JailbreakScanner()

const MAX_TOOL_ROUNDS = 4

/* ===== Konstanta ===== */
const MAX_INPUT_LENGTH = 8000
const MAX_MESSAGES = 20
const BLOCKED_PATTERNS = [
  /https?:\/\/[^\s]*\.(exe|dll|bat|cmd|msi|sh|scr|pif|vbs|ps1)/i,
]

/* ===== Sanitasi input ===== */
function sanitizeInput(text: string): string {
  const clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  return clean.slice(0, MAX_INPUT_LENGTH).trim()
}

/* ===== Validasi pesan ===== */
function validateMessages(messages: unknown): { valid: true } | { valid: false; error: string } {
  if (!Array.isArray(messages)) return { valid: false, error: 'Messages harus berupa array' }
  if (messages.length === 0) return { valid: false, error: 'Messages tidak boleh kosong' }
  if (messages.length > MAX_MESSAGES) {
    return { valid: false, error: `Maksimal ${MAX_MESSAGES} pesan` }
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') return { valid: false, error: 'Format pesan tidak valid' }
    const m = msg as { role?: unknown; content?: unknown }
    if (!['user', 'assistant', 'system'].includes(String(m.role))) {
      return { valid: false, error: `Role "${String(m.role)}" tidak dikenal` }
    }
    if (typeof m.content !== 'string') return { valid: false, error: 'Content harus string' }
    if (m.content.length > MAX_INPUT_LENGTH) {
      return { valid: false, error: `Pesan terlalu panjang (max ${MAX_INPUT_LENGTH} karakter)` }
    }
  }

  return { valid: true }
}

/* ===== Content filter ===== */
function filterContent(text: string): { blocked: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: 'Konten mencurigakan terdeteksi' }
    }
  }
  return { blocked: false }
}

/* ===== Bungkus error engine ===== */
function err(code: EngineErrorCode, message: string, meta?: unknown): EngineResult {
  return { success: false, content: null, error: { code, message, meta }, meta: {} }
}

function ok(content: string, meta: EngineResult['meta'] = {}): EngineResult {
  return { success: true, content, error: null, meta }
}

/* ============================================================
 * CHAT — pipeline penuh (validasi -> sanitasi -> filter -> scan
 * jailbreak -> rate limit -> panggil model Groq)
 * ============================================================ */
export interface RunChatOptions {
  context?: string
  model?: ModelKind
}

export async function runChat(
  messages: unknown,
  ip: string | undefined,
  context?: string,
  opts: RunChatOptions = {},
): Promise<EngineResult> {
  const clientIp = ip || 'anonymous'

  try {
    // 1. Validasi input
    const validation = validateMessages(messages)
    if (!validation.valid) return err('INVALID_INPUT', validation.error)

    // 2. Sanitasi
    const sanitized = (messages as ChatMessage[]).map(m => ({
      ...m,
      content: sanitizeInput(m.content),
    }))

    // 3. Buang pesan yang jadi kosong
    const filtered = sanitized.filter(m => m.content.length > 0)
    if (filtered.length === 0) {
      return err('EMPTY_AFTER_SANITIZE', 'Pesan kosong setelah filter')
    }

    // 4. Content filter
    for (const msg of filtered) {
      const check = filterContent(msg.content)
      if (check.blocked) return err('CONTENT_BLOCKED', check.reason ?? 'Konten diblokir')
    }

    // 5. Jailbreak scan (sebelum pesan sampai ke model AI)
    const lastUser = [...filtered].reverse().find(m => m.role === 'user')
    const meta: EngineResult['meta'] = {}
    if (lastUser) {
      const scan = await jailbreakScanner.scan(lastUser.content, clientIp) as ScanResult
      if (scan.verdict === 'banned' || scan.verdict === 'block') {
        const scanErr = verdictToError(scan) as { code: EngineErrorCode; message: string }
        return err(scanErr.code, scanErr.message, scan)
      }
      if (scan.verdict === 'flag') {
        meta.jailbreak = {
          verdict: scan.verdict,
          riskScore: scan.riskScore,
          reasons: scan.reasons,
          matchedPatterns: scan.matchedPatterns,
        }
      }
    }

    // 6. Rate limit
    const rate = checkRateLimit(clientIp)
    meta.rateLimit = { allowed: rate.allowed, remaining: rate.remaining, resetAt: rate.resetAt }
    if (!rate.allowed) {
      return err(
        'RATE_LIMITED',
        `Terlalu banyak request. Tunggu ${Math.ceil((rate.resetAt - Date.now()) / 1000)} detik`,
      )
    }

    // 7. Eksekusi model (terisolasi) — system prompt dari schema.json + persona
    //    Alur: sandbox → semua models AI → jailbreak scanner → prompt sistem
    const baseSystem = `${BASE_SYSTEM_PROMPT}\n\n${JAILBREAK_POLICY_PROMPT}`
    const systemPrompt = context
      ? `${baseSystem}\n\n${context}\n\n${TOOL_GUIDANCE_PROMPT}`
      : `${baseSystem}\n\n${TOOL_GUIDANCE_PROMPT}`

    const chatMessages: GroqToolMessage[] = filtered.map(m => ({
      role: m.role,
      content: m.content,
    }))

    let finalContent = ''
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const modelResult = await callGroqWithTools(
        opts.model || 'chat',
        systemPrompt,
        chatMessages,
        AI_TOOLS as GroqToolDefinition[],
      )

      if (modelResult.toolCalls.length === 0) {
        finalContent = modelResult.content
        break
      }

      chatMessages.push({
        role: 'assistant',
        content: modelResult.content || null,
        tool_calls: modelResult.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })

      for (const tc of modelResult.toolCalls) {
        let toolResult: unknown
        try {
          const args = JSON.parse(tc.arguments || '{}') as Record<string, unknown>
          toolResult = await executeTool(tc.name, args)
        } catch (e) {
          toolResult = { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
        chatMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
        })
      }
    }

    return ok(finalContent, meta)
  } catch (e) {
    if (e instanceof EngineError) {
      return err(e.code as EngineErrorCode, e.message, e.meta)
    }
    return err('SANDBOX_ERROR', 'Internal engine error')
  }
}

/* ============================================================
 * THINKING / WEB RESEARCH — validasi + scan, lalu delegasi ke
 * mesin riset (lib/code-executor.js) yang sudah matang.
 * ============================================================ */
export interface ThinkResult {
  blockCode?: string
  error?: string
  thinking?: string
  answer?: string
  research?: string
  [key: string]: unknown
}

export async function runThinking(question: unknown, ip: string | undefined, useWeb = false): Promise<ThinkResult> {
  const clientIp = ip || 'anonymous'
  if (typeof question !== 'string' || question.trim() === '') {
    return { blockCode: 'INVALID_INPUT', error: 'Question diperlukan' }
  }
  if (question.length > MAX_INPUT_LENGTH) {
    return { blockCode: 'INVALID_INPUT', error: 'Pertanyaan terlalu panjang' }
  }

  const scan = await jailbreakScanner.scan(question, clientIp) as ScanResult
  if (scan.verdict === 'banned' || scan.verdict === 'block') {
    const scanErr = verdictToError(scan) as { code: string; message: string }
    return { blockCode: scanErr.code, error: scanErr.message }
  }

  return (await thinkAndResearch(question, clientIp, useWeb)) as unknown as ThinkResult
}

/* ============================================================
 * CONFERENCE — semua model saling berdiskusi.
 * Validasi + scan, lalu delegasi ke lib/model-conference.js.
 * ============================================================ */
export interface ConferenceResult {
  blockCode?: string
  error?: string
  [key: string]: unknown
}

export async function runConference(
  topic: unknown,
  rounds: unknown,
  ip: string | undefined,
): Promise<ConferenceResult> {
  const clientIp = ip || 'anonymous'
  if (typeof topic !== 'string' || topic.trim() === '') {
    return { blockCode: 'INVALID_INPUT', error: 'Topik diperlukan' }
  }
  if (topic.length > MAX_INPUT_LENGTH) {
    return { blockCode: 'INVALID_INPUT', error: 'Topik terlalu panjang' }
  }

  const scan = await jailbreakScanner.scan(topic, clientIp) as ScanResult
  if (scan.verdict === 'banned' || scan.verdict === 'block') {
    const scanErr = verdictToError(scan) as { code: string; message: string }
    return { blockCode: scanErr.code, error: scanErr.message }
  }

  const maxRounds = Math.min(Number(rounds) || 2, 3)
  return (await holdConference(topic, maxRounds, clientIp)) as unknown as ConferenceResult
}
