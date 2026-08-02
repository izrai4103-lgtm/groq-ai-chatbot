import { runConference } from '@/lib/engine/engine'
import { deductUserTokens, flushTokenUsage, getTotalRecorded, getUserTokenStatus } from '@/lib/token-usage'

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      topic?: unknown
      rounds?: unknown
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
      return Response.json({ error: 'Kuota token kamu habis untuk hari ini. Reset tengah malam.' }, { status: 429 })
    }

    const before = getTotalRecorded()
    const result = await runConference(body?.topic, body?.rounds, ip)
    await flushTokenUsage()
    await deductUserTokens(userKey, isLoggedIn, getTotalRecorded() - before)

    if (result.blockCode) {
      const status = result.blockCode === 'USER_BANNED' ? 429 : 403
      return Response.json({ error: result.error }, { status })
    }

    return Response.json(result)
  } catch (err) {
    console.error('Conference error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
