/* ============================================================
 * 🔧 Mesin Utama AI (TypeScript)
 * Pipeline chat: semua model saling bicara (multi-model collaboration).
 * Setiap request chat otomatis melibatkan semua key/model:
 *   1. Chat (key 1-2): jawab langsung
 *   2. Research (key 5-6): cari data web jika perlu
 *   3. Thinking (key 3-4): analisis mendalam
 *   4. Creative (key 7-8): polish & enrich jawaban
 *   5. Upload (key 9 + Gemini 1): proses file
 *   6. Conference (Gemini 2-4): multi-AI diskusi
 * ============================================================ */
import { JailbreakScanner, JAILBREAK_POLICY_PROMPT, verdictToError } from '../jailbreak-scanner'
import { thinkAndResearch } from '../code-executor'
import { holdConference } from '../model-conference'
import { callGroqWithTools, EngineError } from './groq'
import { generateRolling } from './rolling-output'
import type { GroqToolDefinition, GroqToolMessage } from './groq'
import { AI_TOOLS, TOOL_GUIDANCE_PROMPT, executeTool } from '@/lib/tool-sandbox'
import { BASE_SYSTEM_PROMPT } from '../schema-prompt'
import { MATH_TUTOR_PROMPT } from '../math-tutor-prompt'
import { checkRateLimit } from './rate-limit'
import { WEBSITE_CONTROL_PROMPT, WEBSITE_TOOLS, WEBSITE_TOOL_NAMES } from '../website-control'
import { fetchWebResearch } from '../web-research'
import type { ChatMessage, EngineErrorCode, EngineResult, ModelKind, ScanResult } from './types'

const jailbreakScanner = new JailbreakScanner()

const MAX_TOOL_ROUNDS = 6

function normalizeOutput(s: string): string {
  if (!s) return ''
  return s
    .replace(/[\u00a0\u2000-\u200b\u200c\u200d\ufeff\u2060\u3000\t]+/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/\n +/g, '\n')
    .replace(/ +\n/g, '\n')
    .trim()
}

function isPathological(s: string, normalized: string): boolean {
  if (!s) return true
  const ratio = 1 - normalized.length / s.length
  return ratio > 0.6 && normalized.length < 120
}

const TOOL_INTENT_RE =
  /(portofolio|portfolio|pdf|profil|cv|resume|analis.{0,20}(situs|website|url|web)|(situs|website|url|web).{0,20}analis|buatkan.{0,30}(portofolio|pdf)|https?:\/\/)/i
function hasToolIntent(text: string): boolean {
  return TOOL_INTENT_RE.test(text)
}

/* Deteksi apakah pertanyaan butuh riset web */
const RESEARCH_INTENT_RE =
  /(siapa|apa itu|kapan|dimana|berapa|bagaimana|mengapa|kenapa|berita|terbaru|latest|news|update|harga|price|cuaca|weather|kurs|statistik|data |fakta|sejarah|who is|what is|when|where|how much|how many|why|search|cari|find|explain|jelaskan)/i
function needsResearch(text: string): boolean {
  return RESEARCH_INTENT_RE.test(text)
}

/* Deteksi apakah pertanyaan butuh pemikiran mendalam */
const THINKING_INTENT_RE =
  /(analisis|analyze|bandingkan|compare|evaluasi|evaluate|pro.?con|kelebihan.?kekurangan|strategi|strategy|solusi|solution|rencana|plan|pikirkan|think|review|debug|optimasi|optimize|arsitektur|architecture|desain sistem|system design|algoritma|algorithm)/i
function needsThinking(text: string): boolean {
  return THINKING_INTENT_RE.test(text)
}

/* Deteksi apakah pertanyaan butuh sentuhan kreatif */
const CREATIVE_INTENT_RE =
  /(tulis|write|buat.?(cerita|puisi|poem|story|artikel|article|copy|slogan|tagline|caption|naskah|script)|kreatif|creative|brainstorm|ide |ideas?|inspirasi|inspiration|nama.?(brand|produk|bisnis)|rewrite|parafrase|paraphrase)/i
function needsCreative(text: string): boolean {
  return CREATIVE_INTENT_RE.test(text)
}

const MAX_INPUT_LENGTH = 8000
const MAX_MESSAGES = 20
const BLOCKED_PATTERNS = [
  /https?:\/\/[^\s]*\.(exe|dll|bat|cmd|msi|sh|scr|pif|vbs|ps1)(\?|\s|$)/i,
]

function sanitizeInput(text: string): string {
  const clean = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200b\u200c\u200d\ufeff\u2060\u180e\u00ad]/g, '')
  return clean.slice(0, MAX_INPUT_LENGTH).trim()
}

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

function filterContent(text: string): { blocked: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: 'Konten mencurigakan terdeteksi' }
    }
  }
  return { blocked: false }
}

function err(code: EngineErrorCode, message: string, meta?: unknown): EngineResult {
  return { success: false, content: null, error: { code, message, meta }, meta: {} }
}

function ok(content: string, meta: EngineResult['meta'] = {}): EngineResult {
  return { success: true, content, error: null, meta }
}

/* ============================================================
 * CHAT — Multi-Model Collaboration Pipeline
 * Semua model saling bicara setiap request:
 * Chat → Research → Thinking → Creative → Final Answer
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
    // 1. Validasi
    const validation = validateMessages(messages)
    if (!validation.valid) return err('INVALID_INPUT', validation.error)

    // 2. Sanitasi
    const sanitized = (messages as ChatMessage[]).map(m => ({
      ...m,
      content: sanitizeInput(m.content),
    }))
    const filtered = sanitized.filter(m => m.content.length > 0)
    if (filtered.length === 0) {
      return err('EMPTY_AFTER_SANITIZE', 'Pesan kosong setelah filter')
    }

    // 3. Content filter
    for (const msg of filtered) {
      const check = filterContent(msg.content)
      if (check.blocked) return err('CONTENT_BLOCKED', check.reason ?? 'Konten diblokir')
    }

    // 4. Rate limit
    const meta: EngineResult['meta'] = {}
    const rate = checkRateLimit(clientIp)
    meta.rateLimit = { allowed: rate.allowed, remaining: rate.remaining, resetAt: rate.resetAt }
    if (!rate.allowed) {
      return err(
        'RATE_LIMITED',
        `Terlalu banyak request. Tunggu ${Math.ceil((rate.resetAt - Date.now()) / 1000)} detik`,
      )
    }

    // 5. Jailbreak scan
    const lastUser = [...filtered].reverse().find(m => m.role === 'user')
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

    // 6. Ambil teks user terakhir untuk deteksi intent
    const lastUserText = lastUser?.content || ''
    const wantsResearch = needsResearch(lastUserText)
    const wantsThinking = needsThinking(lastUserText)
    const wantsCreative = needsCreative(lastUserText)

    // ============================================================
    // MULTI-MODEL COLLABORATION: semua model saling bicara
    // ============================================================

    // --- TAHAP 1: Research (key 5 & 6) — cari data web jika perlu ---
    let researchContext = ''
    if (wantsResearch) {
      try {
        const webResults = await fetchWebResearch(lastUserText)
        const sources = (webResults?.results || []).slice(0, 8)
        if (sources.length > 0) {
          researchContext = '\n\n🔍 HASIL RISET WEB (dari Research Agent / GEMINI_API_KEY_2):\n' +
            sources.map((r: any, i: number) =>
              `[${i + 1}] ${r.title || r.name || 'Sumber'}: ${(r.snippet || r.description || '').slice(0, 200)}${r.url ? ` (${r.url})` : ''}`
            ).join('\n')

          // Research model synthesize data
          try {
            let researchText = ''
            try {
              const researchSynthesis = await callGroqWithTools(
                'research',
                'Kamu Research Agent. Rangkum data web menjadi insight padat (poin-poin) relevan untuk user.',
                [{ role: 'user', content: `Pertanyaan: ${lastUserText}\n\nData:\n${researchContext}` }] as GroqToolMessage[],
                [] as GroqToolDefinition[],
                { maxTokens: 110, timeoutMs: 10_000 },
              )
              researchText = researchSynthesis.content || ''
            } catch { /* ignore */ }
            if (researchText) {
              try {
                const more = await generateRolling(
                  'research',
                  'Kamu Research Agent. Lanjutkan insight riset, padat dan akurat. Akhiri [[SELESAI]] bila cukup.',
                  [
                    { role: 'user', content: `Pertanyaan: ${lastUserText}` },
                    { role: 'assistant', content: researchText },
                    { role: 'user', content: 'Lanjutkan insight. Jangan mengulang.' },
                  ],
                  { maxRounds: 3, maxTokens: 110 },
                )
                if (more.content) researchText = more.content
              } catch { /* keep first */ }
              researchContext = '\n\n🔍 INSIGHT DARI RESEARCH AGENT:\n' + normalizeOutput(researchText)
            }
          } catch { /* pakai raw results kalau synthesis gagal */ }
        }
      } catch { /* research opsional, lanjut tanpa data web */ }
    }

    // --- TAHAP 2: Thinking (GEMINI_API_KEY_3) — analisis mendalam jika perlu ---
    let thinkingContext = ''
    if (wantsThinking) {
      try {
        const thinkPrompt = researchContext
          ? `Pertanyaan user: ${lastUserText}\n${researchContext}\n\nBerikan analisis mendalam: pertimbangan, pro-kontra, dan rekomendasi.`
          : `Pertanyaan user: ${lastUserText}\n\nBerikan analisis mendalam: pertimbangan, pro-kontra, dan rekomendasi.`

        const thinkResult = await callGroqWithTools(
          'thinking',
          'Kamu Thinking Agent. Tugasmu menganalisis secara mendalam, memberikan sudut pandang berbeda, dan menyusun pemikiran terstruktur. Singkat tapi tajam.',
          [{ role: 'user', content: thinkPrompt }] as GroqToolMessage[],
          [] as GroqToolDefinition[],
          { maxTokens: 110, timeoutMs: 10_000 },
        )
        if (thinkResult.content) {
          thinkingContext = '\n\n🧠 ANALISIS DARI THINKING AGENT:\n' + normalizeOutput(thinkResult.content)
        }
      } catch { /* thinking opsional */ }
    }

    // --- TAHAP 3: Chat (GEMINI_API_KEY) — jawab utama dengan konteks semua agent ---
    const compactBase = (() => {
      const s = BASE_SYSTEM_PROMPT
      return s.length <= 1800 ? s : s.slice(0, s.lastIndexOf('\n', 1800))
    })()

    const collaborationNote = (researchContext || thinkingContext)
      ? `\n\nKamu bekerja dalam tim AI. Berikut kontribusi dari agent lain yang SUDAH mengerjakan bagian mereka. Integrasikan insight mereka ke jawabanmu secara natural (jangan copy-paste mentah). Jika ada sumber web, sertakan referensi.${researchContext}${thinkingContext}`
      : ''

    const systemPrompt = [
      compactBase,
      MATH_TUTOR_PROMPT,
      JAILBREAK_POLICY_PROMPT,
      context,
      TOOL_GUIDANCE_PROMPT,
      WEBSITE_CONTROL_PROMPT,
      collaborationNote,
    ]
      .filter(Boolean)
      .join('\n\n')

    const chatMessages: GroqToolMessage[] = filtered.map(m => ({
      role: m.role,
      content: m.content,
    }))

    let finalContent = ''
    const toolIntent = hasToolIntent(lastUserText)
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const modelResult = await callGroqWithTools(
        opts.model || 'chat',
        systemPrompt,
        chatMessages,
        [...(AI_TOOLS as GroqToolDefinition[]), ...(WEBSITE_TOOLS as GroqToolDefinition[])],
        toolIntent ? { maxTokens: 110 } : undefined,
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

      let done = false
      for (const tc of modelResult.toolCalls) {
        if (WEBSITE_TOOL_NAMES.has(tc.name)) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(tc.arguments || '{}') as Record<string, unknown>
          } catch {
            args = { parseError: tc.arguments }
          }
          return {
            success: true,
            content: '',
            error: null,
            meta: {},
            websiteAction: { name: tc.name, arguments: args },
          }
        }
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

        if (
          tc.name === 'generate_portfolio_pdf' &&
          toolResult &&
          typeof toolResult === 'object' &&
          (toolResult as { ok?: boolean; url?: string }).ok !== false &&
          (toolResult as { url?: string }).url
        ) {
          finalContent = `Portofolio PDF siap! Download: ${(toolResult as { url: string }).url}`
          done = true
        }
      }
      if (done) break
    }

    // --- ROG: perluas jawaban meski max_tokens=110 (sandbox → all models) ---
    if (finalContent && finalContent.trim().length > 0 && finalContent.trim().length < 320) {
      try {
        const rolled = await generateRolling(
          opts.model || 'chat',
          systemPrompt,
          [
            ...chatMessages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: typeof m.content === 'string' ? m.content : '',
            })),
            { role: 'assistant', content: finalContent },
            {
              role: 'user',
              content:
                'Lanjutkan dan lengkapi jawaban di atas agar lebih detail dan utuh. Jangan mengulang. Akhiri dengan [[SELESAI]] bila sudah lengkap.',
            },
          ],
          { maxRounds: 6, maxTokens: 110, temperature: 0.6 },
        )
        if (rolled.content && rolled.content.length > finalContent.length) {
          // Gabungkan: base + kelanjutan tanpa duplikasi kasar
          const extra = rolled.content.startsWith(finalContent.slice(0, 40))
            ? rolled.content
            : `${finalContent.trim()} ${rolled.content.trim()}`
          finalContent = extra
          meta.rog = { rounds: rolled.rounds, truncated: rolled.truncated }
        }
      } catch {
        /* ROG opsional */
      }
    }

    // --- TAHAP 4: Creative (GEMINI_API_KEY_4) — polish jawaban jika perlu ---
    if (wantsCreative && finalContent) {
      try {
        const creativeResult = await callGroqWithTools(
          'creative',
          'Kamu Creative Agent. Tugasmu memperkaya dan memoles teks berikut agar lebih menarik, mudah dibaca, dan engaging. Pertahankan semua fakta dan referensi, hanya tingkatkan kualitas tulisan. Jangan menambah informasi baru yang tidak ada di teks asli.',
          [{ role: 'user', content: `Polish teks ini:\n\n${finalContent}` }] as GroqToolMessage[],
          [] as GroqToolDefinition[],
          { maxTokens: 110, temperature: 0.8, timeoutMs: 10_000 },
        )
        if (creativeResult.content && creativeResult.content.trim().length > finalContent.length * 0.5) {
          finalContent = creativeResult.content
        }
        // Creative juga lewat ROG bila masih pendek
        if (finalContent.trim().length < 280) {
          try {
            const more = await generateRolling(
              'creative',
              'Kamu Creative Agent. Lengkapi teks agar lebih utuh dan enak dibaca. Jangan mengarang fakta baru. Akhiri [[SELESAI]] bila cukup.',
              [
                { role: 'user', content: 'Lengkapi teks berikut.' },
                { role: 'assistant', content: finalContent },
                { role: 'user', content: 'Lanjutkan tanpa mengulang.' },
              ],
              { maxRounds: 3, maxTokens: 110, temperature: 0.7 },
            )
            if (more.content && more.content.length > finalContent.length) {
              finalContent = more.content
            }
          } catch { /* ignore */ }
        }
      } catch { /* creative polish opsional, pakai jawaban chat langsung */ }
    }

    const rawFinal = finalContent
    const normFinal = normalizeOutput(rawFinal)
    finalContent = isPathological(rawFinal, normFinal) ? '' : normFinal
    if (!finalContent.trim()) {
      try {
        const fb = await callGroqWithTools(
          opts.model || 'chat',
          systemPrompt,
          [...chatMessages, { role: 'user', content: 'Jawab langsung dengan satu atau dua kalimat tanpa memanggil tool.' }] as GroqToolMessage[],
          [] as GroqToolDefinition[],
          { maxTokens: 110, temperature: 0.3 },
        )
        if (fb.content && fb.content.trim()) {
          const normFb = normalizeOutput(fb.content)
          finalContent = isPathological(fb.content, normFb) ? '' : normFb
        }
      } catch { /* abaikan */ }
      if (!finalContent.trim()) {
        return err('AI_EMPTY_RESPONSE', 'Model AI mengembalikan respon kosong, coba lagi sebentar')
      }
    }

    // Tambahkan info kolaborasi ke meta
    meta.collaboration = {
      research: wantsResearch && researchContext.length > 0,
      thinking: wantsThinking && thinkingContext.length > 0,
      creative: wantsCreative,
      agents: [
        'Chat [GEMINI_API_KEY] — jawaban utama',
        ...(wantsResearch && researchContext
          ? ['Research [GEMINI_API_KEY_2] — riset fakta & web']
          : []),
        ...(wantsThinking && thinkingContext
          ? ['Thinking [GEMINI_API_KEY_3] — analisis mendalam']
          : []),
        ...(wantsCreative
          ? ['Creative [GEMINI_API_KEY_4] — polish & gaya tulis']
          : []),
      ],
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
 * THINKING / WEB RESEARCH — standalone endpoint
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
 * RESEARCH — standalone endpoint (key 5 & 6)
 * ============================================================ */
export interface ResearchResult {
  answer?: string
  sources?: Array<{ title: string; url: string; snippet?: string }>
  [key: string]: unknown
}

export async function runResearch(
  question: unknown,
  ip: string | undefined,
): Promise<ResearchResult | { code: string; message: string }> {
  const clientIp = ip || 'anonymous'
  if (typeof question !== 'string' || question.trim() === '') {
    return { code: 'INVALID_INPUT', message: 'Pertanyaan diperlukan' }
  }
  if (question.length > MAX_INPUT_LENGTH) {
    return { code: 'INVALID_INPUT', message: 'Pertanyaan terlalu panjang' }
  }

  const scan = await jailbreakScanner.scan(question, clientIp) as ScanResult
  if (scan.verdict === 'banned' || scan.verdict === 'block') {
    const scanErr = verdictToError(scan) as { code: string; message: string }
    return scanErr
  }

  const rate = checkRateLimit(clientIp)
  if (!rate.allowed) {
    return { code: 'RATE_LIMITED', message: `Terlalu banyak request. Tunggu ${Math.ceil((rate.resetAt - Date.now()) / 1000)} detik` }
  }

  try {
    const webResults = await fetchWebResearch(question)
    const sources = (webResults?.results || []).slice(0, 10).map((r: any) => ({
      title: r.title || r.name || '',
      url: r.url || r.link || '',
      snippet: r.snippet || r.description || '',
    }))

    const contextSnippets = sources
      .map((s: { title: string; snippet: string }, i: number) => `[${i + 1}] ${s.title}: ${s.snippet}`)
      .join('\n')

    const sysPrompt = `Kamu adalah peneliti AI. Berdasarkan sumber web berikut, berikan jawaban komprehensif dan akurat. Sertakan referensi [nomor].\n\nSumber:\n${contextSnippets}`

    const result = await callGroqWithTools(
      'research',
      sysPrompt,
      [{ role: 'user', content: question }] as GroqToolMessage[],
      [] as GroqToolDefinition[],
      { maxTokens: 110 },
    )

    return { answer: normalizeOutput(result.content || ''), sources }
  } catch (e) {
    if (e instanceof EngineError) return { code: e.code, message: e.message }
    return { code: 'AI_UNKNOWN', message: 'Research gagal: ' + (e instanceof Error ? e.message : String(e)) }
  }
}

/* ============================================================
 * CREATIVE — standalone endpoint (key 7 & 8)
 * ============================================================ */
export interface CreativeResult {
  content?: string
  style?: string
  [key: string]: unknown
}

export async function runCreative(
  prompt: unknown,
  style: unknown,
  ip: string | undefined,
): Promise<CreativeResult | { code: string; message: string }> {
  const clientIp = ip || 'anonymous'
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return { code: 'INVALID_INPUT', message: 'Prompt diperlukan' }
  }
  if (prompt.length > MAX_INPUT_LENGTH) {
    return { code: 'INVALID_INPUT', message: 'Prompt terlalu panjang' }
  }

  const scan = await jailbreakScanner.scan(prompt, clientIp) as ScanResult
  if (scan.verdict === 'banned' || scan.verdict === 'block') {
    const scanErr = verdictToError(scan) as { code: string; message: string }
    return scanErr
  }

  const rate = checkRateLimit(clientIp)
  if (!rate.allowed) {
    return { code: 'RATE_LIMITED', message: `Terlalu banyak request. Tunggu ${Math.ceil((rate.resetAt - Date.now()) / 1000)} detik` }
  }

  try {
    const styleHint = typeof style === 'string' && style.trim() ? style.trim() : 'default'
    const CREATIVE_STYLES: Record<string, string> = {
      puisi: 'Kamu adalah penyair berbakat. Tulis dengan bahasa indah, penuh metafora dan emosi.',
      cerita: 'Kamu adalah penulis cerita. Tulis narasi menarik dengan karakter hidup.',
      humor: 'Kamu adalah komedian. Tulis dengan gaya lucu, witty, dan menghibur.',
      formal: 'Kamu adalah penulis profesional. Tulis dengan gaya formal dan elegan.',
      copywriting: 'Kamu adalah copywriter handal. Tulis persuasif dan to-the-point.',
      brainstorm: 'Kamu adalah kreator ide. Berikan ide kreatif dan inovatif.',
      default: 'Kamu adalah penulis kreatif serbaguna. Sesuaikan gaya dengan konteks.',
    }

    const sysPrompt = CREATIVE_STYLES[styleHint] || CREATIVE_STYLES['default']
    const result = await callGroqWithTools(
      'creative',
      sysPrompt,
      [{ role: 'user', content: prompt }] as GroqToolMessage[],
      [] as GroqToolDefinition[],
      { maxTokens: 110, temperature: 0.9 },
    )

    const output = normalizeOutput(result.content || '')
    if (!output) return { code: 'AI_EMPTY_RESPONSE', message: 'Model tidak menghasilkan konten kreatif' }
    return { content: output, style: styleHint }
  } catch (e) {
    if (e instanceof EngineError) return { code: e.code, message: e.message }
    return { code: 'AI_UNKNOWN', message: 'Creative gagal: ' + (e instanceof Error ? e.message : String(e)) }
  }
}

/* ============================================================
 * CONFERENCE — semua model saling berdiskusi (Gemini 2-4)
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
