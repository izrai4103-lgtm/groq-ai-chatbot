import { thinkAndResearch } from '@/lib/code-executor'

export async function POST(request) {
  try {
    const body = await request.json()
    const { question } = body

    if (!question || typeof question !== 'string') {
      return Response.json({ error: 'Question diperlukan' }, { status: 400 })
    }

    if (question.length > 8000) {
      return Response.json({ error: 'Pertanyaan terlalu panjang' }, { status: 400 })
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'anonymous'

    const result = await thinkAndResearch(question, ip)

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
