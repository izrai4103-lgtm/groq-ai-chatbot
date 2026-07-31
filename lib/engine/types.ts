/* ===== Tipe dasar mesin AI (TypeScript) ===== */
export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id?: string
  role: Role
  content: string
  streaming?: boolean
}

export type ModelKind = 'chat' | 'thinking' | 'research' | 'creative'

export interface ModelSpec {
  /** Nama env var yang menyimpan API key */
  key: string
  model: string
  maxTokens: number
  name: string
}

export type EngineErrorCode =
  | 'INVALID_INPUT'
  | 'EMPTY_AFTER_SANITIZE'
  | 'CONTENT_BLOCKED'
  | 'JAILBREAK_BLOCKED'
  | 'USER_BANNED'
  | 'RATE_LIMITED'
  | 'AI_MODEL_UNAVAILABLE'
  | 'AI_MODEL_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_UNKNOWN'
  | 'SANDBOX_ERROR'

export interface EngineError {
  code: EngineErrorCode
  message: string
  meta?: unknown
}

export interface RateLimitInfo {
  allowed: boolean
  remaining: number
  resetAt: number
}

export interface EngineMeta {
  rateLimit?: RateLimitInfo
  jailbreak?: unknown
}

export interface EngineResult {
  success: boolean
  content: string | null
  error: EngineError | null
  meta: EngineMeta
}

export interface ScanResult {
  verdict: 'allow' | 'flag' | 'block' | 'banned'
  riskScore: number
  reasons?: string[]
  matchedPatterns?: string[]
}
