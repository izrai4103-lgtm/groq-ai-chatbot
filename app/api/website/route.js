'use strict'

/* ============================================================
 * 🌐 AI WEBSITE AGENT — buka & kontrol website mana pun (ala OpenClaw).
 *
 * Alur:
 *   1) LLM mengubah instruksi user jadi RENCANA (url tujuan + isian form).
 *   2) Browser headless (Chromium) membuka URL tujuan.
 *   3) Baca "peta" halaman (input, tombol, link) → LLM memetakan isian
 *      ke CSS selector → agent mengisi form / klik → halaman dicek lagi.
 *   4) LLM merangkum hasil → kirim balik ke chat (plus screenshot opsional).
 *
 * Keamanan:
 *   - Hanya mengisi nilai yang benar-benar ditulis user (tidak mengarang).
 *   - Tidak pernah menampilkan nilai isian (password/data pribadi).
 *   - Hanya URL http/https yang boleh dibuka.
 *   - Batas jumlah round & panjang instruksi.
 * ============================================================ */

import { getUserTokenStatus, deductUserTokens, getCompletionRecorded, flushTokenUsage } from '@/lib/token-usage'
import { getFeatureKeys } from '@/lib/provider-keys.js'
import { newPage, getBrowser } from '@/lib/headless.js'

export const maxDuration = 60
export const runtime = 'nodejs'

const MAX_INSTRUCTION_LEN = 1500
const MAX_ROUNDS = 3

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ============================================================
 * PROMPT agent
 * ============================================================ */

const PLAN_PROMPT = `Kamu adalah "Website Agent" (browser controller). Ubah instruksi user menjadi RENCANA aksi.
Keluarkan HANYA JSON valid dengan kunci:
- "url": URL website yang mau dibuka (tambahkan https:// kalau user cuma menulis domain). null kalau tidak ada URL yang jelas.
- "search": kata kunci pencarian kalau user menyebut nama situs tanpa URL (misal "tokopedia"), selain itu null.
- "fills": daftar field yang user MAU diisi. Tiap item {"label": "nama field dari ucapan user", "value": "nilai yang ditulis user"}. JANGAN mengarang nilai.
- "submit": true kalau user minta menekan tombol (kirim/cari/login/daftar/dll).
- "click_label": teks tombol/link yang mau diklik user (selain submit), atau null.
- "refuse": bila instruksi bukan perintah membuka/mengendalikan website, tulis alasan penolakan (string); kunci lain boleh kosong.

Aturan:
- Kalau user tidak menyebut nilai isian, masukkan field tersebut ke "fills" dengan "value": "" dan biarkan agent menanyakan.
- Jangan pernah mengarang URL, nilai isian, atau tombol yang tidak disebut user.
- Contoh: "buka website google.com lalu isi pencarian cuaca dan tekan cari" → url google.com, fills [{label:"pencarian", value:"cuaca"}], submit true.`

const MAP_PROMPT = `Kamu mengontrol browser. Berikut "peta" halaman yang sedang terbuka dalam format JSON: url, judul, daftar input, dan daftar elemen klikabel beserta selector-nya.
Instruksi user, daftar field yang masih perlu diisi, dan status submit juga diberikan.
Tentukan aksi yang bisa dilakukan SEKARANG:
- "fills": [{ "selector": "selector persis dari peta", "value": "nilai", "label": "label asal" }]
- "click": selector tombol/link yang harus diklik sekarang, atau null
- "done": true bila semua permintaan sudah dikerjakan atau tidak ada lagi yang bisa dilakukan di halaman ini
- "note": penjelasan singkat

Syarat:
- Gunakan selector PERSIS dari peta. JANGAN menebak selector yang tidak ada di peta.
- Kalau submit diminta, pilih selector tombolnya untuk "click".
- Kalau sebuah field belum muncul di peta (misal halaman belum selesai dimuat), biarkan tetap pending dan set "done": false.
Jawab HANYA JSON valid.`

const SUMMARY_PROMPT = `Kamu adalah agent "Kontrol Website". Buat ringkasan singkat untuk user dalam Bahasa Indonesia (markdown, maksimal 8 baris) dari hasil kerja agent berikut.
Tulis: website yang dibuka (URL + judul), aksi yang berhasil dilakukan (mengisi form, klik), hasil yang terlihat di halaman, dan saran lanjutan bila ada.
PENTING: JANGAN menampilkan nilai isian apa pun (password, email, data pribadi). Cukup sebut misalnya "field nama sudah diisi".
Jangan mengarang hasil yang tidak didukung fakta (url, judul, daftar aksi). Jawab HANYA teks, bukan JSON.`

/* ============================================================
 * Util LLM
 * ============================================================ */

function extractJson(text) {
  if (!text) return null
  let t = String(text).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < t.length; i++) {
    const ch = t[i]
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

async function askModel(systemPrompt, userContent, opts = {}) {
  const json = opts.json !== false
  const temperature = opts.temperature != null ? opts.temperature : 0.2
  const maxTokens = opts.maxTokens || 1000
  const timeoutMs = opts.timeoutMs || 30_000

  const keys = getFeatureKeys('chat')
  if (keys.length === 0) throw new Error('AI_MODEL_UNAVAILABLE')
  const key = keys[0]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(key.url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: key.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const hint = res.status === 429 ? ' — kuota model penuh, coba lagi sebentar' : ''
      throw new Error(`AI error (${res.status})${hint}`)
    }
    const data = await res.json()
    const text = (data.choices?.[0]?.message?.content || '').trim()
    if (!text) throw new Error('AI respon kosong')
    if (json) {
      const parsed = extractJson(text)
      if (!parsed) throw new Error('AI tidak mengembalikan JSON valid')
      return parsed
    }
    return text
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('AI timeout')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/* ============================================================
 * Util URL
 * ============================================================ */

function toUrl(input) {
  const s = String(input || '').trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  if (/^www\./i.test(s)) return 'https://' + s
  if (/^[\w-]+(\.[\w-]+)+(\/[^\s]*)?$/i.test(s)) return 'https://' + s
  return null
}

function searchUrl(query) {
  return 'https://www.google.com/search?q=' + encodeURIComponent(String(query || ''))
}

/* ============================================================
 * Aksi browser
 * ============================================================ */

async function gotoPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
  await sleep(1000)
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
}

async function getPageContext(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      const cs = window.getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    }
    const cssPath = (el) => {
      if (el.id) return '#' + CSS.escape(el.id)
      const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const nm = el.getAttribute && el.getAttribute('name')
      if (nm) return '[name="' + esc(nm) + '"]'
      const tag = (el.tagName || '').toLowerCase()
      const ph = el.getAttribute && el.getAttribute('placeholder')
      if (ph && (tag === 'input' || tag === 'textarea')) {
        return tag + '[placeholder="' + esc(ph) + '"]'
      }
      let path = tag
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : []
      if (cls.length) path += '.' + cls.map((c) => CSS.escape(c)).join('.')
      return path
    }
    const inputs = []
    Array.from(document.querySelectorAll('input, textarea, select')).slice(0, 40).forEach((el) => {
      if (!visible(el)) return
      const label = (el.labels && el.labels[0] && el.labels[0].innerText) || ''
      inputs.push({
        tag: el.tagName.toLowerCase(),
        name: el.getAttribute('name') || '',
        id: el.id || '',
        type: el.type || '',
        placeholder: el.placeholder || '',
        aria: el.getAttribute('aria-label') || '',
        label: String(label).trim().slice(0, 80),
        selector: cssPath(el),
      })
    })
    const clickables = []
    Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')).slice(0, 40).forEach((el) => {
      if (!visible(el)) return
      const text = (el.innerText || el.value || '').trim().slice(0, 60)
      if (!text) return
      clickables.push({
        tag: el.tagName.toLowerCase(),
        text,
        href: el.getAttribute('href') || '',
        selector: cssPath(el),
      })
    })
    return {
      url: window.location.href,
      title: document.title || '',
      inputs,
      clickables,
      text: String(document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200),
    }
  })
}

async function fillField(page, selector, value) {
  const el = await page.$(selector)
  if (!el) throw new Error('Elemen tidak ditemukan: ' + selector)
  const tag = await el.evaluate((node) => node.tagName)
  if (tag === 'SELECT') {
    await page.select(selector, String(value))
    return { ok: true, desc: 'Memilih opsi pada ' + selector }
  }
  await el.evaluate((node) => {
    node.focus()
    if (typeof node.select === 'function') node.select()
  }).catch(() => {})
  await page.keyboard.press('Backspace')
  await el.type(String(value), { delay: 6 })
  await el.evaluate((node) => {
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }).catch(() => {})
  return { ok: true, desc: 'Mengisi ' + selector }
}

async function clickSelector(page, selector) {
  const el = await page.$(selector)
  if (!el) throw new Error('Elemen tidak ditemukan: ' + selector)
  const visible = await el.evaluate((node) => {
    const r = node.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
  if (visible) {
    await el.click({ timeout: 5000 }).catch(() => el.evaluate((node) => node.click()).catch(() => {}))
  } else {
    await el.evaluate((node) => node.click()).catch(() => {})
  }
  await sleep(1500)
}

/* ============================================================
 * AGENT utama
 * ============================================================ */

async function runAgent(instruction) {
  const plan = await askModel(PLAN_PROMPT, instruction, { json: true, maxTokens: 900 })
  if (plan && plan.refuse) {
    return { success: false, error: String(plan.refuse) }
  }

  let page = null
  let context = null
  try {
    const opened = await newPage()
    page = opened.page
    context = opened.context
  } catch (err) {
    // Diagnostik: cek apakah proses Chromium di-kill (SIGKILL/OOM) atau keluar sendiri
    try {
      const browser = await getBrowser()
      const proc = browser && browser.process && browser.process()
      if (proc) {
        console.error('[website-agent] chromium proc:', {
          exitCode: proc.exitCode,
          signalCode: proc.signalCode,
          killed: proc.killed,
        })
      }
    } catch {}
    throw err
  }
  try {
    let url = toUrl(plan && plan.url)
    if (!url && plan && plan.search) url = searchUrl(plan.search)
    if (!url) {
      const inline = String(instruction).match(/https?:\/\/[^\s]+/i)
      if (inline) url = inline[0].replace(/[.,;:'"!?)\]]+$/, '')
    }
    if (!url) {
      return { success: false, error: 'Ketik URL website yang mau dibuka, misal: "buka website https://contoh.com".' }
    }

    await gotoPage(page, url)

    const fills = Array.isArray(plan && plan.fills) ? plan.fills : []
    let submit = Boolean(plan && plan.submit)
    let clickLabel = (plan && plan.click_label) || null

    const actions = []
    let finalUrl = url
    let finalTitle = ''
    let note = ''
    let pending = fills.slice()

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const ctx = await getPageContext(page)
      finalUrl = ctx.url || finalUrl
      finalTitle = ctx.title || finalTitle

      const remaining = pending.filter((f) => f && f.label && f.value !== undefined && f.value !== null)
      if (remaining.length === 0 && !submit && !clickLabel) {
        if (actions.length === 0) note = 'Halaman berhasil dibuka.'
        break
      }
      if (ctx.inputs.length === 0 && ctx.clickables.length === 0) {
        note = 'Halaman ini tidak menampilkan elemen yang bisa diisi/diklik.'
        break
      }

      const map = await askModel(
        MAP_PROMPT,
        JSON.stringify({
          instruction,
          page: ctx,
          pendingFills: remaining.map((f) => ({ label: f.label, value: f.value })),
          submit,
          clickLabel,
        }),
        { json: true, maxTokens: 1000 },
      )
      if (!map) break

      let didSomething = false
      const mapped = Array.isArray(map.fills) ? map.fills : []
      for (const mf of mapped) {
        if (!mf || !mf.selector || mf.value === undefined || mf.value === null) continue
        let r = null
        try {
          r = await fillField(page, mf.selector, mf.value)
          if (r && r.ok) {
            didSomething = true
            if (!actions.includes(r.desc)) actions.push(r.desc)
          }
        } catch (e) {
          const desc = 'Gagal isi ' + (mf.selector || '?') + ': ' + (e && e.message ? e.message : 'error')
          if (!actions.includes(desc)) actions.push(desc)
        }
        // Tandai field sudah diisi: cocokkan label ATAU nilai persis.
        const lbl = String(mf.label || '').trim().toLowerCase()
        const val = String(mf.value ?? '')
        pending = pending.filter((f) => {
          const fLabel = String((f && f.label) || '').trim().toLowerCase()
          const fVal = String((f && f.value) ?? '')
          const labelMatch = lbl && fLabel && (fLabel.includes(lbl) || lbl.includes(fLabel))
          const valMatch = val && fVal === val
          return !(labelMatch || valMatch)
        })
      }

      const clickSel = map.click || null
      if (clickSel) {
        try {
          await clickSelector(page, clickSel)
          const desc = 'Mengklik ' + clickSel
          if (!actions.includes(desc)) actions.push(desc)
          didSomething = true
        } catch (e) {
          const desc = 'Gagal klik ' + clickSel + ': ' + (e && e.message ? e.message : 'error')
          if (!actions.includes(desc)) actions.push(desc)
        }
        submit = false
        clickLabel = null
        continue
      }

      if (map.done) {
        note = map.note || ''
        break
      }
      if (!didSomething) {
        note = map.note || 'Tidak ada aksi tambahan yang bisa dilakukan.'
        break
      }
    }

    let pageSnippet = ''
    try {
      const ctxFinal = await getPageContext(page)
      pageSnippet = ctxFinal.text || ''
    } catch { pageSnippet = '' }

    const summary = await askModel(
      SUMMARY_PROMPT,
      JSON.stringify({ instruction, url: finalUrl, title: finalTitle, actions, note, pageSnippet: pageSnippet.slice(0, 1200) }),
      { json: false, temperature: 0.4, maxTokens: 700 },
    )

    let screenshotUrl = null
    try {
      const shot = await page.screenshot({ type: 'jpeg', quality: 55 })
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const { put } = await import('@vercel/blob')
        const blob = await put('website-agent/agent-' + Date.now() + '.jpg', shot, {
          access: 'public',
          addRandomSuffix: true,
        })
        screenshotUrl = blob.url
      }
    } catch { screenshotUrl = null }

    return {
      success: true,
      content: summary || note || 'Selesai.',
      website: { url: finalUrl, title: finalTitle, actions, screenshotUrl },
    }
  } finally {
    if (context) await context.close().catch(() => {})
    else if (page) await page.close().catch(() => {})
    // Bersihkan cookie biar sesi antar-user tidak tercampur
    try {
      const b = await getBrowser()
      if (b && b.defaultBrowserContext) await b.defaultBrowserContext().clearCookies()
    } catch {}
  }
}

/* ============================================================
 * Route handler
 * ============================================================ */

export async function POST(request) {
  try {
    const body = (await request.json().catch(() => null)) || {}
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''

    if (!instruction) {
      return Response.json({ error: 'Instruksi diperlukan' }, { status: 400 })
    }
    if (instruction.length > MAX_INSTRUCTION_LEN) {
      return Response.json(
        { error: 'Instruksi terlalu panjang (maks ' + MAX_INSTRUCTION_LEN + ' karakter)' },
        { status: 400 },
      )
    }

    const guestId = typeof body.guestId === 'string' ? body.guestId.trim().slice(0, 64) : ''
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'anonymous'
    const isLoggedIn = guestId !== ''
    const userKey = isLoggedIn ? guestId : 'ip:' + ip

    const userStatus = await getUserTokenStatus(userKey, isLoggedIn)
    if (userStatus && userStatus.remaining <= 0) {
      return Response.json(
        { error: 'Kuota token kamu habis. Reset otomatis dalam 1 menit.', tokenUsage: userStatus },
        { status: 429 },
      )
    }

    const before = getCompletionRecorded()
    const result = await runAgent(instruction)
    await flushTokenUsage()

    let spent = getCompletionRecorded() - before
    if (!Number.isFinite(spent) || spent <= 0) {
      spent = Math.max(96, Math.ceil(instruction.length / 4) + 240)
    }
    const tokenUsage =
      (await deductUserTokens(userKey, isLoggedIn, spent)) ||
      (await getUserTokenStatus(userKey, isLoggedIn))

    if (!result.success) {
      return Response.json({ success: false, error: result.error, tokenUsage })
    }
    return Response.json({ ...result, tokenUsage })
  } catch (err) {
    console.error('Website agent error:', err)
    const msg = err && err.message ? err.message : 'Terjadi kesalahan'
    return Response.json({ error: 'Gagal menjalankan agent website: ' + msg }, { status: 500 })
  }
}
