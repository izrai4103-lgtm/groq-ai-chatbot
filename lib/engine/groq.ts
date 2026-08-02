import type { ChatMessage, ModelKind, ModelSpec } from './types'
import { getGroqKeys } from '../groq-keys'

/* ===== Klien Groq (TypeScript) — panggilan model AI dengan timeout ===== */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

export const MODELS: Record<ModelKind, ModelSpec> = {
  chat: { key: 'GROQ_API_KEY', model: process.env.CHAT_MODEL || 'llama-3.3-70b-versatile', maxTokens: 1000, name: 'Chat' },
  thinking: { key: 'GROQ_API_KEY_2', model: 'llama-3.1-8b-instant', maxTokens: 160, name: 'Thinking' },
  research: { key: 'GROQ_API_KEY_3', model: 'llama-3.1-8b-instant', maxTokens: 160, name: 'Research' },
  creative: { key: 'GROQ_API_KEY_4', model: 'llama-3.1-8b-instant', maxTokens: 160, name: 'Creative' },
  upload: { key: 'GROQ_API_KEY', model: process.env.UPLOAD_MODEL || 'llama-3.3-70b-versatile', maxTokens: 160, name: 'Upload' },
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
 * POST ke Groq dengan failover antar key:
 * - Mulai dari key yang bergiliran (round-robin) supaya beban tersebar.
 * - Saat kena 429/5xx, coba key berikutnya; setelah semua key habis,
 *   tunggu sebentar (hormati Retry-After) lalu coba sekali lagi.
 */
async function fetchGroq(
  body: unknown,
  timeoutMs: number,
  signal: AbortSignal,
  maxAttempts = 8,
): Promise<GroqFetchResult> {
  const keys = getGroqKeys()
  if (keys.length === 0) {
    throw new EngineError('AI_MODEL_UNAVAILABLE', 'Tidak ada kunci API Groq tersedia')
  }

  let lastRes: Response | null = null
  let lastKey = keys[0]

  for (let i = 0; i < maxAttempts; i++) {
    const apiKey = keys[i % keys.length]
    lastKey = apiKey
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    lastRes = res

    if (!RETRYABLE_STATUS.has(res.status)) return { res, apiKey }

    // Pass pertama: langsung pindah key (tiap key punya jatah TPM sendiri).
    // Pass kedua (sudah semua key dicoba): tunggu sebentar sebelum ulang.
    const secondPass = i >= keys.length
    const retryAfter = Number(res.headers.get('retry-after') || 0)
    await sleep(secondPass ? Math.min(retryAfter || 3000, 20_000) : 400)
  }

  return { res: lastRes as Response, apiKey: lastKey }
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
        model: spec.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature,
        max_tokens: maxTokens,
      },
      timeoutMs,
      controller.signal,
    )

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const hint = res.status === 429 ? ' — kuota Groq penuh, coba lagi sebentar' : ''
      throw new EngineError('AI_MODEL_ERROR', `Model AI error (${res.status})${hint}`, {
        status: res.status,
        detail,
      })
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content ?? ''

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
 * TOOL CALLING (function calling ala OpenAI/Groq)
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
  const maxTokens = options.maxTokens ?? 1000
  const timeoutMs = options.timeoutMs ?? 60_000

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const { res, apiKey } = await fetchGroq(
      {
        model: spec.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature,
        max_tokens: maxTokens,
        tools,
        tool_choice: 'auto',
      },
      timeoutMs,
      controller.signal,
    )

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // Retry sekali saat model gagal menghasilkan argumen tool yang valid.
      const isToolFail = res.status === 400 && detail.includes('tool_use_failed')
      if (isToolFail) {
        const retry = await fetchGroq(
          {
            model: spec.model,
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
            temperature: 0.2,
            max_tokens: maxTokens,
            tools,
            tool_choice: 'auto',
          },
          timeoutMs,
          controller.signal,
        )
        if (retry.res.ok) {
          const data2 = await retry.res.json() as {
            choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>
          }
          const m2 = data2.choices?.[0]?.message
          return {
            content: m2?.content ?? '',
            toolCalls: (m2?.tool_calls || []).map(tc => ({
              id: tc.id || '',
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '{}',
            })),
          }
        }
      }
      const detail2 = await res.text().catch(() => '')
      const hint = res.status === 429 ? ' — kuota Groq penuh, coba lagi sebentar' : ''
      throw new EngineError('AI_MODEL_ERROR', `Model AI error (${res.status})${hint}`, {
        status: res.status,
        detail: detail2.slice(0, 500),
      })
    }

    const data = await res.json() as {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }

    const message = data.choices?.[0]?.message
    const content = message?.content ?? ''
    const toolCalls: GroqToolCall[] = (message?.tool_calls || []).map(tc => ({
      id: tc.id || '',
      name: tc.function?.name || '',
      arguments: tc.function?.arguments || '{}',
    }))

    return { content, toolCalls }
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
