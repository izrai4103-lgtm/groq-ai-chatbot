/* ============================================================
 * 🖐️ Website Controller — definisi tool sisi server
 * ============================================================
 * Skema tool (OpenAI-style, dipakai langsung oleh Groq) untuk
 * AI Website Controller. Tool ini TIDAK dieksekusi di server —
 * aksinya (klik/isi form/navigasi/scroll/baca DOM) hanya bisa
 * dijalankan di browser, oleh public/ai-website-controller.js.
 *
 * Alur: model minta aksi → engine kirim websiteAction ke frontend
 * → frontend eksekusi via AIWebsiteController.executeAction →
 * hasilnya dikirim balik ke model sebagai pesan baru → model
 * melanjutkan sampai jawaban final.
 */

export const WEBSITE_TOOL_NAMES = new Set([
  'click_element',
  'fill_input',
  'navigate_to',
  'scroll_to_element',
  'get_page_context',
])

export interface WebsiteAction {
  name: string
  arguments: Record<string, unknown>
}

export const WEBSITE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'click_element',
      description:
        'Klik sebuah elemen di halaman (tombol, link, dll) berdasarkan CSS selector. Contoh: "#submit-btn".',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector elemen yang mau diklik' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_input',
      description:
        'Isi input atau textarea di halaman dengan teks tertentu (misal isi form nama/email). Contoh selector: "#email" atau "[name=email]".',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector input yang mau diisi' },
          value: { type: 'string', description: 'Nilai yang mau diisi ke input tersebut' },
        },
        required: ['selector', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate_to',
      description:
        'Pindah/navigasi user ke halaman lain di website yang sama (same-origin). Contoh: "/kontak".',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Path atau URL tujuan, misal "/kontak"' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll_to_element',
      description: 'Scroll halaman ke posisi elemen tertentu berdasarkan CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector elemen tujuan scroll' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_context',
      description:
        'Ambil daftar tombol, link, dan input yang ada di halaman saat ini, supaya kamu tahu apa saja yang bisa dilakukan sebelum mengambil aksi.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

export const WEBSITE_CONTROL_PROMPT = `
## KENDALI WEBSITE (AI Website Controller)

Kamu bisa mengendalikan halaman website ini sendiri lewat 5 tool browser:
1. get_page_context — lihat tombol/link/input apa saja yang ada di halaman saat ini.
2. click_element — klik tombol/link berdasarkan CSS selector.
3. fill_input — isi form (nama, email, dll) berdasarkan CSS selector + value.
4. navigate_to — pindah ke halaman lain di website ini (same-origin saja).
5. scroll_to_element — scroll ke bagian tertentu halaman.

Gunakan tool ini HANYA saat user minta kamu melakukan aksi nyata di website ini
(misal: "isi form kontak", "klik tombol X", "scroll ke bagian Y", "pindah ke halaman Z").
Kalau user hanya bertanya atau ngobrol biasa, JANGAN panggil tool ini — jawab langsung.

Alur:
- Belum tahu apa yang bisa dilakukan di halaman → panggil get_page_context dulu.
- Setiap aksi yang kamu panggil benar-benar dieksekusi di browser user oleh
  frontend, lalu hasilnya dikirim balik ke kamu sebagai pesan user berikutnya.
- Pakai selector dari hasil get_page_context (contoh "#submit-btn", "[name=email]").
- Kalau hasil aksi success:false, kabari user dengan jujur — jangan mengarang
  bahwa aksi berhasil.
- Maksimal 4 aksi per permintaan user, lalu jawab user dengan ringkas.
`
