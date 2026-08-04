/**
 * Rolling Output Generation (ROG) — inspired by:
 * https://github.com/mo-haggag/ROG
 *
 * Dengan max_tokens kecil (110), model sering terpotong.
 * ROG memanggil model berulang kali: "lanjutkan tepat dari sini"
 * lalu menggabungkan potongan jadi jawaban lengkap.
 *
 * Dipakai di sandbox → semua model (chat/thinking/research/creative).
 */

import { callGroq } from './groq'
import type { ChatMessage, ModelKind } from './types'

const DEFAULT_MAX_ROUNDS = 8 // 8 × 110 ≈ 880 token efektif
const CONTINUE_MARKER = '[[LANJUTKAN]]'
const STOP_MARKER = '[[SELESAI]]'

const ROLLING_SYSTEM_SUFFIX = `

[ATURAN OUTPUT BERLANJUT — ROG]
- max_tokens sangat terbatas. Tulis padat, informatif, per bagian.
- Jika jawaban BELUM selesai, akhiri potongan dengan ${CONTINUE_MARKER}
- Jika jawaban SUDAH lengkap, akhiri dengan ${STOP_MARKER}
- Jangan mengulang teks yang sudah ditulis di potongan sebelumnya.
- Jangan jelaskan aturan ini ke user.`

function looksIncomplete(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (t.includes(CONTINUE_MARKER)) return true
  if (t.includes(STOP_MARKER)) return false
  // Kalimat menggantung / tanpa penutup
  if (/[,:;]\s*$/.test(t)) return true
  if (/\b(dan|atau|yaitu|adalah|seperti|misalnya|berikut)\s*$/i.test(t)) return true
  if (/^\s*[-*•]\s+\S+$/m.test(t) && t.split('\n').length < 3) return true
  // Sangat pendek vs permintaan kompleks sering butuh lanjut
  if (t.length < 40) return true
  return false
}

function stripMarkers(text: string): string {
  return text
    .replaceAll(CONTINUE_MARKER, '')
    .replaceAll(STOP_MARKER, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function joinChunks(chunks: string[]): string {
  const cleaned = chunks.map(stripMarkers).filter(Boolean)
  if (cleaned.length === 0) return ''
  let out = cleaned[0]
  for (let i = 1; i < cleaned.length; i++) {
    const prev = out
    const next = cleaned[i]
    // Hindari duplikasi overlap sederhana
    const overlap = Math.min(40, Math.floor(prev.length / 4), next.length)
    let skip = 0
    for (let o = overlap; o >= 12; o--) {
      if (prev.slice(-o) === next.slice(0, o)) {
        skip = o
        break
      }
    }
    const piece = next.slice(skip)
    if (!piece) continue
    const needSpace = !/\s$/.test(out) && !/^\s/.test(piece) && !/^[,.;:!?]/.test(piece)
    out += (needSpace ? ' ' : '') + piece
  }
  return out.trim()
}

export interface RollingOptions {
  maxRounds?: number
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  /** Paksa rolling meski teks terlihat lengkap di round pertama */
  forceMulti?: boolean
}

/**
 * Generate jawaban panjang dengan banyak panggilan max_tokens kecil.
 * Semua model (chat/thinking/research/creative/upload) bisa memakai ini.
 */
export async function generateRolling(
  kind: ModelKind,
  systemPrompt: string,
  messages: ChatMessage[],
  options: RollingOptions = {},
): Promise<{ content: string; rounds: number; truncated: boolean }> {
  const maxRounds = Math.max(1, Math.min(options.maxRounds ?? DEFAULT_MAX_ROUNDS, 12))
  const temperature = options.temperature ?? 0.7
  const maxTokens = options.maxTokens ?? 110
  const timeoutMs = options.timeoutMs ?? 12_000

  const sys = systemPrompt.includes('ROG')
    ? systemPrompt
    : systemPrompt + ROLLING_SYSTEM_SUFFIX

  const history: ChatMessage[] = messages.map((m) => ({ ...m }))
  const chunks: string[] = []
  let truncated = false

  for (let round = 0; round < maxRounds; round++) {
    const promptMessages: ChatMessage[] =
      round === 0
        ? history
        : [
            ...history,
            {
              role: 'assistant',
              content: chunks.join(''),
            },
            {
              role: 'user',
              content:
                `Lanjutkan TEPAT dari akhir teks di atas. Jangan mengulang. ` +
                `Tulis bagian berikutnya saja. Jika sudah selesai, akhiri dengan ${STOP_MARKER}. ` +
                `Jika belum, akhiri dengan ${CONTINUE_MARKER}.`,
            },
          ]

    let piece = ''
    try {
      piece = await callGroq(kind, sys, promptMessages, {
        temperature,
        maxTokens,
        timeoutMs,
      })
    } catch (e) {
      // Round gagal: pakai yang sudah terkumpul
      if (chunks.length > 0) break
      throw e
    }

    if (!piece || !piece.trim()) {
      if (chunks.length > 0) break
      continue
    }

    chunks.push(piece)

    const hasStop = piece.includes(STOP_MARKER)
    const hasCont = piece.includes(CONTINUE_MARKER)
    const incomplete = looksIncomplete(piece)

    if (hasStop) {
      truncated = false
      break
    }
    if (hasCont || incomplete) {
      truncated = true
      continue
    }
    // Selesai natural
    if (round === 0 && options.forceMulti) {
      truncated = true
      continue
    }
    truncated = false
    break
  }

  return {
    content: joinChunks(chunks),
    rounds: chunks.length,
    truncated,
  }
}

/**
 * Versi ringkas: hanya string content (kompatibel callGroq).
 */
export async function callGroqRolling(
  kind: ModelKind,
  systemPrompt: string,
  messages: ChatMessage[],
  options: RollingOptions = {},
): Promise<string> {
  const { content } = await generateRolling(kind, systemPrompt, messages, options)
  return content
}
