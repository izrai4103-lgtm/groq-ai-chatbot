import { holdConference } from '@/lib/model-conference'

export async function POST(request) {
  try {
    const body = await request.json()
    const { topic, rounds } = body

    if (!topic || typeof topic !== 'string') {
      return Response.json({ error: 'Topik diperlukan' }, { status: 400 })
    }
    if (topic.length > 500) {
      return Response.json({ error: 'Topik terlalu panjang' }, { status: 400 })
    }

    const maxRounds = Math.min(rounds || 2, 3) // Max 3 rounds
    const result = await holdConference(topic, maxRounds)

    return Response.json(result)
  } catch (err) {
    console.error('Conference error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
