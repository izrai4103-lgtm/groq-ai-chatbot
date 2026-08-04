import type { ChatMessage, ModelKind, ModelSpec } from './types'
import { getFeatureKeys, nextKeyIndex } from '../provider-keys'
import { recordRateLimit, recordUsage } from '../token-usage'

/* ===== Klien model AI (Groq + Gemini via endpoint OpenAI-compatible) =====
 * Setiap fitur memakai 2 API key khusus miliknya (lihat lib/provider-keys.js),
 * jadi kuota TPM per fitur tidak saling berebut dan 429 jauh lebih jarang.
 */
/** Spesifikasi 4 agent — model aktual diambil dari provider-keys (per API key). */
export const MODELS: Record<ModelKind, ModelSpec> = {
  chat: {
    feature: 'chat',
    model: process.env.CHAT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTokens: 110,
    name: 'Chat',
  },
  research: {
    feature: 'research',
    model: process.env.RESEARCH_MODEL || process.env.GEMINI_FLASH_MODEL || 'gemini-flash-latest',
    maxTokens: 110,
    name: 'Research',
  },
  thinking: {
    feature: 'thinking',
    model: process.env.THINKING_MODEL || process.env.GEMINI_FLASH_MODEL || 'gemini-flash-latest',
    maxTokens: 110,
    name: 'Thinking',
  },
  creative: {
    feature: 'creative',
    model: process.env.CREATIVE_MODEL || process.env.GEMINI_FLASH_MODEL || 'gemini-flash-latest',
    maxTokens: 110,
    name: 'Creative',
  },
  upload: {
    feature: 'upload',
    model: process.env.UPLOAD_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTokens: 110,
    name: 'Upload',
  },
}

export class EngineError extends Error {
  code: string
  meta?: Record<string, unknown>

  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.meta = meta
  }
}

interface CallGroqOptions {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Status yang bisa di-retry dengan key lain / setelah jeda singkat.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

interface GroqFetchResult {
  res: Response
  apiKey: string
}

/**
 * POST ke provider model (Groq/Gemini) dengan failover antar key fitur:
 * - Hanya key milik fitur tersebut yang dipakai (2 key, tidak berebut fitur lain).
 * - Mulai dari key yang bergiliran (round-robin) supaya beban tersebar.
 * - Saat kena 429/5xx, coba key berikutnya; setelah semua key habis,
 *   tunggu sebentar (hormati Retry-After) lalu coba sekali lagi.
 */
async function fetchGroq(
  body: Record<string, unknown>,
  timeoutMs: number,
  signal: AbortSignal,
  feature: string,
): Promise<GroqFetchResult> {
  const keys = getFeatureKeys(feature)
  if (keys.length === 0) {
    throw new EngineError('AI_MODEL_UNAVAILABLE', 'Tidak ada kunci API untuk fitur ini')
  }

  // Mulai dari key yang bergiliran (round-robin + offset menit).
  const minuteOffset = Math.floor(Date.now() / 60_000) % keys.length
  const startIdx = (nextKeyIndex(keys.length) + minuteOffset) % keys.length

  let lastKey = keys[startIdx].key

  const tryKeys = async (): Promise<{ ok: Response | null; failed: Response | null }> => {
    let failed: Response | null = null
    for (let i = 0; i < keys.length; i++) {
      const entry = keys[(startIdx + i) % keys.length]
      lastKey = entry.key
      const res = await fetch(entry.url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${entry.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, model: entry.model }),
        signal,
      })
      if (!RETRYABLE_STATUS.has(res.status)) return { ok: res, failed }
      if (res.status === 429) recordRateLimit(res.headers)
      failed = res
      await sleep(400)
    }
    return { ok: null, failed }
  }

  const first = await tryKeys()
  if (first.ok) return { res: first.ok, apiKey: lastKey }

  // Semua key kena 429/5xx: tunggu reset (hormati Retry-After) lalu coba
  // lagi. Diulang beberapa kali karena bucket TPM bisa baru terisi sebagian.
  let failedRes = first.failed as Response
  for (let attempt = 0; attempt < 3; attempt++) {
    const retryAfter = Number(failedRes.headers.get('retry-after') || 0)
    const resetSec = Number(failedRes.headers.get('x-ratelimit-reset-tokens') || 0)
    const wait = Math.min(Math.max(retryAfter || 0, resetSec || 0, 15_000), 60_000)
    if (wait > 0) await sleep(wait)
    const next = await tryKeys()
    if (next.ok) return { res: next.ok, apiKey: lastKey }
    failedRes = next.failed as Response
  }

  return { res: failedRes, apiKey: lastKey }
}

export async function callGroq(
  kind: ModelKind,
  systemPrompt: string,
  messages: ChatMessage[],
  options: CallGroqOptions = {},
): Promise<string> {
  const spec = MODELS[kind]

  const temperature = options.temperature ?? 0.7
  const maxTokens = options.maxTokens ?? spec.maxTokens
  const timeoutMs = options.timeoutMs ?? 15_000

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const { res } = await fetchGroq(
      {
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature,
        max_tokens: maxTokens,
      },
      timeoutMs,
      controller.signal,
      spec.feature,
    )

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const hint = res.status === 429 ? ' — kuota model penuh, coba lagi sebentar' : ''
      throw new EngineError('AI_MODEL_ERROR', `Model AI error (${res.status})${hint}`, {
        status: res.status,
        detail,
      })
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { total_tokens?: number; completion_tokens?: number }
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    recordUsage(spec.model, kind, data.usage?.total_tokens, data.usage?.completion_tokens)

    if (!content) {
      throw new EngineError('AI_EMPTY_RESPONSE', 'Model AI mengembalikan respon kosong')
    }

    return content
  } catch (err) {
    if (err instanceof EngineError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new EngineError('AI_TIMEOUT', `Model AI timeout (${timeoutMs / 1000} detik)`)
    }
    throw new EngineError('AI_UNKNOWN', 'Gagal menghubungi model AI', {
      detail: err instanceof Error ? err.message : String(err),
    })
  } finally {
    clearTimeout(timeout)
  }
}

/* ============================================================
 * TOOL CALLING (function calling ala OpenAI — Groq & Gemini)
 * Dipakai untuk tool AI tambahan (analyze_website, generate_portfolio_pdf).
 * ============================================================ */

export interface GroqToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface GroqToolCall {
  id: string
  name: string
  arguments: string
}

export interface GroqToolCallResult {
  content: string
  toolCalls: GroqToolCall[]
}

export interface GroqToolMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

export async function callGroqWithTools(
  kind: ModelKind,
  systemPrompt: string,
  messages: GroqToolMessage[],
  tools: GroqToolDefinition[],
  options: CallGroqOptions = {},
): Promise<GroqToolCallResult> {
  const spec = MODELS[kind]

  const temperature = options.temperature ?? 0.7
  const maxTokens = options.maxTokens ?? spec.maxTokens
  const timeoutMs = options.timeoutMs ?? 150_000

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const doFetch = async (temp: number, tokens: number) =>
    fetchGroq(
      {
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: temp,
        max_tokens: tokens,
        tools,
        tool_choice: 'auto',
      },
      timeoutMs,
      controller.signal,
      spec.feature,
    )

  const mapResult = (
    data: {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
        }
        finish_reason?: string
      }>
      usage?: { total_tokens?: number; completion_tokens?: number }
    },
  ): GroqToolCallResult => {
    const message = data.choices?.[0]?.message
    return {
      content: message?.content ?? '',
      toolCalls: (message?.tool_calls || []).map(tc => ({
        id: tc.id || '',
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '{}',
      })),
    }
  }

  try {
    let res = (await doFetch(temperature, maxTokens)).res

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // Retry sekali saat model gagal menghasilkan argumen tool yang valid.
      const isToolFail = res.status === 400 && detail.includes('tool_use_failed')
      if (isToolFail) {
        const retry = await doFetch(0.2, maxTokens)
        if (retry.res.ok) {
          const data2 = await retry.res.json() as Parameters<typeof mapResult>[0]
          recordUsage(spec.model, kind, data2.usage?.total_tokens, data2.usage?.completion_tokens)
          return mapResult(data2)
        }
        const retryDetail = await retry.res.text().catch(() => '')
        console.error('[model] retry tool_use_failed gagal:', retry.res.status, retryDetail.slice(0, 400))
        const hint2 = retry.res.status === 429 ? ' — kuota model penuh, coba lagi sebentar' : ''
        throw new EngineError('AI_MODEL_ERROR', `Model AI error (${retry.res.status})${hint2}`, {
          status: retry.res.status,
          detail: retryDetail.slice(0, 500),
        })
      }
      console.error('[model] panggilan gagal:', res.status, detail.slice(0, 400))
      const hint = res.status === 429 ? ' — kuota model penuh, coba lagi sebentar' : ''
      throw new EngineError('AI_MODEL_ERROR', `Model AI error (${res.status})${hint}`, {
        status: res.status,
        detail: detail.slice(0, 500),
      })
    }

    const data = await res.json() as Parameters<typeof mapResult>[0]
    recordUsage(spec.model, kind, data.usage?.total_tokens, data.usage?.completion_tokens)
    const result = mapResult(data)

    // max_tokens kecil (160) bisa memotong argumen tool. Kalau terpotong /
    // JSON-nya tidak valid / respon kosong, ulangi sekali dengan ruang lebih besar.
    const finishReason = data.choices?.[0]?.finish_reason
    const hasText = result.content.trim().length > 0
    const truncated =
      finishReason === 'length' ||
      (!hasText && result.toolCalls.length === 0) ||
      result.toolCalls.some(tc => {
        try { JSON.parse(tc.arguments); return false } catch { return true }
      })
    if (truncated && maxTokens < 110) {
      const retry = await doFetch(0.2, 2048)
      if (retry.res.ok) {
        const data2 = await retry.res.json() as Parameters<typeof mapResult>[0]
        recordUsage(spec.model, kind, data2.usage?.total_tokens, data2.usage?.completion_tokens)
        return mapResult(data2)
      }
      const escDetail = await retry.res.text().catch(() => '')
      console.error('[model] escalation retry gagal:', retry.res.status, escDetail.slice(0, 400))
    }

    return result
  } catch (err) {
    if (err instanceof EngineError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new EngineError('AI_TIMEOUT', `Model AI timeout (${timeoutMs / 1000} detik)`)
    }
    throw new EngineError('AI_UNKNOWN', 'Gagal menghubungi model AI', {
      detail: err instanceof Error ? err.message : String(err),
    })
  } finally {
    clearTimeout(timeout)
  }
}
