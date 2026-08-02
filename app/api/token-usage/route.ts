import { getTokenUsage, getUserTokenStatus } from '@/lib/token-usage'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const guestId = (url.searchParams.get('guestId') || '').trim().slice(0, 64)
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'anonymous'

  const isLoggedIn = guestId !== ''
  const userKey = isLoggedIn ? guestId : `ip:${ip}`

  const [shared, user] = await Promise.all([
    getTokenUsage(),
    getUserTokenStatus(userKey, isLoggedIn),
  ])

  return Response.json(
    { shared, user },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
