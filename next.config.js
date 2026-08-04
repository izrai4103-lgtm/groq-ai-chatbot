/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pdf-parse (pdfjs) butuh akses worker aslinya dari node_modules,
    // jadi dijalankan sebagai modul eksternal server (bukan di-bundle webpack).
    serverComponentsExternalPackages: ['pdf-parse', 'puppeteer-core', '@sparticuz/chromium'],
    outputFileTracingIncludes: {
      '/api/upload': [
        './node_modules/pdf-parse/dist/**/*',
        './node_modules/@napi-rs/canvas/**/*',
        './node_modules/@napi-rs/canvas-linux-*/**/*',
      ],
      // Agent kendali website butuh binary Chromium (headless browser)
      '/api/website': [
        './node_modules/@sparticuz/chromium/bin/**/*',
        './node_modules/@sparticuz/chromium/**/*',
      ],
      '/api/chat': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    },
  },
}
module.exports = nextConfig
