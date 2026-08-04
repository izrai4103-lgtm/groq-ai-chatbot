/* ===== Tipe dasar mesin AI (TypeScript) ===== */
export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id?: string
  role: Role
  content: string
  streaming?: boolean
}

export type ModelKind = 'chat' | 'thinking' | 'research' | 'creative' | 'upload'

export interface ModelSpec {
  /** Nama fitur pemakai key (chat/thinking/research/creative/upload) */
  feature: string
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
  collaboration?: {
    research: boolean
    thinking: boolean
    creative: boolean
    agents: string[]
  }
  /** Rolling Output Generation (detail walau max_tokens kecil) */
  rog?: { rounds: number; truncated: boolean }
}

export interface EngineResult {
  success: boolean
  content: string | null
  error: EngineError | null
  meta: EngineMeta
  /** Aksi website yang diminta model, dieksekusi oleh frontend di browser. */
  websiteAction?: { name: string; arguments: Record<string, unknown> } | null
}

export interface ScanResult {
  verdict: 'allow' | 'flag' | 'block' | 'banned'
  riskScore: number
  reasons?: string[]
  matchedPatterns?: string[]
}
