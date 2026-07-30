import { executeInSandbox } from '@/lib/sandbox'

export async function POST(request) {
  try {
    const body = await request.json()
    const { messages } = body

    // Dapatkan IP client
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'anonymous'

    // Jalankan di dalam sandbox
    const result = await executeInSandbox({ messages, ip })

    // Rate limit headers
    const headers = {
      'X-RateLimit-Remaining': String(result.meta?.rateLimit?.remaining ?? ''),
      'X-RateLimit-Reset': String(result.meta?.rateLimit?.resetAt ?? ''),
    }

    if (!result.success) {
      const statusMap = {
        'INVALID_INPUT': 400,
        'EMPTY_AFTER_SANITIZE': 400,
        'CONTENT_BLOCKED': 403,
        'RATE_LIMITED': 429,
        'AI_MODEL_UNAVAILABLE': 503,
        'AI_MODEL_ERROR': 502,
        'AI_TIMEOUT': 504,
        'AI_EMPTY_RESPONSE': 502,
      }
      const status = statusMap[result.error?.code] || 500

      return Response.json(
        { error: result.error?.message || 'Unknown error' },
        { status, headers }
      )
    }

    return Response.json({ content: result.content }, { headers })
  } catch (err) {
    console.error('API Route Error:', err)
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
