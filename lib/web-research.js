/**
 * 🔎 Web Research Gratis & Multi-Sumber — TANPA API key.
 *
 * Sumber utama:
 *  - Google News RSS (id + en) + Google Autocomplete (pencarian terkait)
 *  - Bing Search RSS + Bing News RSS
 *  - Wikipedia (MediaWiki API, id + en)
 *  - Hacker News (Algolia API)
 *  - Stack Overflow (StackExchange API)
 *  - arXiv (papers)
 *  - OpenAlex (jurnal/paper akademik)
 *  - GitHub (repositori)
 *  - DuckDuckGo Instant Answer (bonus bila jaringan mengizinkan)
 *
 * Semua sumber dijalankan paralel; kegagalan satu sumber TIDAK
 * menggagalkan yang lain (fallback otomatis). Hasil tidak dibatasi
 * dari sumber tertentu — diambil dari mana saja yang tersedia.
 */

const GOOGLE_NEWS_URL = (q, lang, gl, ceid) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang}&gl=${gl}&ceid=${ceid}`

const GOOGLE_SUGGEST_URL = (q) =>
  `https://suggestqueries.google.com/complete/search?client=firefox&hl=id&q=${encodeURIComponent(q)}`

const BING_RSS_URL = (q) =>
  `https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss&count=8`

const BING_NEWS_URL = (q) =>
  `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&count=5`

const WIKI_APIS = {
  id: 'https://id.wikipedia.org/w/api.php',
  en: 'https://en.wikipedia.org/w/api.php',
}

const DDG_API = 'https://api.duckduckgo.com/'

const TIMEOUT_MS = {
  googleNews: 6000,
  googleSuggest: 4000,
  bing: 6000,
  bingNews: 5000,
  wiki: 6000,
  hn: 5000,
  stack: 5000,
  arxiv: 7000,
  openalex: 7000,
  github: 5000,
  ddg: 3000,
}

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  if (typeof timer.unref === 'function') timer.unref()
  return { signal: controller.signal, timer }
}

async function fetchText(url, ms, extraHeaders = {}) {
  const { signal, timer } = withTimeout(ms)
  try {
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'ZancoAI-Chatbot/1.0 (https://zanco-ai.vercel.app)',
        ...extraHeaders,
      },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url, ms, extraHeaders = {}) {
  const text = await fetchText(url, ms, extraHeaders)
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

function makeResult(title, url, excerpt, source) {
  return {
    title: String(title || '').trim(),
    url: String(url || '').trim(),
    excerpt: String(excerpt || '').trim().slice(0, 500),
    source: String(source || 'Web').trim(),
  }
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
    const desc = stripHtml(pick(/<description>(.*?)<\/description>/s))
    if (title && url) items.push(makeResult(title, url, desc || title, source || 'Bing'))
  }
  return items
}

/* ===== Google News (id + en) ===== */
async function searchGoogleNews(query) {
  const [id, en] = await Promise.allSettled([
    fetchText(GOOGLE_NEWS_URL(query, 'id', 'ID', 'ID:id'), TIMEOUT_MS.googleNews),
    fetchText(GOOGLE_NEWS_URL(query, 'en', 'US', 'US:en'), TIMEOUT_MS.googleNews),
  ])
  const results = []
  for (const settled of [id, en]) {
    if (settled.status === 'fulfilled') {
      for (const item of parseRssItems(settled.value)) {
        results.push(makeResult(item.title, item.url, item.excerpt, item.source || 'Google News'))
      }
    }
  }
  return results.slice(0, 6)
}

/* ===== Google Autocomplete (pencarian terkait) ===== */
async function searchGoogleSuggest(query) {
  const data = await fetchJson(GOOGLE_SUGGEST_URL(query), TIMEOUT_MS.googleSuggest)
  if (!Array.isArray(data) || !Array.isArray(data[1])) return []
  return data[1].filter((s) => typeof s === 'string').slice(0, 5)
}

/* ===== Bing Search + Bing News ===== */
async function searchBing(query) {
  const xml = await fetchText(BING_RSS_URL(query), TIMEOUT_MS.bing)
  return parseRssItems(xml).slice(0, 5)
}

async function searchBingNews(query) {
  const xml = await fetchText(BING_NEWS_URL(query), TIMEOUT_MS.bingNews)
  return parseRssItems(xml).map((r) => ({ ...r, source: r.source || 'Bing News' })).slice(0, 4)
}

/* ===== Wikipedia (id + en) ===== */
async function searchWikipedia(query, lang) {
  const api = WIKI_APIS[lang]
  const url =
    `${api}?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}` +
    `&gsrlimit=4&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json`
  const data = await fetchJson(url, TIMEOUT_MS.wiki)
  const pages = Object.values(data?.query?.pages || {})
    .sort((a, b) => (a.index || 99) - (b.index || 99))
    .slice(0, 4)

  return pages
    .filter((p) => p.title && p.extract)
    .map((p) => {
      const title = p.title.replace(/ \(disambiguation\)$/i, '')
      const pageUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
      return makeResult(title, pageUrl, stripHtml(p.extract), `Wikipedia (${lang === 'id' ? 'Indonesia' : 'English'})`)
    })
}

/* ===== Hacker News (Algolia) ===== */
async function searchHackerNews(query) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=5`
  const data = await fetchJson(url, TIMEOUT_MS.hn)
  return (data.hits || [])
    .filter((h) => h.title)
    .map((h) => {
      const hnUrl = h.url || `https://news.ycombinator.com/item?id=${h.objectID}`
      const excerpt = h.story_text
        ? stripHtml(h.story_text)
        : `Poin ${h.points || 0} · komentar ${h.num_comments || 0}`
      return makeResult(h.title, hnUrl, excerpt, 'Hacker News')
    })
    .slice(0, 4)
}

/* ===== Stack Overflow (StackExchange API) ===== */
async function searchStackOverflow(query) {
  const url =
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance` +
    `&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=5&filter=default`
  const data = await fetchJson(url, TIMEOUT_MS.stack)
  return (data.items || [])
    .filter((i) => i.title && i.link)
    .map((i) =>
      makeResult(
        stripHtml(i.title),
        i.link,
        `Pertanyaan · jawaban ${i.answer_count || 0} · vote ${i.score || 0}`,
        'Stack Overflow',
      ),
    )
    .slice(0, 4)
}

/* ===== arXiv (paper) ===== */
async function searchArxiv(query) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=4`
  const xml = await fetchText(url, TIMEOUT_MS.arxiv)
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || []
  return entries
    .map((entry) => {
      const title = stripHtml(entry.match(/<title>(.*?)<\/title>/s)?.[1] || '')
      const id = entry.match(/<id>(.*?)<\/id>/s)?.[1]?.trim() || ''
      const summary = stripHtml(entry.match(/<summary>(.*?)<\/summary>/s)?.[1] || '')
      if (!title || !id) return null
      return makeResult(title, id.replace(/^http:/, 'https:'), summary, 'arXiv')
    })
    .filter(Boolean)
    .slice(0, 4)
}

/* ===== OpenAlex (jurnal/paper akademik) ===== */
async function searchOpenAlex(query) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=4&mailto=zanco@example.com`
  const data = await fetchJson(url, TIMEOUT_MS.openalex)
  return (data.results || [])
    .filter((w) => w.title && w.doi)
    .map((w) =>
      makeResult(
        w.title,
        `https://doi.org/${w.doi}`,
        `Tahun ${w.publication_year || '-'} · ${w.cited_by_count || 0} sitasi`,
        'OpenAlex',
      ),
    )
    .slice(0, 4)
}

/* ===== GitHub (repositori) ===== */
async function searchGitHub(query) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=4`
  const data = await fetchJson(url, TIMEOUT_MS.github, { Accept: 'application/vnd.github+json' })
  return (data.items || [])
    .filter((r) => r.full_name && r.html_url)
    .map((r) =>
      makeResult(
        r.full_name,
        r.html_url,
        stripHtml(r.description || `⭐ ${r.stargazers_count || 0} · bahasa ${r.language || '-'}`),
        'GitHub',
      ),
    )
    .slice(0, 4)
}

/* ===== DuckDuckGo Instant Answer (bonus) ===== */
async function searchDuckDuckGo(query) {
  const url = `${DDG_API}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=zanco-ai`
  const data = await fetchJson(url, TIMEOUT_MS.ddg)
  const results = []

  if (data.AbstractText && data.AbstractURL) {
    results.push(makeResult(data.Heading || 'Hasil', data.AbstractURL, stripHtml(data.AbstractText), 'DuckDuckGo'))
  }

  for (const topic of data.RelatedTopics || []) {
    if (topic.Text && topic.FirstURL) {
      results.push(makeResult(topic.Text.split(' - ')[0].slice(0, 120), topic.FirstURL, topic.Text, 'DuckDuckGo'))
    }
  }

  return results.slice(0, 4)
}

/**
 * Cari hasil web dari SEMUA sumber (paralel, tanpa batasan sumber).
 * Selalu resolve tanpa throw.
 * @returns {Promise<{ok: boolean, results: Array, related: Array, error?: string}>}
 */
export async function fetchWebResearch(query) {
  const q = String(query || '').trim()
  if (!q) return { ok: false, results: [], related: [], error: 'Query kosong' }

  const jobs = [
    searchGoogleNews(q),
    searchBing(q),
    searchBingNews(q),
    searchWikipedia(q, 'id'),
    searchWikipedia(q, 'en'),
    searchHackerNews(q),
    searchStackOverflow(q),
    searchArxiv(q),
    searchOpenAlex(q),
    searchGitHub(q),
    searchDuckDuckGo(q),
  ]

  const [googleNews, bing, bingNews, wikiId, wikiEn, hn, stack, arxiv, openalex, github, ddg] =
    await Promise.allSettled(jobs)

  const [suggest] = await Promise.allSettled([searchGoogleSuggest(q)])

  const results = []
  for (const settled of [googleNews, bing, bingNews, wikiId, wikiEn, hn, stack, arxiv, openalex, github, ddg]) {
    if (settled.status === 'fulfilled') results.push(...settled.value)
  }

  const related =
    suggest.status === 'fulfilled' && Array.isArray(suggest.value) ? suggest.value : []

  // Hapus duplikat berdasarkan URL/title (tidak dibatasi sumber tertentu)
  const seenUrl = new Set()
  const seenTitle = new Set()
  const unique = results.filter((r) => {
    if (!r.url && !r.title) return false
    const urlKey = (r.url || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')
    const titleKey = (r.title || '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (urlKey && seenUrl.has(urlKey)) return false
    if (titleKey && seenTitle.has(titleKey)) return false
    if (urlKey) seenUrl.add(urlKey)
    if (titleKey) seenTitle.add(titleKey)
    return true
  })

  if (unique.length === 0) {
    return { ok: false, results: [], related, error: 'Tidak ada hasil web ditemukan' }
  }

  return { ok: true, results: unique, related: related.slice(0, 5) }
}

/** Pilih hasil beragam dari SEMUA sumber, tapi batasi jumlahnya agar aman
 * dari limit TPM Groq (pesan besar -> error 413). Tetap mewakili semua
 * sumber: 1 hasil per sumber dulu, sisanya diisi sampai `max`. */
export function pickDiverseResults(results = [], max = 18) {
  if (!results || results.length <= max) return results || []
  const groups = new Map()
  for (const r of results) {
    const key = String(r.source || 'Web')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const arr = [...groups.values()]
  const picked = []
  let idx = 0
  while (picked.length < max && arr.some((g) => idx < g.length)) {
    for (const g of arr) {
      if (picked.length >= max) break
      if (idx < g.length) picked.push(g[idx])
    }
    idx++
  }
  return picked
}

/** Format hasil web menjadi teks yang bisa dibaca model AI. */
export function formatWebResults(results = [], related = []) {
  const diverse = pickDiverseResults(results, 18)
  const lines = diverse.map(
    (r, i) => `[${i + 1}] ${r.title}\nSumber: ${r.source || 'Web'}\nURL: ${r.url}\n${r.excerpt}`,
  )
  if (related.length > 0) {
    lines.push(`\n🔎 Pencarian terkait (Google): ${related.join(', ')}`)
  }
  return lines.join('\n\n')
}
