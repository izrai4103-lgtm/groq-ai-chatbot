import { thinkAndResearch } from '@/lib/code-executor'

export async function POST(request) {
  try {
    const body = await request.json()
    const { question } = body

    if (!question || typeof question !== 'string') {
      return Response.json({ error: 'Question diperlukan' }, { status: 400 })
    }

    if (question.length > 1000) {
      return Response.json({ error: 'Pertanyaan terlalu panjang' }, { status: 400 })
    }

    const result = await thinkAndResearch(question)
    return Response.json(result)
  } catch (err) {
    console.error('Think error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
