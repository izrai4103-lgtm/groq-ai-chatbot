/**
 * Claude-style real-time research synthesis
 * Inspired by: webfetch, MindSearch, mcp-searxng, jina reader
 *
 * Tujuan: kualitas riset ~9/10 Claude.ai meski max_tokens=110
 * Alur: multi-source evidence → compact digest → multi-hop refine → ROG
 */

import { callGroq } from './groq'
import { generateRolling } from './rolling-output'
import type { ModelKind } from './types'

const MAX_TOK = 250

function strip(s: string): string {
  return (s || '')
    .replace(/\[\[(?:LANJUTKAN|SELESAI)\]\]/g, '')
    .trim()
}

/**
 * Sintesis bukti web jadi insight padat + lengkap (multi-round @110).
 */
export async function synthesizeClaudeResearch(
  question: string,
  evidenceText: string,
  kind: ModelKind = 'research',
): Promise<{ insight: string; hops: number }> {
  if (!evidenceText || evidenceText.length < 40) {
    return { insight: '', hops: 0 }
  }

  // Hop 1: ekstrak fakta kunci
  let facts = ''
  try {
    facts = await callGroq(
      kind,
      'Kamu researcher setara Claude. Ekstrak 4-6 fakta kunci dari bukti web. Cantumkan sumber singkat. Padat, max 110 token. Bahasa Indonesia.',
      [
        {
          role: 'user',
          content: `Pertanyaan: ${question}\n\nBukti:\n${evidenceText.slice(0, 3500)}\n\nFakta kunci:`,
        },
      ],
      { maxTokens: MAX_TOK, temperature: 0.2, timeoutMs: 30_000 },
    )
  } catch {
    facts = ''
  }

  // Hop 2: jawab berdasarkan fakta
  let answer = ''
  try {
    answer = await callGroq(
      kind,
      'Kamu researcher setara Claude.ai. Jawab pertanyaan HANYA dari fakta yang diberikan. Sebut sumber. Jujur jika data kurang. Max 110 token.',
      [
        {
          role: 'user',
          content: `Pertanyaan: ${question}\n\nFakta:\n${strip(facts) || evidenceText.slice(0, 1500)}\n\nJawaban:`,
        },
      ],
      { maxTokens: MAX_TOK, temperature: 0.3, timeoutMs: 30_000 },
    )
  } catch {
    answer = facts
  }

  let out = strip(answer) || strip(facts)
  if (!out) return { insight: '', hops: 0 }

  // Hop 3: ROG expand hanya jika masih pendek
  if (out.length >= 120) return { insight: out, hops: 2 }
  try {
    const rolled = await generateRolling(
      kind,
      'Lengkapi jawaban riset agar detail seperti Claude: struktur jelas, sumber, catatan ketidakpastian. Akhiri [[SELESAI]] bila utuh.',
      [
        { role: 'user', content: question },
        { role: 'assistant', content: out },
        {
          role: 'user',
          content:
            'Perjelas dengan detail dari fakta, tambah konteks, sebut sumber. Jangan mengarang. Akhiri [[SELESAI]].',
        },
      ],
      { maxRounds: 2, maxTokens: MAX_TOK, temperature: 0.4 },
    )
    if (rolled.content && rolled.content.length > out.length) {
      out = strip(rolled.content)
    }
  } catch {
    /* keep out */
  }

  return { insight: out, hops: 3 }
}
