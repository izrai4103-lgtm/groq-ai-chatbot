import { runChat } from '@/lib/engine/engine'
import { runVisionPipeline } from '@/lib/engine/vision'
import { deductUserTokens, flushTokenUsage, getCompletionRecorded, getUserTokenStatus } from '@/lib/token-usage'
import { JailbreakScanner, verdictToError } from '@/lib/jailbreak-scanner'
import type { EngineErrorCode, ScanResult } from '@/lib/engine/types'

// Scanner penuh (heuristic + ML) dipakai untuk pesan user di sandbox (runChat).
// Konteks lampiran adalah output AI sendiri (vision/pillow), jadi cukup
// heuristic-only untuk hindari false positive dari Prompt Guard.
const contextScanner = new JailbreakScanner({ useMlLayer: false, useContentPolicyLayer: false })

const STATUS_MAP: Record<EngineErrorCode, number> = {
  INVALID_INPUT: 400,
  EMPTY_AFTER_SANITIZE: 400,
  CONTENT_BLOCKED: 403,
  JAILBREAK_BLOCKED: 403,
  USER_BANNED: 429,
  RATE_LIMITED: 429,
  AI_MODEL_UNAVAILABLE: 503,
  AI_MODEL_ERROR: 502,
  AI_TIMEOUT: 504,
  AI_EMPTY_RESPONSE: 502,
  AI_UNKNOWN: 502,
  SANDBOX_ERROR: 500,
}

/* ============================================================
 * 📎 UPLOAD — alur vision → pillow → sandbox → models AI
 * Terima multipart (file + message + history), scan/identifikasi
 * file, lalu kirim konteks ke sandbox (engine) untuk dijawab
 * semua models AI.
 * ============================================================ */
export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'anonymous'

    const form = await request.formData().catch(() => null)
    if (!form) return Response.json({ error: 'Form tidak valid' }, { status: 400 })

    const file = form.get('file')
    if (!(file instanceof File)) {
      return Response.json({ error: 'File diperlukan' }, { status: 400 })
    }

    const message = String(form.get('message') || '').trim()
    const guestId = String(form.get('guestId') || '').trim().slice(0, 64)
    let history: unknown[] = []
    try {
      const parsed = JSON.parse(String(form.get('history') || '[]'))
      if (Array.isArray(parsed)) history = parsed
    } catch {
      history = []
    }

    // 1) VISION → scan & identifikasi file
    // 2) PILLOW → analisis gambar (fallback sharp di Vercel)
    const vision = await runVisionPipeline(file)

    // 3) SANDBOX → jailbreak scan konteks lampiran (anti prompt-injection via file)
    const scan = await contextScanner.scan(vision.context, ip) as ScanResult
    if (scan.verdict === 'banned' || scan.verdict === 'block') {
      const scanErr = verdictToError(scan) as { code: string; message: string }
      return Response.json({ error: scanErr.message }, { status: 403 })
    }

    // 4) Konteks vision masuk system prompt (sandbox) → models AI
    const userText = message || 'Analisis lampiran ini'
    const messages = [...history, { role: 'user' as const, content: userText }]

    const isLoggedIn = guestId !== ''
    const userKey = isLoggedIn ? guestId : `ip:${ip}`
    const userStatus = await getUserTokenStatus(userKey, isLoggedIn)
    if (userStatus.remaining <= 0) {
      return Response.json({ error: 'Kuota token kamu habis. Reset otomatis dalam 3 menit.' }, { status: 429 })
    }

    const before = getCompletionRecorded()
    const result = await runChat(messages, ip, vision.context, { model: 'upload' })
    await flushTokenUsage()
    await deductUserTokens(userKey, isLoggedIn, getCompletionRecorded() - before)
    const headers: Record<string, string> = {
      'X-RateLimit-Remaining': String(result.meta.rateLimit?.remaining ?? ''),
      'X-RateLimit-Reset': String(result.meta.rateLimit?.resetAt ?? ''),
    }

    if (!result.success) {
      const status = result.error ? STATUS_MAP[result.error.code] || 500 : 500
      return Response.json(
        { error: result.error?.message || 'Unknown error' },
        { status, headers },
      )
    }

    return Response.json(
      { content: result.content, vision: { kind: vision.kind, name: vision.name } },
      { headers },
    )
  } catch (err) {
    console.error('API Upload Error:', err)
    const status = err instanceof Error && /File|tipe|Tipe|dokumen|audio|gambar|4MB/i.test(err.message) ? 400 : 500
    return Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status })
  }
}
