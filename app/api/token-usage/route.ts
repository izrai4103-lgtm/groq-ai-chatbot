import { getTokenUsage } from '@/lib/token-usage'

export const dynamic = 'force-dynamic'

export async function GET() {
  const usage = await getTokenUsage()
  return Response.json(usage, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
