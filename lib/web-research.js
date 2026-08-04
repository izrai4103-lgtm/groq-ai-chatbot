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

/* ===== Bersihkan query: buang kata tanya & stopword agar mesin pencari
 * mendapat kata kunci yang bermakna (misal "siapa presiden indonesia"
 * -> "presiden indonesia", bukan hasil turnamen "Piala Presiden"). ===== */
const QUERY_STOPWORDS = new Set([
  'siapa', 'siapakah', 'apa', 'apakah', 'kapan', 'bilamana', 'dimana', 'di mana',
  'bagaimana', 'mengapa', 'kenapa', 'berapa', 'berapakah', 'yang', 'di', 'ke',
  'dari', 'pada', 'untuk', 'dengan', 'akan', 'ini', 'itu', 'saja', 'kah', 'lah',
  'pun', 'adalah', 'tolong', 'jelaskan', 'sebutkan', 'ceritakan', 'tahun',
  'tentang', 'mengenai', 'adakah', 'mana', 'yang mana', 'please',
  'what', 'who', 'when', 'where', 'why', 'how', 'which', 'is', 'are', 'the',
  'of', 'in', 'on', 'for', 'to', 'and', 'with', 'about', 'year',
])

function cleanQuery(q) {
  const words = String(q || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && w.length > 1 && !QUERY_STOPWORDS.has(w))
  return [...new Set(words)].join(' ')
}

/* Terjemahan ringan kata Indonesia -> Inggris agar pencarian Wikipedia EN
 * menemukan artikel jawaban (mis. "presiden" -> "president" -> Prabowo Subianto). */
const EN_WORD_MAP = {
  presiden: 'president', wakil: 'vice', menteri: 'minister', kota: 'city',
  negara: 'country', provinsi: 'province', gubernur: 'governor',
  pemilihan: 'election', pemilu: 'election', pemerintah: 'government',
  umum: 'general', hukum: 'law', keuangan: 'finance', luar: 'foreign',
  negeri: 'affairs', rakyat: 'people', daftar: 'list', sejarah: 'history',
  indonesia: 'indonesia', politik: 'politics', partai: 'party', kabinet: 'cabinet',
}
function toEnglish(q) {
  return String(q || '')
    .split(' ')
    .map((w) => EN_WORD_MAP[w] || w)
    .join(' ')
}

const stripDigits = (q) => String(q || '').split(' ').filter((w) => !/^\d+$/.test(w)).join(' ').trim()
const insertOf = (q) => {
  const parts = String(q || '').split(' ')
  return parts.length > 1 ? parts[0] + ' of ' + parts.slice(1).join(' ') : q
}

/* Varian query Wikipedia: coba frasa alami (mis. "president of indonesia"),
 * tanpa tahun, kata kunci bersih, lalu query asli. */
function wikiVariants(query, lang) {
  const cleaned = cleanQuery(query) || query.trim()
  if (lang === 'en') {
    const t = toEnglish(cleaned)
    return [...new Set([
      insertOf(stripDigits(t)),
      insertOf(t),
      t,
      stripDigits(t),
      query.trim(),
    ].filter(Boolean))]
  }
  return [...new Set([cleaned, stripDigits(cleaned), query.trim()].filter(Boolean))]
}

/* Turunkan peringkat artikel Wikipedia yang biasanya noise untuk pertanyaan
 * faktual (mis. turnamen sepak bola "Piala Presiden", artikel tahunan). */
const WIKI_NOISE = /piala presiden|turnamen|sepak bola|stadium|klub sepak/i
const WIKI_YEARLY = /dalam tahun \d{4}|^\d{4} in |^in \d{4}/i

/* ===== Prioritas sumber: artikel ensiklopedia/faktual tampil lebih dulu
 * agar model membaca jawaban yang relevan sebelum berita/noise. ===== */
const SOURCE_PRIORITY = [
  'Wikipedia (Indonesia)',
  'Wikipedia (English)',
  'Google News',
  'Bing News',
  'Bing',
  'DuckDuckGo',
  'SearXNG',
  'Reddit',
  'Hacker News',
  'Stack Overflow',
  'arXiv',
  'OpenAlex',
  'GitHub',
]
const sourceRank = (src) => {
  const i = SOURCE_PRIORITY.indexOf(src)
  return i === -1 ? 99 : i
}

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
    excerpt: String(excerpt || '').trim().slice(0, 240),
    source: String(source || 'Web').trim(),
  }
}

/* Pilih kalimat paling informatif (berisi tahun / "current" / jabatan) agar
 * fakta kunci tidak terpotong, mis. "...The current president is Prabowo
 * Subianto, who assumed office on 20 October 2024." */
function smartExcerpt(text, max = 240) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const sentences = clean.split(/(?<=[.!?])\s+/)
  const scored = sentences.map((sent) => {
    let score = 0
    if (/\b(19|20)\d{2}\b/.test(sent)) score += 2
    if (/current|saat ini|kini|sekarang|menjabat|since|sejak|office|terpilih|elected/i.test(sent)) score += 2
    if (/presiden|president|pemilu|election|pemerintah|government/i.test(sent)) score += 1
    return { sent, score }
  })
  scored.sort((a, b) => b.score - a.score)
  const picked = []
  let len = 0
  for (const { sent } of scored) {
    if (picked.length >= 3) break
    if (picked.length > 0 && len + sent.length > max) break
    picked.push(sent)
    len += sent.length + 1
  }
  if (picked.length === 0) return clean.slice(0, max).trim()
  return picked.join(' ').slice(0, max).trim() + '…'
}

/* ===== BACA ISI ARTIKEL =====
 * Ambil teks asli halaman sumber (bukan cuma judul/ringkasan) supaya model
 * menjawab berdasarkan isi berita/artikel sungguhan. */
const ARTICLE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id,en;q=0.8',
}

function decodeHtmlEntities(t) {
  return String(t || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/* Ekstraksi teks dari HTML: buang navigasi/iklan/script, ambil <p>/heading. */
function extractArticleText(html) {
  const src = String(html || '')
  if (!src || !src.includes('<')) return src.slice(0, 2000)
  const title = (src.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''
  let body = src
  const article = src.match(/<article[\s\S]*?<\/article>/i)
  const main = src.match(/<main[\s\S]*?<\/main>/i)
  if (article) body = article[0]
  else if (main) body = main[0]

  const cleaned = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')

  const blocks = cleaned.match(/<(?:p|h[1-6]|li|blockquote)[^>]*>[\s\S]*?<\/(?:p|h[1-6]|li|blockquote)>/gi) || []
  const seen = new Set()
  const paragraphs = []
  for (const b of blocks) {
    const t = decodeHtmlEntities(b.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length < 40 || seen.has(t)) continue
    seen.add(t)
    paragraphs.push(t)
    if (paragraphs.length >= 25) break
  }
  const head = decodeHtmlEntities(title.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  return [head, ...paragraphs].filter(Boolean).join('\n').slice(0, 2600)
}

function isSafeArticleUrl(url) {
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol)) return false
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.endsWith('.internal')) return false
    return true
  } catch {
    return false
  }
}

async function fetchDirectArticle(url, ms = 6000) {
  const { signal, timer } = withTimeout(ms)
  try {
    const res = await fetch(url, { signal, headers: ARTICLE_HEADERS, redirect: 'follow', cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return extractArticleText(await res.text())
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

/* Fallback: pembaca gratis r.jina.ai (tanpa API key) untuk situs yang
 * memblokir scraper / butuh render JS. */
async function fetchViaReader(url, ms = 8000) {
  const { signal, timer } = withTimeout(ms)
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal,
      headers: { 'User-Agent': 'ZancoAI-Chatbot/1.0 (https://zanco-ai.vercel.app)' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const clean = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim()
    return clean.length > 200 ? clean.slice(0, 2600) : ''
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

async function fetchArticleText(url) {
  if (!isSafeArticleUrl(url)) return ''
  let text = await fetchDirectArticle(url)
  if (text.length < 300) text = await fetchViaReader(url)
  return text
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
const SEARCH_NOISE = /arti kata|kbbi|wikikamus|youtube|karaoke|karoke/i

async function searchBing(query) {
  const xml = await fetchText(BING_RSS_URL(query), TIMEOUT_MS.bing)
  return parseRssItems(xml).filter((r) => !SEARCH_NOISE.test(r.title)).slice(0, 5)
}

async function searchBingNews(query) {
  const xml = await fetchText(BING_NEWS_URL(query), TIMEOUT_MS.bingNews)
  return parseRssItems(xml).map((r) => ({ ...r, source: r.source || 'Bing News' })).slice(0, 4)
}

/* ===== Wikipedia (id + en) ===== */
async function searchWikipedia(query, lang) {
  const api = WIKI_APIS[lang]
  const variants = wikiVariants(query, lang)
  const seen = new Set()
  const results = []

  for (const v of variants) {
    const url =
      `${api}?action=query&generator=search&gsrsearch=${encodeURIComponent(v)}` +
      `&gsrlimit=6&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json`
    const data = await fetchJson(url, TIMEOUT_MS.wiki)
    const pages = Object.values(data?.query?.pages || {})
      .sort((a, b) => (a.index || 99) - (b.index || 99))
      .slice(0, 6)

    for (const p of pages) {
      if (!p.title || !p.extract) continue
      const title = p.title.replace(/ \(disambiguation\)$/i, '')
      const key = title.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const pageUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
      results.push(makeResult(title, pageUrl, smartExcerpt(stripHtml(p.extract)), `Wikipedia (${lang === 'id' ? 'Indonesia' : 'English'})`))
    }
  }
  // Artikel jawaban faktual dulu; noise (turnamen/tahun/judul tak berhubungan) terakhir
  const kw = [...new Set([cleanQuery(query), toEnglish(cleanQuery(query))].filter(Boolean).flatMap((q) => q.split(' ')))]
    .filter((w) => w.length > 2)
  const relatedPattern = /daftar|list of|presiden|president|wakil|vice|indonesia|pemilu|election|ibu kota|capital|pemerintahan|government|menteri|minister|gubernur|governor/i
  results.sort((a, b) => {
    const score = (r) => {
      let v = 0
      if (WIKI_NOISE.test(r.title)) v += 2
      if (WIKI_YEARLY.test(r.title)) v += 1
      const t = r.title.toLowerCase()
      if (!kw.some((w) => t.includes(w)) && !relatedPattern.test(t)) v += 1
      return v
    }
    return score(a) - score(b)
  })
  return results.slice(0, 5)
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

/* ===== Claude-grade sources (SearXNG + Jina Reader + Reddit) =====
 * Inspired by: mcp-searxng, webfetch, agent-asearch, jina.ai reader
 */
const SEARX_INSTANCES = [
  'https://searx.be',
  'https://search.sapti.me',
  'https://searx.tiekoetter.com',
  'https://searx.prvcy.eu',
]

async function searchSearx(query, limit = 8) {
  const q = encodeURIComponent(query)
  for (const base of SEARX_INSTANCES) {
    try {
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 7000)
      const res = await fetch(
        `${base}/search?q=${q}&format=json&language=id-ID&categories=general`,
        {
          signal: ctrl.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'ZancoAI-Research/2.0' },
        },
      )
      clearTimeout(to)
      if (!res.ok) continue
      const data = await res.json()
      const results = Array.isArray(data?.results) ? data.results : []
      return results
        .slice(0, limit)
        .map((r) => ({
          title: r.title || 'Hasil',
          url: r.url || r.pretty_url || '',
          excerpt: String(r.content || r.snippet || '').slice(0, 280),
          source: 'SearXNG',
        }))
        .filter((r) => r.url)
    } catch {
      /* next instance */
    }
  }
  return []
}

async function fetchJinaMarkdown(url) {
  if (!url || !/^https?:\/\//i.test(url)) return ''
  try {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: ctrl.signal,
      headers: {
        Accept: 'text/plain',
        'User-Agent': 'ZancoAI-Research/2.0',
        'X-Return-Format': 'markdown',
      },
    })
    clearTimeout(to)
    if (!res.ok) return ''
    const body = await res.text()
    return body
      .replace(/^Title:.*$/m, '')
      .replace(/^URL Source:.*$/m, '')
      .replace(/^Markdown Content:/m, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 4000)
  } catch {
    return ''
  }
}

async function searchReddit(query, limit = 5) {
  try {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${limit}&sort=relevance`,
      { signal: ctrl.signal, headers: { 'User-Agent': 'ZancoAI-Research/2.0' } },
    )
    clearTimeout(to)
    if (!res.ok) return []
    const data = await res.json()
    const children = data?.data?.children || []
    return children
      .map((c) => {
        const d = c.data || {}
        return {
          title: d.title || 'Reddit',
          url: d.url?.startsWith('http') ? d.url : `https://reddit.com${d.permalink || ''}`,
          excerpt: String(d.selftext || d.title || '').slice(0, 280),
          source: 'Reddit',
        }
      })
      .filter((r) => r.url)
  } catch {
    return []
  }
}

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
    searchSearx(q, 8),
    searchReddit(q, 4),
    searchGitHub(q),
    searchDuckDuckGo(q),
  ]

  const settledJobs = await Promise.allSettled(jobs)

  const [suggest] = await Promise.allSettled([searchGoogleSuggest(q)])

  const results = []
  for (const settled of settledJobs) {
    if (settled.status === 'fulfilled' && Array.isArray(settled.value)) {
      results.push(...settled.value)
    }
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

  // Urutkan agar sumber ensiklopedia/faktual (Wikipedia) tampil lebih dulu
  unique.sort((a, b) => sourceRank(a.source) - sourceRank(b.source))

  // BACA ISI ARTIKEL dari 3 sumber teratas (paralel) — model menjawab
  // berdasarkan isi berita/artikel sungguhan, bukan cuma judul/ringkasan.
  // Kegagalan satu halaman tidak menggagalkan yang lain.
  // Pilih 3 artikel dari SUMBER BERBEDA (mis. Wikipedia ID, Wikipedia EN, berita)
  const readTargets = []
  const seenSrc = new Set()
  for (const r of unique) {
    if (seenSrc.has(r.source)) continue
    seenSrc.add(r.source)
    readTargets.push(r)
    if (readTargets.length >= 3) break
  }
  const contents = await Promise.allSettled(
    readTargets.map(async (r) => {
      const jina = await fetchJinaMarkdown(r.url)
      if (jina && jina.length >= 200) return jina
      return fetchArticleText(r.url)
    }),
  )
  readTargets.forEach((r, i) => {
    const c = contents[i]
    if (c?.status === 'fulfilled' && c.value && c.value.length >= 300) {
      r.content = c.value
    }
  })

  return { ok: true, results: unique, related: related.slice(0, 5) }
}

/** Pilih hasil beragam dari SEMUA sumber, tapi batasi jumlahnya agar aman
 * dari limit TPM Groq (pesan besar -> error 413). Tetap mewakili semua
 * sumber: 1 hasil per sumber dulu, sisanya diisi sampai `max`. */
export function pickDiverseResults(results = [], max = 14) {
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

/** Format hasil web menjadi teks yang bisa dibaca model AI.
 * Sertakan ISI ARTIKEL yang berhasil dibaca dari halaman sumber. */
export function formatWebResults(results = [], related = []) {
  const diverse = pickDiverseResults(results, 12)
  const withContent = diverse.filter((r) => r.content && r.content.length >= 300).slice(0, 3)
  const lines = []
  lines.push('HASIL PENCARIAN (judul + ringkasan):')
  for (const [i, r] of diverse.entries()) {
    lines.push(`[${i + 1}] ${r.title}\nSumber: ${r.source || 'Web'}\n${r.excerpt}`)
  }
  if (withContent.length > 0) {
    lines.push('\n\nISI ARTIKEL (Jina/scrape — bukti untuk jawaban akurat):')
    for (const [i, r] of withContent.entries()) {
      lines.push(`[Artikel ${i + 1}] ${r.title} (${r.source})\nURL: ${r.url}\n${r.content.slice(0, 2200)}`)
    }
  }
  if (related.length > 0) {
    lines.push(`\n🔎 Pencarian terkait (Google): ${related.join(', ')}`)
  }
  return lines.join('\n\n')
}
