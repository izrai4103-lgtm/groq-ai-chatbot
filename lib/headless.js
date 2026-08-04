'use strict'

/* ============================================================
 * 🌐 Headless browser helper — dipakai AI Website Controller.
 * Chromium dari @sparticuz/chromium + puppeteer-core (Vercel-ready).
 * Pola yang sama sudah dipakai lib/portfolioPdfTool.js.
 *
 * Setiap request memakai browser context terpisah (incognito),
 * jadi cookie/sesi antar user tidak saling tercampur.
 * ============================================================ */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

let browserPromise = null

async function getBrowser() {
  if (!browserPromise) {
    // puppeteer-core v23+ ESM-only: wajib pakai dynamic import()
    const chromiumMod = await import('@sparticuz/chromium')
    const chromium = chromiumMod.default || chromiumMod
    const puppeteerMod = await import('puppeteer-core')
    const puppeteer = puppeteerMod.default || puppeteerMod
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH || (await chromium.executablePath())
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath,
      dumpio: process.env.PUPPETEER_DUMPIO === '1',
      args: [
        ...(chromium.args || []),
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
      ],
    })
    browserPromise.catch(() => {
      browserPromise = null
    })
  }
  return browserPromise
}

async function newPage() {
  const browser = await getBrowser()
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  page.setDefaultNavigationTimeout(25_000)
  await page.setViewport({ width: 1280, height: 900 })
  await page.setUserAgent(UA)
  page.on('dialog', (dialog) => {
    dialog.dismiss().catch(() => {})
  })
  return { page, context }
}

export { getBrowser, newPage }
