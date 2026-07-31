/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pdf-parse (pdfjs) butuh akses worker aslinya dari node_modules,
    // jadi dijalankan sebagai modul eksternal server (bukan di-bundle webpack).
    serverComponentsExternalPackages: ['pdf-parse'],
    // Pastikan worker pdfjs ikut ter-deploy ke Vercel
    outputFileTracingIncludes: {
      '/api/upload': ['./node_modules/pdf-parse/dist/**/*'],
    },
  },
}
module.exports = nextConfig
