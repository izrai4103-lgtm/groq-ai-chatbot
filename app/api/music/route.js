'use strict'

/**
 * YouTube Music v2 — ranking, multi-instance Piped, direct link support
 */

import { getUserTokenStatus, deductUserTokens } from '@/lib/token-usage'

export const maxDuration = 30
export const runtime = 'nodejs'

const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.nosebs.ru',
]

function formatDuration(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0))
  if (!n) return ''
  const h = Math.floor(n / 3600)
  const m = Math.floor((n % 3600) / 60)
  const s = n % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function extractVideoId(text) {
  if (!text) return null
  const m = String(text).match(
    /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  )
  return m ? m[1] : null
}

function extractQuery(instruction) {
  if (!instruction || typeof instruction !== 'string') {
    return { query: '', videoId: null }
  }
  const t0 = instruction.trim()
  const directId = extractVideoId(t0)
  if (directId) return { query: t0, videoId: directId }

  const patterns = [
    /(?:putar|play|mainkan|dengarkan|nyanyikan)\s+(?:musik|music|lagu|song|video)?\s*[:\-]?\s*(.+)$/i,
    /(?:musik|music|lagu|song)\s+(?:berjudul|judul|title)?\s*[:\-]?\s*(.+)$/i,
    /(?:cari|search)\s+(?:musik|music|lagu|song)\s+(.+)$/i,
  ]
  for (const re of patterns) {
    const m = t0.match(re)
    if (m && m[1]) {
      return {
        query: m[1].replace(/["'\u201c\u201d]/g, '').trim().slice(0, 140),
        videoId: null,
      }
    }
  }

  let t = t0
    .replace(
      /(?:buka|open|akses|kunjungi|visit)\s+(?:website\s+)?(?:youtube\.com|youtu\.be)\s*(?:dan|lalu|terus)?\s*/gi,
      '',
    )
    .replace(/(?:putar|play|mainkan)\s+(?:musik|music|lagu|song)?/gi, '')
    .replace(/\b(?:tolong|please|dong|ya)\b/gi, '')
    .trim()
  return { query: t.slice(0, 140), videoId: null }
}

function scoreItem(it, query) {
  const title = String(it.title || '').toLowerCase()
  const channel = String(
    it.uploaderName || it.uploader || it.author || '',
  ).toLowerCase()
  const q = String(query || '').toLowerCase()
  const words = q.split(/\s+/).filter((w) => w.length > 2)
  let score = 0

  const dur = Number(it.duration || it.lengthSeconds || 0)
  if (dur >= 60 && dur <= 600) score += 30
  else if (dur > 600 && dur <= 900) score += 10
  else if (dur > 0 && dur < 45) score -= 20

  if (q && title.includes(q)) score += 50
  for (const w of words) {
    if (title.includes(w)) score += 8
  }

  if (/official|topic|vevo|records|music/i.test(channel)) score += 20
  if (/official|lyrics|audio|music video|\bmv\b/i.test(title)) score += 15
  if (/karaoke|cover|reaction|10 hour|1 hour|nightcore/i.test(title)) score -= 25

  if (it.type === 'stream' || it.type === 'video') score += 5
  const views = Number(it.views || it.viewCount || 0)
  if (views > 1_000_000) score += 10
  if (views > 10_000_000) score += 10

  return score
}

function normalizeItem(video, query) {
  if (!video) return null
  let id = video.videoId || video.id || ''
  if (typeof id === 'string' && id.startsWith('/watch?v=')) {
    id = id.replace('/watch?v=', '')
  }
  if (!id && video.url) {
    const um = String(video.url).match(
      /(?:v=|\/shorts\/|youtu\.be\/|\/embed\/|\/)([a-zA-Z0-9_-]{11})/,
    )
    if (um) id = um[1]
  }
  if (!id || String(id).length !== 11) return null

  const duration = Number(video.duration || video.lengthSeconds || 0)
  let thumbnail = null
  if (typeof video.thumbnail === 'string' && video.thumbnail.startsWith('http')) {
    thumbnail = video.thumbnail
  } else if (Array.isArray(video.thumbnails) && video.thumbnails[0]?.url) {
    thumbnail = video.thumbnails[0].url
  }
  if (!thumbnail) thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

  return {
    videoId: id,
    title: video.title || query || 'YouTube',
    channel: video.uploaderName || video.uploader || video.author || 'YouTube',
    thumbnail,
    duration,
    durationLabel: formatDuration(duration),
    url: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`,
    views: Number(video.views || video.viewCount || 0),
  }
}

async function searchPiped(query) {
  const q = encodeURIComponent(query)
  let lastErr = null

  for (const base of PIPED) {
    try {
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 9000)
      const headers = {
        Accept: 'application/json',
        'User-Agent': 'ZancoAI-Music/2.0',
      }

      let res = await fetch(`${base}/search?q=${q}&filter=music_songs`, {
        signal: ctrl.signal,
        headers,
      })
      if (!res.ok) {
        res = await fetch(`${base}/search?q=${q}&filter=all`, {
          signal: ctrl.signal,
          headers,
        })
      }
      clearTimeout(to)
      if (!res.ok) {
        lastErr = new Error(`piped ${res.status}`)
        continue
      }

      const data = await res.json()
      const items = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : []

      const ranked = items
        .map((it) => ({ it, score: scoreItem(it, query) }))
        .sort((a, b) => b.score - a.score)

      for (const { it } of ranked) {
        const norm = normalizeItem(it, query)
        if (norm) {
          const alts = ranked
            .slice(1, 5)
            .map((r) => normalizeItem(r.it, query))
            .filter(Boolean)
            .filter((a) => a.videoId !== norm.videoId)
            .slice(0, 3)
          return { track: norm, alts }
        }
      }
      lastErr = new Error('no valid video')
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('Pencarian YouTube gagal')
}

async function resolveById(videoId) {
  let title = 'YouTube Video'
  let channel = 'YouTube'
  try {
    const o = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(5000) },
    )
    if (o.ok) {
      const j = await o.json()
      if (j.title) title = j.title
      if (j.author_name) channel = j.author_name
    }
  } catch {
    /* ignore oembed failure */
  }
  return {
    videoId,
    title,
    channel,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: 0,
    durationLabel: '',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`,
    views: 0,
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const instruction =
      typeof body?.instruction === 'string' ? body.instruction : ''
    const guestId =
      typeof body?.guestId === 'string' ? body.guestId.trim().slice(0, 64) : ''

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'anonymous'
    const isLoggedIn = guestId !== ''
    const userKey = isLoggedIn ? guestId : `ip:${ip}`

    const status = await getUserTokenStatus(userKey, isLoggedIn)
    if (status.remaining <= 0) {
      return Response.json(
        {
          error: 'Kuota token kamu habis. Reset otomatis dalam 1 menit.',
          tokenUsage: status,
        },
        { status: 429 },
      )
    }

    const { query, videoId } = extractQuery(instruction)
    if ((!query || query.length < 2) && !videoId) {
      return Response.json(
        {
          error:
            'Sebutkan judul musiknya. Contoh: "putar musik Bohemian Rhapsody" atau tempel link YouTube.',
        },
        { status: 400 },
      )
    }

    let track
    let alts = []
    if (videoId) {
      track = await resolveById(videoId)
    } else {
      const result = await searchPiped(query)
      track = result.track
      alts = result.alts || []
    }

    const spent = 52
    const tokenUsage =
      (await deductUserTokens(userKey, isLoggedIn, spent)) ||
      (await getUserTokenStatus(userKey, isLoggedIn))

    const content =
      `🎵 **Siap diputar**\n\n` +
      `**${track.title}**\n` +
      `${track.channel}` +
      (track.durationLabel ? ` · ${track.durationLabel}` : '') +
      `\n\nTekan ▶ pada kartu audio di bawah.`

    return Response.json({
      success: true,
      content,
      music: {
        ...track,
        query: query || track.title,
        alternatives: alts,
      },
      website: {
        url: track.url,
        title: track.title,
        actions: [
          videoId ? 'Resolve link YouTube' : `Sandbox search: "${query}"`,
          `Track: ${track.title}`,
          'UI: voice-message player',
        ],
      },
      tokenUsage,
      pipeline: ['sandbox:search', 'rank:music', 'ui:voice'],
    })
  } catch (err) {
    console.error('[music]', err)
    return Response.json(
      {
        error:
          'Gagal mencari musik. Coba judul lebih spesifik atau tempel link YouTube.',
      },
      { status: 502 },
    )
  }
}
