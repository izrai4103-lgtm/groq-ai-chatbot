import fs from 'node:fs'
import path from 'node:path'

// Folder tempat PDF disimpan (sama dengan lib/portfolioPdfTool.js):
// serverless -> /tmp/portfolios, dev -> public/portfolios
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
const PORTFOLIO_DIR = IS_SERVERLESS
  ? path.join('/tmp', 'portfolios')
  : path.join(process.cwd(), 'public', 'portfolios')

export async function GET(_request: Request, { params }: { params: { file: string } }) {
  const fileName = String(params?.file || '')
  if (!/^[a-z0-9-]+\.pdf$/i.test(fileName)) {
    return new Response('Not found', { status: 404 })
  }

  const filePath = path.join(PORTFOLIO_DIR, fileName)
  if (!fs.existsSync(filePath)) {
    return new Response('Not found', { status: 404 })
  }

  const buffer = fs.readFileSync(filePath)
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
