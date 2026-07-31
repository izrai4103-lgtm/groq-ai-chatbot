import { runConference } from '@/lib/engine/engine'

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      topic?: unknown
      rounds?: unknown
    } | null

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'anonymous'

    const result = await runConference(body?.topic, body?.rounds, ip)

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
