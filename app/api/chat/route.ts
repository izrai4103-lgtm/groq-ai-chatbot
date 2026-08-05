import { runChat } from '@/lib/engine/engine'
import type { EngineErrorCode } from '@/lib/engine/types'
import { applyClientTokenHint, deductUserTokens, flushTokenUsage, getCompletionRecorded, getUserTokenStatus } from '@/lib/token-usage'
import { setRequestUserKeys, clearRequestUserKeys } from '@/lib/provider-keys'
import { sanitizeClientKeys } from '@/lib/user-keys'

export const maxDuration = 300

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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      messages?: unknown
      guestId?: unknown
      pageContext?: unknown
      clientTokenHint?: { used?: unknown; resetAt?: unknown } | null
      userApiKeys?: unknown
    } | null

    // Dapatkan IP client
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'anonymous'

    // Identitas user: login (guestId) = kuota 20k, belum login (per-IP) = 10k
    const guestId = typeof body?.guestId === 'string' ? body.guestId.trim().slice(0, 64) : ''
    const isLoggedIn = guestId !== ''
    const userKey = isLoggedIn ? guestId : `ip:${ip}`

    // Merge hint token dari client (real-time UI) lalu cek kuota
    if (body?.clientTokenHint) {
      await applyClientTokenHint(userKey, isLoggedIn, body.clientTokenHint as { used?: number; resetAt?: number })
    }
    const userStatus = await getUserTokenStatus(userKey, isLoggedIn)
    if (userStatus.remaining <= 0) {
      return Response.json(
        { error: 'Kuota token kamu habis. Reset otomatis dalam 1 menit.', tokenUsage: userStatus },
        { status: 429 },
      )
    }

    // Jalankan di mesin utama (TypeScript engine)
    const before = getCompletionRecorded()
    // Konteks halaman dari browser user (AI Website Controller) — dipakai model
    // kalau user minta aksi nyata di website (isi form, klik, scroll, dll).
    const pageCtx = body?.pageContext
    const context = pageCtx
      ? `KONTEKS HALAMAN SAAT INI (langsung dari browser user):\n${JSON.stringify(pageCtx).slice(0, 2500)}`
      : undefined
    // BYOK Groq: key milik user (rotasi di provider-keys)
    const userKeys = sanitizeClientKeys(body?.userApiKeys)
    setRequestUserKeys(userKeys)
    let result
    try {
      result = await runChat(body?.messages, ip, context)
    } finally {
      clearRequestUserKeys()
    }
    await flushTokenUsage()
    let spent = getCompletionRecorded() - before
    // Fallback estimasi bila API Groq tidak mengirim usage (spent=0)
    if (!Number.isFinite(spent) || spent <= 0) {
      const out = typeof result.content === 'string' ? result.content : ''
      const inChars = Array.isArray(body?.messages)
        ? body.messages.reduce((s: number, m: any) => s + (typeof m?.content === 'string' ? m.content.length : 0), 0)
        : 0
      spent = Math.max(32, Math.ceil((inChars + out.length) / 4))
    }
    const tokenUsage = (await deductUserTokens(userKey, isLoggedIn, spent))
      || (await getUserTokenStatus(userKey, isLoggedIn))

    const headers: Record<string, string> = {
      'X-RateLimit-Remaining': String(result.meta.rateLimit?.remaining ?? ''),
      'X-RateLimit-Reset': String(result.meta.rateLimit?.resetAt ?? ''),
    }

    if (!result.success) {
      const status = result.error ? STATUS_MAP[result.error.code] || 500 : 500
      const errorMeta = result.error?.meta as { detail?: unknown } | undefined
      const detail =
        typeof errorMeta?.detail === 'string'
          ? errorMeta.detail.slice(0, 400)
          : undefined
      return Response.json(
        detail
          ? { error: result.error?.message || 'Unknown error', detail, tokenUsage }
          : { error: result.error?.message || 'Unknown error', tokenUsage },
        { status, headers },
      )
    }

    return Response.json(
      { content: result.content, websiteAction: result.websiteAction ?? null, tokenUsage },
      { headers },
    )
  } catch (err) {
    console.error('API Route Error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
