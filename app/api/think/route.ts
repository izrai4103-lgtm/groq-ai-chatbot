import { runThinking } from '@/lib/engine/engine'

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { question?: unknown } | null

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'anonymous'

    const result = await runThinking(body?.question, ip)

    if (result.blockCode) {
      const status = result.blockCode === 'USER_BANNED' ? 429 : 403
      return Response.json({ error: result.error }, { status })
    }

    return Response.json(result)
  } catch (err) {
    console.error('Think error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
