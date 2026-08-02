import { runChat } from '@/lib/engine/engine'
import type { EngineErrorCode } from '@/lib/engine/types'
import { deductUserTokens, flushTokenUsage, getTotalRecorded, getUserTokenStatus } from '@/lib/token-usage'

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
    const body = (await request.json().catch(() => null)) as { messages?: unknown; guestId?: unknown } | null

    // Dapatkan IP client
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'anonymous'

    // Identitas user: login (guestId) = kuota 1.6k, belum login (per-IP) = 1k
    const guestId = typeof body?.guestId === 'string' ? body.guestId.trim().slice(0, 64) : ''
    const isLoggedIn = guestId !== ''
    const userKey = isLoggedIn ? guestId : `ip:${ip}`

    // Cek kuota sebelum memanggil model
    const userStatus = await getUserTokenStatus(userKey, isLoggedIn)
    if (userStatus.remaining <= 0) {
      return Response.json(
        { error: 'Kuota token kamu habis untuk hari ini. Reset tengah malam.' },
        { status: 429 },
      )
    }

    // Jalankan di mesin utama (TypeScript engine)
    const before = getTotalRecorded()
    const result = await runChat(body?.messages, ip)
    await flushTokenUsage()
    await deductUserTokens(userKey, isLoggedIn, getTotalRecorded() - before)

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
          ? { error: result.error?.message || 'Unknown error', detail }
          : { error: result.error?.message || 'Unknown error' },
        { status, headers },
      )
    }

    return Response.json({ content: result.content }, { headers })
  } catch (err) {
    console.error('API Route Error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
