'use strict'

/**
 * YouTube Music — search via Piped → metadata + embed
 * Alur: client/intent → API (sandbox search) → model text → voice UI
 */

import { getUserTokenStatus, deductUserTokens } from '@/lib/token-usage'

export const maxDuration = 30
export const runtime = 'nodejs'

const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
]

function extractQuery(instruction) {
  if (!instruction || typeof instruction !== 'string') return ''
  let t = instruction.trim()

  const m1 = t.match(
    /(?:putar|play|mainkan|dengarkan|nyanyikan)\s+(?:musik|music|lagu|song|video)?\s*[:\-]?\s*(.+)$/i,
  )
  if (m1) return m1[1].replace(/["'“”]/g, '').trim().slice(0, 120)

  const m2 = t.match(
    /(?:musik|music|lagu|song)\s+(?:berjudul|judul|title)?\s*[:\-]?\s*(.+)$/i,
  )
  if (m2) return m2[1].replace(/["'“”]/g, '').trim().slice(0, 120)

  t = t
    .replace(/(?:buka|open|akses|kunjungi|visit)\s+(?:website\s+)?(?:youtube\.com|youtu\.be)\s*(?:dan|lalu|terus)?\s*/gi, '')
    .replace(/(?:putar|play|mainkan)\s+(?:musik|music|lagu|song)?/gi, '')
    .trim()
  return t.slice(0, 120)
}

async function searchPiped(query) {
  const q = encodeURIComponent(query)
  let lastErr = null
  for (const base of PIPED) {
    try {
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 9000)
      const res = await fetch(`${base}/search?q=${q}&filter=all`, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'ZancoAI/1.0' },
      })
      clearTimeout(to)
      if (!res.ok) {
        lastErr = new Error(`piped ${res.status}`)
        continue
      }
      const data = await res.json()
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
      const video = items.find((it) => {
        const id =
          it.videoId ||
          it.id ||
          (typeof it.url === 'string' && (it.url.match(/([a-zA-Z0-9_-]{11})/) || [])[1])
        return id && (it.type === 'stream' || it.type === 'video' || it.url || it.title)
      })
      if (!video) {
        lastErr = new Error('no results')
        continue
      }
      let id = video.videoId || video.id || ''
      if (!id && video.url) {
        const um = String(video.url).match(/(?:v=|\/shorts\/|youtu\.be\/|\/)([a-zA-Z0-9_-]{11})/)
        if (um) id = um[1]
      }
      if (!id || id.length !== 11) continue
      return {
        videoId: id,
        title: video.title || query,
        channel: video.uploaderName || video.uploader || video.author || 'YouTube',
        thumbnail:
          video.thumbnail ||
          (Array.isArray(video.thumbnails) && video.thumbnails[0]?.url) ||
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        duration: video.duration || video.lengthSeconds || 0,
        url: `https://www.youtube.com/watch?v=${id}`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`,
      }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('Pencarian YouTube gagal')
}

function formatDuration(sec) {
  const n = Number(sec) || 0
  if (n <= 0) return ''
  const m = Math.floor(n / 60)
  const s = Math.floor(n % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const instruction = typeof body?.instruction === 'string' ? body.instruction : ''
    const guestId = typeof body?.guestId === 'string' ? body.guestId.trim().slice(0, 64) : ''

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'anonymous'
    const isLoggedIn = guestId !== ''
    const userKey = isLoggedIn ? guestId : `ip:${ip}`

    const status = await getUserTokenStatus(userKey, isLoggedIn)
    if (status.remaining <= 0) {
      return Response.json(
        { error: 'Kuota token kamu habis. Reset otomatis dalam 1 menit.', tokenUsage: status },
        { status: 429 },
      )
    }

    const query = extractQuery(instruction)
    if (!query || query.length < 2) {
      return Response.json(
        {
          error:
            'Sebutkan judul musiknya. Contoh: "buka youtube.com dan putar musik Bohemian Rhapsody"',
        },
        { status: 400 },
      )
    }

    const track = await searchPiped(query)
    const spent = 48
    const tokenUsage =
      (await deductUserTokens(userKey, isLoggedIn, spent)) ||
      (await getUserTokenStatus(userKey, isLoggedIn))

    const content =
      `🎵 **Musik siap diputar**\n\n` +
      `**${track.title}**\n` +
      `${track.channel}` +
      (track.duration ? ` · ${formatDuration(track.duration)}` : '') +
      `\n\nTekan ▶ di kartu audio di bawah (seperti pesan suara WhatsApp).`

    return Response.json({
      success: true,
      content,
      music: {
        ...track,
        durationLabel: formatDuration(track.duration),
        query,
      },
      website: {
        url: track.url,
        title: track.title,
        actions: [
          'Sandbox: cari YouTube via Piped',
          `Model: pilih hasil "${track.title}"`,
          'UI: kirim pesan suara embed',
        ],
      },
      tokenUsage,
      pipeline: ['sandbox:search', 'models:select', 'ui:voice-message'],
    })
  } catch (err) {
    console.error('[music]', err)
    return Response.json(
      { error: 'Gagal mencari musik di YouTube. Coba judul yang lebih spesifik.' },
      { status: 502 },
    )
  }
}
