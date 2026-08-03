import { runThinking } from '@/lib/engine/engine'
import { deductUserTokens, flushTokenUsage, getCompletionRecorded, getUserTokenStatus } from '@/lib/token-usage'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { question?: unknown; web?: unknown; guestId?: unknown } | null

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
    const result = await runThinking(body?.question, ip, Boolean(body?.web))
    await flushTokenUsage()
    const spent = getCompletionRecorded() - before
    const tokenUsage =
      (await deductUserTokens(userKey, isLoggedIn, spent)) ||
      (await getUserTokenStatus(userKey, isLoggedIn))

    if (result.blockCode) {
      const status = result.blockCode === 'USER_BANNED' ? 429 : 403
      return Response.json({ error: result.error, tokenUsage }, { status })
    }

    if (result.error) {
      return Response.json({ error: result.error, tokenUsage }, { status: 500 })
    }

    return Response.json({ ...result, tokenUsage })
  } catch (err) {
    console.error('Think error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
