// Preview & feature tester gabungan: mobile (390x844) + desktop (1440x900)
// Screenshots ke preview-mobile/ & preview-desktop/, plus assertions posisi/overflow.
import { chromium } from 'playwright'
const mark = m => fs.writeSync(1, `[${new Date().toISOString().slice(11,19)}] ${m}\n`)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'

const PORT = 3480 + Math.floor(Math.random() * 200)
const BASE = `http://localhost:${PORT}`

function waitForServer(url, timeoutMs = 90000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, res => { res.resume(); resolve() }).on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error('server timeout'))
        setTimeout(tick, 500)
      })
    }
    tick()
  })
}

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
let serverFailed = false
server.stdout.on('data', d => process.stdout.write(d))
server.stderr.on('data', d => { process.stderr.write(d); if (String(d).includes('Failed to start server') || String(d).includes('EADDRINUSE')) serverFailed = true })

const measure = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }
}, sel)

const pageOverflow = page => page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  bodyScrollW: document.body.scrollWidth,
}))

async function runDevice(browser, viewport, outDir, label, withChat) {
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const mobile = viewport.width < 500
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()
  mark('mulai-device ' + label)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const shot = n => page.screenshot({ path: `${outDir}/${n}.png` })
  const checks = []
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

  // Overflow horizontal
  const ov = await pageOverflow(page)
  check('no-horizontal-overflow', ov.scrollW <= ov.clientW && ov.bodyScrollW <= ov.clientW, JSON.stringify(ov))

  // Sidebar
  const sb = await measure(page, '.sidebar')
  if (mobile) {
    check('sidebar-tutup-default-mobile', !!(sb && sb.x < 0 && sb.right <= 0), JSON.stringify(sb))
  } else {
    check('sidebar-terbuka-default-desktop', !!(sb && sb.x === 0 && sb.w >= 240), JSON.stringify(sb))
  }
  await shot('01-beranda')

  // Toggle sidebar (mobile: tutup->buka; desktop: buka->tutup->buka)
  await page.locator('button[title="Toggle sidebar"]').first().click()
  await page.waitForTimeout(500)
  let sbOpen = await measure(page, '.sidebar')
  if (!mobile) {
    check('sidebar-tutup-setelah-klik-desktop', !!(sbOpen && sbOpen.x < 0), JSON.stringify(sbOpen))
    await page.locator('button[title="Toggle sidebar"]').first().click()
    await page.waitForTimeout(500)
    sbOpen = await measure(page, '.sidebar')
  }
  check('sidebar-terbuka-setelah-toggle', !!(sbOpen && sbOpen.x >= 0 && sbOpen.w > 200), JSON.stringify(sbOpen))
  await shot('02-sidebar')

  // Tutup sidebar
  const closeSidebar = async () => {
    if (mobile) await page.locator('.sidebar-overlay').first().click({ position: { x: Math.min(340, viewport.width - 20), y: 400 } })
    else await page.locator('button[title="Toggle sidebar"]').first().click()
    await page.waitForTimeout(400)
  }
  await closeSidebar()
  const openSidebar = async () => {
    const st = await page.evaluate(() => {
      const sb = document.querySelector('.sidebar')
      return sb ? sb.getBoundingClientRect().x >= 0 : false
    })
    if (!st) await page.locator('button[title="Toggle sidebar"]').first().click()
    await page.waitForTimeout(400)
  }
  await openSidebar()

  // Profil
  await page.locator('.sidebar-user').first().click()
  await page.waitForTimeout(700)
  const dlg = await measure(page, '.settings')
  const cx = viewport.width / 2
  const centered = dlg && Math.abs((dlg.x + dlg.w / 2) - cx) <= 5 && dlg.x >= 0 && dlg.right <= viewport.width && dlg.y >= 0
  const fullVisible = dlg && dlg.bottom <= viewport.height && dlg.right <= viewport.width
  check('profil-di-tengah', !!centered, JSON.stringify(dlg))
  check('profil-utuh-terlihat', !!fullVisible, JSON.stringify(dlg))
  await shot('03-profil')

  await page.locator('.profile-btn-login').first().click()
  await page.waitForTimeout(500)
  await shot('04-login')
  await page.locator('.settings-close').first().click()
  await page.waitForTimeout(400)
  await openSidebar()

  // Setelan
  await page.locator('.sidebar-bt-item').filter({ hasText: 'Setelan' }).first().click()
  await page.waitForTimeout(600)
  const st = await measure(page, '.settings')
  const stOk = st && st.x >= 0 && st.right <= viewport.width && st.bottom <= viewport.height
  check('setelan-utuh-terlihat', !!stOk, JSON.stringify(st))
  await shot('05-setelan')
  await page.locator('.settings-close').first().click()
  await page.waitForTimeout(400)

  // Model picker
  await closeSidebar()
  await page.locator('.model-btn').first().click()
  await page.waitForTimeout(600)
  const mm = await measure(page, '.model-menu')
  const mmOk = mm && mm.x >= 0 && mm.right <= viewport.width && mm.y >= 0 && mm.bottom <= viewport.height
  check('menu-model-dalam-viewport', !!mmOk, JSON.stringify(mm))
  await shot('06-model-picker')
  await page.locator('.model-btn').first().click()
  await page.waitForTimeout(300)

  // Arsip
  await page.locator('button[title="Toggle sidebar"]').first().click()
  await page.waitForTimeout(400)
  await page.locator('.sidebar-bt-item').filter({ hasText: 'Arsip' }).first().click()
  await page.waitForTimeout(500)
  await shot('07-arsip')
  await page.locator('.sidebar-bt-item').filter({ hasText: 'Kembali ke chat' }).first().click()
  await page.waitForTimeout(300)
  await closeSidebar()

  // Composer utuh
  const comp = await measure(page, '.composer')
  const compOk = comp && comp.x >= 0 && comp.right <= viewport.width && comp.bottom <= viewport.height
  check('composer-utuh-terlihat', !!compOk, JSON.stringify(comp))
  await shot('08-composer')

  // Kirim chat (opsional untuk desktop, wajib mobile)
  if (withChat) {
    const ta = page.locator('textarea').first()
    await ta.fill('Halo, balas singkat saja!')
    await page.waitForTimeout(300)
    await page.locator('button[type="submit"]').first().click()
    mark('tunggu-balasan-chat')
    await page.waitForTimeout(25000)
    const lastMsg = await page.locator('.msg').last().textContent().catch(() => '')
    const hasReply = !!lastMsg && lastMsg.trim().length > 0 && !lastMsg.includes('Mengetik')
    check('chat-balasan', hasReply, lastMsg ? lastMsg.trim().slice(0, 90) : 'tidak ada balasan')
    await shot('09-chat-reply')
  }

  mark('selesai-device ' + label)
  let allOk = true
  for (const c of checks) {
    console.log(`${c.ok ? '✅ PASS' : '❌ FAIL'}  ${c.name}  ${c.detail}`)
    if (!c.ok) allOk = false
  }
  console.log(allOk ? 'SEMUA PASS ✅' : 'ADA YANG GAGAL ❌')
  return { allOk, checks }
}

try {
  if (serverFailed) throw new Error('server gagal start (port sibuk)')
  await waitForServer(BASE)
  const browser = await chromium.launch()
  const results = []
  results.push(await runDevice(browser, { width: 390, height: 844 }, 'preview-mobile', 'MOBILE', true))
  results.push(await runDevice(browser, { width: 1440, height: 900 }, 'preview-desktop', 'DESKTOP', false))
  await browser.close()
  const ok = results.every(r => r.allOk)
  console.log(`\n===== KESIMPULAN: ${ok ? 'SEMUA VIEWPORT PASS ✅' : 'ADA GAGAL ❌'} =====`)
  process.exitCode = ok ? 0 : 1
} finally {
  server.kill('SIGTERM')
}
