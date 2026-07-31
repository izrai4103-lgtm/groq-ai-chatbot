import { holdConference } from '@/lib/model-conference'

export async function POST(request) {
  try {
    const body = await request.json()
    const { topic, rounds } = body

    if (!topic || typeof topic !== 'string') {
      return Response.json({ error: 'Topik diperlukan' }, { status: 400 })
    }
    if (topic.length > 8000) {
      return Response.json({ error: 'Topik terlalu panjang' }, { status: 400 })
    }

    const maxRounds = Math.min(rounds || 2, 3) // Max 3 rounds

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'anonymous'

    const result = await holdConference(topic, maxRounds, ip)

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
