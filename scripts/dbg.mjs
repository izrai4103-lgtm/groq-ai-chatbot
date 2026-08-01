import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
const PORT = 3457
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { stdio: 'ignore' })
const wait = () => new Promise((res, rej) => {
  const t = () => http.get(`http://localhost:${PORT}`, r => { r.resume(); res() }).on('error', () => setTimeout(t, 500))
  t()
})
await wait()
const b = await chromium.launch()
const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const p = await c.newPage()
p.on('console', m => console.log('[console]', m.type(), m.text().slice(0, 200)))
p.on('pageerror', e => console.log('[pageerror]', e.message))
await p.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
console.log('innerWidth:', await p.evaluate(() => innerWidth))
console.log('mq768:', await p.evaluate(() => matchMedia('(max-width: 768px)').matches))
console.log('sidebar class:', await p.evaluate(() => document.querySelector('.sidebar')?.className))
console.log('sidebar rect:', JSON.stringify(await p.evaluate(() => { const r = document.querySelector('.sidebar').getBoundingClientRect(); return { x: r.x, w: r.width } })))
await b.close()
server.kill('SIGTERM')
process.exit(0)
