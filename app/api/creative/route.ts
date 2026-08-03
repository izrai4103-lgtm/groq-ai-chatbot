import { runCreative } from '@/lib/engine/engine'
import { deductUserTokens, flushTokenUsage, getCompletionRecorded, getUserTokenStatus } from '@/lib/token-usage'

export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      prompt?: unknown
      style?: unknown
      guestId?: unknown
    } | null

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'anonymous'

    const guestId = typeof body?.guestId === 'string' ? body.guestId.trim().slice(0, 64) : ''
    const isLoggedIn = guestId !== ''
    const userKey = isLoggedIn ? guestId : `ip:${ip}`

    const userStatus = await getUserTokenStatus(userKey, isLoggedIn)
    if (userStatus.remaining <= 0) {
      return Response.json(
        { error: 'Kuota token kamu habis. Reset otomatis dalam 1 menit.', tokenUsage: userStatus },
        { status: 429 },
      )
    }

    const before = getCompletionRecorded()
    const result = await runCreative(body?.prompt, body?.style, ip)
    await flushTokenUsage()
    let spent = getCompletionRecorded() - before
    if (!Number.isFinite(spent) || spent <= 0) {
      const p = typeof body?.prompt === 'string' ? body.prompt : ''
      spent = Math.max(64, Math.ceil(p.length / 4) + 400)
    }
    const tokenUsage =
      (await deductUserTokens(userKey, isLoggedIn, spent)) ||
      (await getUserTokenStatus(userKey, isLoggedIn))

    if (result && typeof result === 'object' && 'code' in result) {
      const code = (result as any).code as string
      const status = code === 'RATE_LIMITED' ? 429 : code === 'CONTENT_BLOCKED' ? 403 : 502
      return Response.json({ error: (result as any).message || 'Creative error', tokenUsage }, { status })
    }

    return Response.json({ ...result, tokenUsage })
  } catch (err: any) {
    console.error('[/api/creative] Unhandled:', err)
    return Response.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
