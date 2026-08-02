import { list } from '@vercel/blob'

export const dynamic = 'force-dynamic'

export async function GET() {
  const out: Record<string, unknown> = { enabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN) }
  try {
    const { blobs } = await list({ prefix: 'groq-token-usage.json', limit: 1 })
    const url = blobs[0]?.url || null
    out.url = url
    if (url) {
      const tests: Record<string, unknown> = {}
      const combos = ['', '?download=1', '?token=', '?download=1&token=']
      for (const q of combos) {
        const target = q.endsWith('token=')
          ? url + q + encodeURIComponent(process.env.BLOB_READ_WRITE_TOKEN || '')
          : url + q
        try {
          const res = await fetch(target, {
            headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
          })
          const txt = await res.text()
          tests[q || '(none)'] = { status: res.status, len: txt.length }
        } catch (e) {
          tests[q || '(none)'] = { error: e instanceof Error ? e.message : String(e) }
        }
      }
      try {
        const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`, 'x-vercel-blob-token': process.env.BLOB_READ_WRITE_TOKEN || '' } })
        tests['x-vercel-blob-token'] = { status: res.status }
      } catch (e) {
        tests['x-vercel-blob-token'] = { error: e instanceof Error ? e.message : String(e) }
      }
      out.tests = tests
    }
  } catch (e) {
    out.listError = e instanceof Error ? e.message : String(e)
  }
  return Response.json(out)
}
