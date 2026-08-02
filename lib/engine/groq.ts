import type { ChatMessage, ModelKind, ModelSpec } from './types'

/* ===== Klien Groq (TypeScript) — panggilan model AI dengan timeout ===== */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

export const MODELS: Record<ModelKind, ModelSpec> = {
  chat: { key: 'GROQ_API_KEY', model: 'llama-3.1-8b-instant', maxTokens: 160, name: 'Chat' },
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

export async function callGroq(
  kind: ModelKind,
  systemPrompt: string,
  messages: ChatMessage[],
  options: CallGroqOptions = {},
): Promise<string> {
  const spec = MODELS[kind]
  const apiKey = process.env[spec.key]

  if (!apiKey) {
    throw new EngineError('AI_MODEL_UNAVAILABLE', `Kunci API ${spec.name} tidak tersedia`)
  }

  const temperature = options.temperature ?? 0.7
  const maxTokens = options.maxTokens ?? spec.maxTokens
  const timeoutMs = options.timeoutMs ?? 15_000

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: spec.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new EngineError('AI_MODEL_ERROR', `Model AI error (${res.status})`, {
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
  const apiKey = process.env[spec.key]

  if (!apiKey) {
    throw new EngineError('AI_MODEL_UNAVAILABLE', `Kunci API ${spec.name} tidak tersedia`)
  }

  const temperature = options.temperature ?? 0.7
  const maxTokens = options.maxTokens ?? 1200
  const timeoutMs = options.timeoutMs ?? 60_000

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: spec.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature,
        max_tokens: maxTokens,
        tools,
        tool_choice: 'auto',
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new EngineError('AI_MODEL_ERROR', `Model AI error (${res.status})`, {
        status: res.status,
        detail: detail.slice(0, 500),
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
