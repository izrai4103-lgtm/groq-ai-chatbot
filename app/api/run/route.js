import { readAndExecute } from '@/lib/code-executor'
import { executeInSandbox } from '@/lib/sandbox'

export async function POST(request) {
  try {
    const body = await request.json()
    const { code, language } = body

    if (!code || typeof code !== 'string') {
      return Response.json({ error: 'Kode diperlukan' }, { status: 400 })
    }

    if (code.length > 5000) {
      return Response.json({ error: 'Kode terlalu panjang (max 5000 karakter)' }, { status: 400 })
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'anonymous'

    // Execute in sandbox
    const result = await readAndExecute(code, language)

    return Response.json(result)
  } catch (err) {
    console.error('Run error:', err)
    return Response.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
