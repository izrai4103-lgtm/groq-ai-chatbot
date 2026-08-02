import { get, head } from '@vercel/blob'
import fs from 'node:fs'
import path from 'node:path'

// Folder tempat PDF disimpan (sama dengan lib/portfolioPdfTool.js):
// serverless -> /tmp/portfolios, dev -> public/portfolios
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
const PORTFOLIO_DIR = IS_SERVERLESS
  ? path.join('/tmp', 'portfolios')
  : path.join(process.cwd(), 'public', 'portfolios')

function pdfResponse(body: Buffer, fileName: string): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export async function GET(_request: Request, { params }: { params: { file: string } }) {
  const fileName = String(params?.file || '')
  if (!/^[a-z0-9-]+\.pdf$/i.test(fileName)) {
    return new Response('Not found', { status: 404 })
  }

  // Vercel Blob (persisten) — di production /tmp tidak dibagi antar instance,
  // jadi PDF harus diambil dari Blob store kalau token tersedia.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await head(fileName)
      if (blob) {
        const result = await get(fileName, { access: 'private' })
        if (result?.statusCode === 200 && result.stream) {
          const reader = result.stream.getReader()
          const chunks: Uint8Array[] = []
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
          }
          return pdfResponse(Buffer.concat(chunks), fileName)
        }
      }
    } catch {
      // Blob tidak ketemu / error lain -> fallback ke /tmp
    }
  }

  const filePath = path.join(PORTFOLIO_DIR, fileName)
  if (!fs.existsSync(filePath)) {
    return new Response('Not found', { status: 404 })
  }

  return pdfResponse(fs.readFileSync(filePath), fileName)
}
