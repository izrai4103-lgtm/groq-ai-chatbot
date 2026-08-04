import { runConference } from '@/lib/engine/engine'
import { deductUserTokens, flushTokenUsage, getCompletionRecorded, getUserTokenStatus } from '@/lib/token-usage'

// Konferensi memanggil banyak model (web research + 4 model × round + kesimpulan),
// butuh waktu lebih dari default fungsi serverless.
export const maxDuration = 60

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
      return Response.json(
        { error: 'Kuota token kamu habis. Reset otomatis dalam 1 menit.', tokenUsage: userStatus },
        { status: 429 },
      )
    }

    const before = getCompletionRecorded()
    const result = await runConference(body?.topic, body?.rounds, ip)
    await flushTokenUsage()
    let spent = getCompletionRecorded() - before
    if (!Number.isFinite(spent) || spent <= 0) {
      const t = typeof body?.topic === 'string' ? body.topic : ''
      spent = Math.max(64, Math.ceil(t.length / 4) + 200)
    }
    const tokenUsage =
      (await deductUserTokens(userKey, isLoggedIn, spent)) ||
      (await getUserTokenStatus(userKey, isLoggedIn))

    if (result.blockCode) {
      const status = result.blockCode === 'USER_BANNED' ? 429 : 403
      return Response.json({ error: result.error, tokenUsage }, { status })
    }

    return Response.json({ ...result, tokenUsage })
  } catch (err) {
    console.error('Conference error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
