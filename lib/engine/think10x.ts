/**
 * Think10x — reasoning stack agar jawaban ~9/10 kualitas ChatGPT
 * meski max_tokens=110 per panggilan.
 *
 * Inspired by GitHub / research:
 * - Chain-of-Thought (Wei et al.)
 * - Self-Consistency (Wang et al.) — majority / best-of-N
 * - Self-Reflection / Reflexion (Shinn et al.)
 * - Tree-of-Thoughts (Yao et al., Princeton) — lightweight 2-branch
 * - agent-reasoning (jasperan) — CoT + SC + reflection
 *
 * Alur: PLAN (110) → BRANCH×2 (110) → CRITIQUE (110) → FINAL+ROG
 * Terintegrasi: sandbox → thinking / chat / research models
 */

import { callGroq } from './groq'
import { generateRolling } from './rolling-output'
import type { ChatMessage, ModelKind } from './types'

const MAX_TOK = 1028

function stripMeta(s: string): string {
  return (s || '')
    .replace(/\[\[(?:LANJUTKAN|SELESAI)\]\]/g, '')
    .replace(/^\s*(PLAN|CABANG|KRITIK|JAWABAN)\s*:\s*/gim, '')
    .trim()
}

/** Deteksi pertanyaan yang butuh reasoning berat */
export function needsDeepThink(text: string): boolean {
  if (!text) return false
  const t = text.trim()
  if (t.length < 12) return false
  return (
    /(mengapa|kenapa|why|bagaimana|how|analisis|analyze|bandingkan|compare|jelaskan|explain|buktikan|prove|strategi|strategy|desain|design|arsitektur|debug|optimasi|optimize|pro.?con|kelebihan|kekurangan|solusi|solution|rencana|plan|evaluasi|evaluate|hitung|calculate|berapa|math|matematika|logika|logic|algoritma)/i.test(
      t,
    ) || t.length > 120
  )
}

async function oneShot(
  kind: ModelKind,
  system: string,
  user: string,
  temperature = 0.4,
): Promise<string> {
  try {
    return await callGroq(
      kind,
      system,
      [{ role: 'user', content: user }],
      { maxTokens: MAX_TOK, temperature, timeoutMs: 30_000 },
    )
  } catch {
    return ''
  }
}

/**
 * Self-Consistency ringan: 2 jalur singkat, pilih yang lebih lengkap/jelas.
 */
async function bestOfTwo(
  kind: ModelKind,
  question: string,
  plan: string,
): Promise<string> {
  const sys =
    'Kamu reasoner. Ikuti rencana. Jawab padat, langkah demi langkah, max 110 token. Bahasa Indonesia kecuali user minta lain.'

  const [a, b] = await Promise.all([
    oneShot(
      kind,
      sys,
      `Rencana:\n${plan}\n\nPertanyaan: ${question}\n\nTulis jawaban jalur A (langkah → kesimpulan).`,
      0.3,
    ),
    oneShot(
      kind,
      sys,
      `Rencana:\n${plan}\n\nPertanyaan: ${question}\n\nTulis jawaban jalur B (sudut berbeda, langkah → kesimpulan).`,
      0.8,
    ),
  ])

  const ca = stripMeta(a)
  const cb = stripMeta(b)
  if (!ca) return cb
  if (!cb) return ca
  // Heuristik: lebih panjang + ada angka/struktur = lebih baik
  const score = (s: string) =>
    s.length +
    (/\d/.test(s) ? 20 : 0) +
    (/(karena|sehingga|jadi|kesimpulan|langkah)/i.test(s) ? 15 : 0) +
    (s.split('\n').length > 2 ? 10 : 0)
  return score(ca) >= score(cb) ? ca : cb
}

/**
 * Self-Reflection: kritik singkat + refine.
 */
async function reflectAndRefine(
  kind: ModelKind,
  question: string,
  draft: string,
): Promise<string> {
  const critique = await oneShot(
    kind,
    'Kamu kritikus. Temukan 1-2 celah (fakta, logika, kelengkapan). Padat, max 110 token. Jangan tulis ulang jawaban penuh.',
    `Pertanyaan: ${question}\n\nDraf:\n${draft}\n\nKritik singkat:`,
    0.2,
  )

  if (!critique.trim()) return draft

  const refined = await oneShot(
    kind,
    'Kamu editor. Perbaiki draf berdasarkan kritik. Jawaban final untuk user, jelas dan lengkap dalam batas token. Bahasa Indonesia.',
    `Pertanyaan: ${question}\n\nDraf:\n${draft}\n\nKritik:\n${critique}\n\nTulis jawaban FINAL yang diperbaiki:`,
    0.35,
  )

  const out = stripMeta(refined)
  return out.length > draft.length * 0.6 ? out : draft
}

export interface Think10xResult {
  content: string
  stages: string[]
  usedDeep: boolean
}

/**
 * Pipeline Think10x untuk pertanyaan kompleks.
 * Tetap hemat token: tiap tahap ≤110, lalu ROG memanjangkan final.
 */
export async function think10x(
  question: string,
  opts: {
    kind?: ModelKind
    priorContext?: string
    force?: boolean
  } = {},
): Promise<Think10xResult> {
  const kind: ModelKind = opts.kind || 'thinking'
  const stages: string[] = []

  if (!opts.force && !needsDeepThink(question)) {
    return { content: '', stages: [], usedDeep: false }
  }

  stages.push('cot-plan')
  const plan = stripMeta(
    await oneShot(
      kind,
      'Kamu perencana. Buat rencana jawaban 3-5 langkah singkat (bullet). Tanpa jawaban akhir. Max 110 token.',
      `${opts.priorContext ? `Konteks:\n${opts.priorContext.slice(0, 500)}\n\n` : ''}Pertanyaan: ${question}\n\nRencana langkah:`,
      0.2,
    ),
  )

  stages.push('self-consistency')
  let draft = await bestOfTwo(kind, question, plan || '1) pahami 2) analisis 3) simpulkan')

  stages.push('self-reflection')
  draft = await reflectAndRefine(kind, question, draft)

  stages.push('rog-expand')
  try {
    const rolled = await generateRolling(
      kind === 'thinking' ? 'chat' : kind,
      'Kamu asisten ahli setara ChatGPT. Lengkapi jawaban agar detail, terstruktur, akurat. Jangan mengarang. Akhiri [[SELESAI]] bila utuh.',
      [
        { role: 'user', content: question },
        { role: 'assistant', content: draft },
        {
          role: 'user',
          content:
            'Lanjutkan dan perjelas poin penting, contoh, dan kesimpulan. Jangan mengulang. Akhiri [[SELESAI]] jika sudah lengkap.',
        },
      ] as ChatMessage[],
      { maxRounds: 2, maxTokens: MAX_TOK, temperature: 0.5 },
    )
    if (rolled.content && rolled.content.length > draft.length) {
      draft = rolled.content
    }
  } catch {
    /* keep draft */
  }

  return {
    content: stripMeta(draft),
    stages,
    usedDeep: true,
  }
}
