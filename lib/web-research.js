/**
 * 🔎 Web Research Gratis — pencarian internet TANPA API key.
 *
 * Sumber utama (Google, gratis):
 *  - Google News RSS  (news.google.com) — hasil sungguhan dari Google
 *  - Google Autocomplete (suggestqueries.google.com) — pencarian terkait
 *
 * Sumber cadangan (gratis):
 *  - Bing RSS
 *  - Wikipedia (MediaWiki API, id + en)
 *  - DuckDuckGo Instant Answer API (bonus bila jaringan mengizinkan)
 *
 * Semua kegagalan ditangani dengan fallback agar chat tidak pernah error.
 */

const GOOGLE_NEWS_URL = (q, lang, gl, ceid) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang}&gl=${gl}&ceid=${ceid}`

const GOOGLE_SUGGEST_URL = (q) =>
  `https://suggestqueries.google.com/complete/search?client=firefox&hl=id&q=${encodeURIComponent(q)}`

const BING_RSS_URL = (q) =>
  `https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss&count=8`

const WIKI_APIS = {
  id: 'https://id.wikipedia.org/w/api.php',
  en: 'https://en.wikipedia.org/w/api.php',
}

const DDG_API = 'https://api.duckduckgo.com/'

const TIMEOUT_MS = {
  googleNews: 6000,
  googleSuggest: 4000,
  bing: 6000,
  wiki: 6000,
  ddg: 3000,
}

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  if (typeof timer.unref === 'function') timer.unref()
  return { signal: controller.signal, timer }
}

async function fetchText(url, ms) {
  const { signal, timer } = withTimeout(ms)
  try {
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'ZancoAI-Chatbot/1.0 (https://zanco-ai.vercel.app)' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url, ms) {
  const text = await fetchText(url, ms)
  return JSON.parse(text)
}

function decodeEntities(text = '') {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

function stripHtml(text = '') {
  const decoded = decodeEntities(String(text))
  const noLinks = decoded.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ')
  return noLinks
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseRssItems(xml) {
  const items = []
  const regex = /<item>([\s\S]*?)<\/item>/g
  let match
  while ((match = regex.exec(xml)) !== null) {
    const block = match[1]
    const pick = (pattern) => {
      const m = block.match(pattern)
      return m ? m[1] : ''
    }
    const title = stripHtml(pick(/<title>(.*?)<\/title>/s))
    const url = pick(/<link>(.*?)<\/link>/s).trim()
    const source = stripHtml(pick(/<source[^>]*>(.*?)<\/source>/s))
    const date = pick(/<pubDate>(.*?)<\/pubDate>/s).trim()
    const desc = stripHtml(pick(/<description>(.*?)<\/description>/s))
    if (title && url) {
      items.push({ title, url, source, date, excerpt: (desc || title).slice(0, 400) })
    }
  }
  return items
}

/** Sumber utama: Google News RSS (bahasa Indonesia + Inggris). */
async function searchGoogleNews(query) {
  const [id, en] = await Promise.allSettled([
    fetchText(GOOGLE_NEWS_URL(query, 'id', 'ID', 'ID:id'), TIMEOUT_MS.googleNews),
    fetchText(GOOGLE_NEWS_URL(query, 'en', 'US', 'US:en'), TIMEOUT_MS.googleNews),
  ])
  const results = []
  for (const settled of [id, en]) {
    if (settled.status === 'fulfilled') {
      for (const item of parseRssItems(settled.value)) {
        results.push({ ...item, source: item.source || 'Google News' })
      }
    }
  }
  return results
}

/** Sumber utama: Google Autocomplete — pencarian terkait. */
async function searchGoogleSuggest(query) {
  const data = await fetchJson(GOOGLE_SUGGEST_URL(query), TIMEOUT_MS.googleSuggest)
  if (!Array.isArray(data) || !Array.isArray(data[1])) return []
  return data[1].filter((s) => typeof s === 'string').slice(0, 5)
}

/** Cadangan: Bing RSS. */
async function searchBing(query) {
  const xml = await fetchText(BING_RSS_URL(query), TIMEOUT_MS.bing)
  return parseRssItems(xml).map((item) => ({
    ...item,
    source: item.source || 'Bing',
    excerpt: item.excerpt.slice(0, 400),
  }))
}

/** Cadangan: Wikipedia (MediaWiki API). */
async function searchWikipedia(query, lang) {
  const api = WIKI_APIS[lang]
  const url =
    `${api}?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}` +
    `&gsrlimit=5&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json`
  const data = await fetchJson(url, TIMEOUT_MS.wiki)
  const pages = Object.values(data?.query?.pages || {})
    .sort((a, b) => (a.index || 99) - (b.index || 99))
    .slice(0, 5)

  return pages
    .filter((p) => p.title && p.extract)
    .map((p) => {
      const title = p.title.replace(/ \(disambiguation\)$/i, '')
      const pageUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
      return {
        title,
        url: pageUrl,
        excerpt: stripHtml(p.extract).slice(0, 500),
        source: `Wikipedia (${lang === 'id' ? 'Indonesia' : 'English'})`,
      }
    })
}

/** Cadangan: DuckDuckGo Instant Answer (bonus). */
async function searchDuckDuckGo(query) {
  const url = `${DDG_API}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=zanco-ai`
  const data = await fetchJson(url, TIMEOUT_MS.ddg)
  const results = []

  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || 'Hasil',
      url: data.AbstractURL,
      excerpt: stripHtml(data.AbstractText).slice(0, 500),
      source: 'DuckDuckGo',
    })
  }

  for (const topic of data.RelatedTopics || []) {
    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text.split(' - ')[0].slice(0, 120),
        url: topic.FirstURL,
        excerpt: topic.Text.slice(0, 350),
        source: 'DuckDuckGo',
      })
    }
  }

  return results
}

/**
 * Cari hasil web untuk sebuah query (Google dulu, lalu cadangan).
 * Selalu resolve tanpa throw.
 * @returns {Promise<{ok: boolean, results: Array, related: Array, error?: string}>}
 */
export async function fetchWebResearch(query) {
  const q = String(query || '').trim()
  if (!q) return { ok: false, results: [], related: [], error: 'Query kosong' }

  const [google, suggest, bing, wikiId, wikiEn, ddg] = await Promise.allSettled([
    searchGoogleNews(q),
    searchGoogleSuggest(q),
    searchBing(q),
    searchWikipedia(q, 'id'),
    searchWikipedia(q, 'en'),
    searchDuckDuckGo(q),
  ])

  const results = []
  for (const settled of [google, bing, wikiId, wikiEn, ddg]) {
    if (settled.status === 'fulfilled') results.push(...settled.value)
  }

  const related =
    suggest.status === 'fulfilled' && Array.isArray(suggest.value) ? suggest.value : []

  // Hapus duplikat berdasarkan URL/title
  const seen = new Set()
  const unique = results.filter((r) => {
    const key = (r.url || r.title || '').toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (unique.length === 0) {
    return { ok: false, results: [], related, error: 'Tidak ada hasil web ditemukan' }
  }

  return { ok: true, results: unique.slice(0, 8), related: related.slice(0, 5) }
}

/** Format hasil web menjadi teks yang bisa dibaca model AI. */
export function formatWebResults(results = [], related = []) {
  const lines = results.map(
    (r, i) => `[${i + 1}] ${r.title}\nSumber: ${r.source || 'Web'}\nURL: ${r.url}\n${r.excerpt}`,
  )
  if (related.length > 0) {
    lines.push(`\n🔎 Pencarian terkait (Google): ${related.join(', ')}`)
  }
  return lines.join('\n\n')
}
