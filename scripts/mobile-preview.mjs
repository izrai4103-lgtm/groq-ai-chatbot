// Mobile preview & feature tester (Playwright) — iPhone 12/13 viewport (390x844)
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'

const PORT = 3456
const BASE = `http://localhost:${PORT}`
const OUT = 'preview-mobile'
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

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
server.stdout.on('data', d => process.stdout.write(d))
server.stderr.on('data', d => process.stderr.write(d))

try {
  await waitForServer(BASE)
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const shot = n => page.screenshot({ path: `${OUT}/${n}.png` })
  const sidebarState = () => page.evaluate(() => ({
    cls: document.querySelector('.sidebar')?.className || '',
    x: Math.round(document.querySelector('.sidebar')?.getBoundingClientRect().x || 0),
  }))
  const measure = sel => page.evaluate(s => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }
  }, sel)
  const checks = []
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

  console.log('— beranda —')
  await shot('01-beranda')

  const sb = await measure('.sidebar')
  const sState = await sidebarState()
  console.log('SIDEBAR STATE:', JSON.stringify(sState))
  check('sidebar-tutup-default-mobile', !!(sb && sb.x < 0 && sb.right <= 0), JSON.stringify(sb))
  await page.locator('button[title="Toggle sidebar"]').first().click()
  await page.waitForTimeout(600)
  const sbOpen = await measure('.sidebar')
  check('sidebar-terbuka-setelah-klik', !!(sbOpen && sbOpen.x >= 0 && sbOpen.w > 200), JSON.stringify(sbOpen))
  await shot('02-sidebar')

  // Tutup lagi lewat scrim (pola drawer mobile)
  const closeSidebar = () => page.locator('.sidebar-overlay').first().click({ position: { x: 330, y: 400 } })
  const openSidebar = () => page.locator('button[title="Toggle sidebar"]').first().click()
  await closeSidebar()
  await page.waitForTimeout(600)
  await shot('03-sidebar-tutup')
  await openSidebar()
  await page.waitForTimeout(500)

  console.log('— profil —')
  await page.locator('.sidebar-user').first().click()
  await page.waitForTimeout(800)
  const ov = await measure('.settings-overlay')
  const dlg = await measure('.settings')
  console.log('OVERLAY:', JSON.stringify(ov))
  console.log('DIALOG :', JSON.stringify(dlg))
  const centered = dlg && Math.abs((dlg.x + dlg.w / 2) - 195) <= 4 && dlg.x >= 0 && dlg.right <= 390 && dlg.y >= 0
  const fullVisible = dlg && dlg.bottom <= 844 && dlg.right <= 390
  check('profil-di-tengah', !!centered, JSON.stringify(dlg))
  check('profil-utuh-terlihat', !!fullVisible, JSON.stringify(dlg))
  await shot('04-profil')

  await page.locator('.profile-btn-login').first().click()
  await page.waitForTimeout(600)
  await shot('05-login')
  await page.locator('.settings-close').first().click()
  await page.waitForTimeout(500)

  console.log('— setelan —')
  await page.locator('.sidebar-bt-item').filter({ hasText: 'Setelan' }).first().click()
  await page.waitForTimeout(700)
  await shot('06-setelan')
  await page.locator('.settings-close').first().click()
  await page.waitForTimeout(500)

  console.log('— model picker —')
  await closeSidebar()
  await page.waitForTimeout(500)
  await page.locator('.model-btn').first().click()
  await page.waitForTimeout(700)
  await shot('07-model-picker')
  await page.locator('.model-btn').first().click()
  await page.waitForTimeout(400)

  console.log('— arsip —')
  await openSidebar()
  await page.waitForTimeout(500)
  await page.locator('.sidebar-bt-item').filter({ hasText: 'Arsip' }).first().click()
  await page.waitForTimeout(600)
  await shot('08-arsip')
  await page.locator('.sidebar-bt-item').filter({ hasText: 'Kembali ke chat' }).first().click()
  await page.waitForTimeout(400)
  await closeSidebar()
  await page.waitForTimeout(400)

  console.log('— kirim chat —')
  const ta = page.locator('textarea').first()
  await ta.fill('Halo! Balas singkat saja ya.')
  await page.waitForTimeout(300)
  await shot('09-composer')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(30000)
  const lastMsg = await page.locator('.msg').last().textContent().catch(() => '')
  check('chat-balasan', !!lastMsg && lastMsg.trim().length > 0, lastMsg ? lastMsg.trim().slice(0, 90) : 'tidak ada balasan')
  await shot('10-chat-reply')

  console.log('\n===== HASIL CEK MOBILE =====')
  let allOk = true
  for (const c of checks) {
    console.log(`${c.ok ? '✅ PASS' : '❌ FAIL'}  ${c.name}  ${c.detail}`)
    if (!c.ok) allOk = false
  }
  console.log(allOk ? 'SEMUA PASS ✅' : 'ADA YANG GAGAL ❌')

  await browser.close()
} finally {
  server.kill('SIGTERM')
}
