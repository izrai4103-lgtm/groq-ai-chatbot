'use strict';

/**
 * ============================================================
 *  PORTFOLIO PDF TOOL — satu file, siap pakai
 * ============================================================
 * Kasih AI chatbot kamu (Groq, atau API lain yang kompatibel format
 * OpenAI) kemampuan untuk generate PDF portofolio profesional dari
 * data yang dikumpulkan lewat obrolan.
 *
 * INSTALL:
 *   npm install puppeteer-core @sparticuz/chromium
 *
 * CARA PAKAI (tempel di server chat kamu yang sudah ada):
 *
 *   const {
 *     generatePortfolioPdfTool,
 *     runGeneratePortfolioPdf,
 *   } = require('./portfolioPdfTool');
 *
 *   1) Tambahkan tool-nya saat panggil Groq:
 *        const response = await groq.chat.completions.create({
 *          model: 'llama-3.3-70b-versatile',
 *          messages,
 *          tools: [generatePortfolioPdfTool],
 *          tool_choice: 'auto',
 *        });
 *
 *   2) Kalau model minta panggil tool "generate_portfolio_pdf":
 *        const args = JSON.parse(toolCall.function.arguments);
 *        const result = await runGeneratePortfolioPdf(args);
 *        // result.url       -> "/portfolios/nama-abc123.pdf" (kirim ke user)
 *        // result.filePath  -> lokasi file di disk server
 *
 *      Lalu kirim hasilnya balik ke model sebagai pesan role "tool"
 *      supaya dia bisa menyampaikan link download ke user.
 *
 *   3) Di repo Next.js ini, file PDF disajikan lewat route API
 *        /api/portfolios/[file] (lihat app/api/portfolios/[file]/route.ts),
 *        jadi tidak perlu Express.
 *
 *   Tambahkan juga system prompt yang mengarahkan AI menggali data
 *   (nama, jabatan, skill, pengalaman, proyek, dst) sedikit-sedikit
 *   lewat obrolan sebelum akhirnya memanggil tool ini.
 *
 * FITUR TAMBAHAN — "buatkan portofolio dari website ini: url.com":
 *   File ini juga menyediakan tool kedua, `analyzeWebsiteTool` +
 *   `runAnalyzeWebsite`, yang membuka website beneran pakai Puppeteer
 *   (bukan sandbox bawaan AI yang suka gagal) untuk ambil judul,
 *   deskripsi, heading, cuplikan teks, screenshot, dan hasil tes dasar
 *   (status HTTP, waktu load, mobile-friendly, dll).
 *
 *   Alur yang disarankan:
 *     1. User kasih URL -> daftarkan `analyzeWebsiteTool` ke Groq
 *     2. AI panggil "analyze_website" -> kamu jalankan runAnalyzeWebsite(args)
 *        -> kirim hasilnya balik ke AI sebagai pesan role "tool"
 *     3. AI merangkum fitur/kesan website itu pakai kata-katanya sendiri
 *        dari data yang didapat, lalu panggil "generate_portfolio_pdf"
 *        (screenshot dari langkah 2 bisa ditempel ke field `screenshot`
 *        pada salah satu item `projects`, supaya muncul di PDF)
 *     4. Kamu jalankan runGeneratePortfolioPdf(args) seperti biasa
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Di Vercel (serverless) Chromium bawaan paket `puppeteer` tidak bisa
// dipakai & disk hanya /tmp yang writable, jadi kita adaptasi otomatis.
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/* ============================================================
 * 1) HELPER
 * ============================================================ */

// Escape karakter HTML supaya data user tidak merusak markup / jadi celah injeksi.
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderList(items = [], renderItem) {
  return items.map(renderItem).join('\n');
}

// Menggelap/terangkan warna hex (percent negatif = lebih gelap).
// Dipakai untuk bikin gradient header otomatis dari satu warna aksen.
function shadeColor(hex, percent) {
  const clean = (hex || '#6366F1').replace('#', '');
  const num = parseInt(
    clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean,
    16
  );
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent) / 100;
  const R = num >> 16;
  const G = (num >> 8) & 0x00ff;
  const B = num & 0x0000ff;
  const newColor =
    0x1000000 +
    (Math.round((t - R) * p) + R) * 0x10000 +
    (Math.round((t - G) * p) + G) * 0x100 +
    (Math.round((t - B) * p) + B);
  return `#${newColor.toString(16).slice(1)}`;
}

/* ============================================================
 * 2) TEMPLATE HTML — desain PDF portofolio (edit di sini kalau
 *    mau ubah tampilan/warna/layout)
 * ============================================================ */

function buildPortfolioHTML(data = {}) {
  const {
    name = 'Nama Kamu',
    title = 'Jabatan / Bidang Keahlian',
    tagline = '',
    email = '',
    phone = '',
    location = '',
    website = '',
    linkedin = '',
    github = '',
    summary = '',
    skills = [],
    experience = [],
    projects = [],
    education = [],
    certifications = [],
    accentColor = '#6366F1',
  } = data;

  const accentDark = shadeColor(accentColor, -35);

  const contactItems = [
    email && { icon: '✉', text: email },
    phone && { icon: '☎', text: phone },
    location && { icon: '📍', text: location },
    website && { icon: '🔗', text: website },
    linkedin && { icon: 'in', text: linkedin },
    github && { icon: '⌥', text: github },
  ].filter(Boolean);

  const contactHtml = renderList(
    contactItems,
    (c) => `
    <span class="contact-item"><span class="contact-icon">${escapeHtml(c.icon)}</span>${escapeHtml(c.text)}</span>
  `
  );

  const skillsHtml = renderList(skills, (s) => `<span class="skill-chip">${escapeHtml(s)}</span>`);

  const experienceHtml = renderList(
    experience,
    (exp) => `
    <div class="timeline-item">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-header">
          <h3>${escapeHtml(exp.role || '')}</h3>
          <span class="timeline-period">${escapeHtml(exp.period || '')}</span>
        </div>
        <div class="timeline-company">${escapeHtml(exp.company || '')}</div>
        ${exp.description ? `<p class="timeline-desc">${escapeHtml(exp.description)}</p>` : ''}
        ${
          Array.isArray(exp.highlights) && exp.highlights.length
            ? `
          <ul class="timeline-highlights">
            ${renderList(exp.highlights, (h) => `<li>${escapeHtml(h)}</li>`)}
          </ul>`
            : ''
        }
      </div>
    </div>
  `
  );

  const projectsHtml = renderList(
    projects,
    (p) => `
    <div class="project-card">
      ${
        p.screenshot
          ? `<img class="project-screenshot" src="${p.screenshot.startsWith('data:') ? escapeHtml(p.screenshot) : `data:image/jpeg;base64,${escapeHtml(p.screenshot)}`}" alt="Screenshot ${escapeHtml(p.name || '')}" />`
          : ''
      }
      <h3>${escapeHtml(p.name || '')}</h3>
      ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
      ${
        Array.isArray(p.tech) && p.tech.length
          ? `
        <div class="project-tech">
          ${renderList(p.tech, (t) => `<span class="tech-chip">${escapeHtml(t)}</span>`)}
        </div>`
          : ''
      }
      ${p.link ? `<div class="project-link">${escapeHtml(p.link)}</div>` : ''}
    </div>
  `
  );

  const educationHtml = renderList(
    education,
    (ed) => `
    <div class="edu-item">
      <div class="edu-header">
        <h3>${escapeHtml(ed.degree || '')}</h3>
        <span class="edu-period">${escapeHtml(ed.period || '')}</span>
      </div>
      <div class="edu-school">${escapeHtml(ed.school || '')}</div>
    </div>
  `
  );

  const certHtml = renderList(
    certifications,
    (c) => `
    <div class="cert-item">
      <span class="cert-name">${escapeHtml(c.name || '')}</span>
      <span class="cert-meta">${escapeHtml(c.issuer || '')}${c.year ? ' · ' + escapeHtml(String(c.year)) : ''}</span>
    </div>
  `
  );

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(name)} — Portfolio</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  :root {
    --accent: ${accentColor};
    --accent-dark: ${accentDark};
    --text-dark: #111827;
    --text-mid: #4b5563;
    --text-light: #6b7280;
    --border: #e5e7eb;
    --bg-soft: #f9fafb;
  }

  * { box-sizing: border-box; }
  @page { size: A4; margin: 0; }

  body {
    margin: 0;
    font-family: 'Inter', -apple-system, Segoe UI, Arial, sans-serif;
    color: var(--text-dark);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page { padding: 42px 48px 56px; }

  .hero {
    background: linear-gradient(135deg, var(--accent), var(--accent-dark));
    color: #fff;
    padding: 40px 48px;
    border-radius: 0 0 18px 18px;
    margin: -42px -48px 32px;
  }
  .hero h1 { margin: 0 0 4px; font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
  .hero .role { font-size: 15px; font-weight: 600; opacity: 0.92; margin-bottom: 6px; }
  .hero .tagline { font-size: 12.5px; opacity: 0.85; max-width: 520px; line-height: 1.5; margin-bottom: 14px; }
  .contact-row { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; }
  .contact-item { display: inline-flex; align-items: center; gap: 5px; opacity: 0.95; }
  .contact-icon { font-size: 11px; }

  h2.section-title {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    font-weight: 700;
    margin: 0 0 14px;
    padding-bottom: 6px;
    border-bottom: 2px solid var(--border);
  }

  section { margin-bottom: 26px; }
  .summary p { font-size: 12.5px; line-height: 1.7; color: var(--text-mid); margin: 0; }

  .skills-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
  .skill-chip {
    background: var(--bg-soft);
    border: 1px solid var(--border);
    color: var(--text-dark);
    font-size: 11px;
    font-weight: 500;
    padding: 5px 12px;
    border-radius: 999px;
  }

  .timeline-item { position: relative; padding-left: 20px; margin-bottom: 18px; border-left: 2px solid var(--border); }
  .timeline-item:last-child { margin-bottom: 0; }
  .timeline-dot { position: absolute; left: -6px; top: 3px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
  .timeline-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .timeline-header h3 { margin: 0; font-size: 13.5px; font-weight: 700; }
  .timeline-period { font-size: 10.5px; color: var(--text-light); white-space: nowrap; }
  .timeline-company { font-size: 11.5px; color: var(--accent); font-weight: 600; margin: 2px 0 6px; }
  .timeline-desc { font-size: 11.5px; color: var(--text-mid); line-height: 1.6; margin: 0 0 6px; }
  .timeline-highlights { margin: 0; padding-left: 16px; }
  .timeline-highlights li { font-size: 11.5px; color: var(--text-mid); line-height: 1.6; }

  .projects-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .project-card { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .project-screenshot { width: 100%; height: 110px; object-fit: cover; object-position: top; border-radius: 6px; border: 1px solid var(--border); margin-bottom: 8px; }
  .project-card h3 { margin: 0 0 6px; font-size: 12.5px; font-weight: 700; }
  .project-card p { margin: 0 0 8px; font-size: 11px; color: var(--text-mid); line-height: 1.55; }
  .project-tech { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
  .tech-chip { font-size: 9.5px; background: #fff; border: 1px solid var(--border); padding: 2px 8px; border-radius: 999px; color: var(--text-mid); }
  .project-link { font-size: 10px; color: var(--accent); word-break: break-all; }

  .edu-item { margin-bottom: 12px; }
  .edu-header { display: flex; justify-content: space-between; gap: 12px; }
  .edu-header h3 { margin: 0; font-size: 12.5px; font-weight: 700; }
  .edu-period { font-size: 10.5px; color: var(--text-light); }
  .edu-school { font-size: 11px; color: var(--text-mid); }

  .cert-item { display: flex; justify-content: space-between; font-size: 11px; padding: 6px 0; border-bottom: 1px solid var(--border); }
  .cert-item:last-child { border-bottom: none; }
  .cert-name { font-weight: 600; }
  .cert-meta { color: var(--text-light); }

  .footer {
    margin-top: 30px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    font-size: 9.5px;
    color: var(--text-light);
    text-align: center;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <h1>${escapeHtml(name)}</h1>
      <div class="role">${escapeHtml(title)}</div>
      ${tagline ? `<div class="tagline">${escapeHtml(tagline)}</div>` : ''}
      <div class="contact-row">${contactHtml}</div>
    </div>

    ${
      summary
        ? `
    <section class="summary">
      <h2 class="section-title">Tentang Saya</h2>
      <p>${escapeHtml(summary)}</p>
    </section>`
        : ''
    }

    ${
      skills.length
        ? `
    <section class="skills">
      <h2 class="section-title">Keahlian</h2>
      <div class="skills-wrap">${skillsHtml}</div>
    </section>`
        : ''
    }

    ${
      experience.length
        ? `
    <section class="experience">
      <h2 class="section-title">Pengalaman</h2>
      ${experienceHtml}
    </section>`
        : ''
    }

    ${
      projects.length
        ? `
    <section class="projects">
      <h2 class="section-title">Proyek</h2>
      <div class="projects-grid">${projectsHtml}</div>
    </section>`
        : ''
    }

    ${
      education.length
        ? `
    <section class="education">
      <h2 class="section-title">Pendidikan</h2>
      ${educationHtml}
    </section>`
        : ''
    }

    ${
      certifications.length
        ? `
    <section class="certifications">
      <h2 class="section-title">Sertifikasi</h2>
      ${certHtml}
    </section>`
        : ''
    }

    <div class="footer">Dibuat otomatis oleh AI Assistant</div>
  </div>
</body>
</html>`;
}

/* ============================================================
 * 3) RENDER HTML -> PDF (Puppeteer / Chromium headless)
 * ============================================================ */

let browserPromise = null;

// Simpan satu instance browser yang tetap nyala antar request
// (launch Chromium itu berat, ~1-2 detik kalau dibuka tiap kali).
async function getBrowser() {
  if (!browserPromise) {
    // puppeteer-core v23+ ESM-only: wajib pakai dynamic import()
    // @sparticuz/chromium v147 ekspor ESM default (Chromium class),
    // jadi akses lewat `.default` supaya executablePath/args ketemu.
    const chromiumModule = await import('@sparticuz/chromium');
    const chromium = chromiumModule.default || chromiumModule;
    const puppeteer = (await import('puppeteer-core')).default;
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH || (await chromium.executablePath());
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath,
      args: [...(chromium.args || []), '--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

async function generatePortfolioPdf(data) {
  const html = buildPortfolioHTML(data);
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return pdfBuffer;
  } finally {
    await page.close();
  }
}

// Panggil ini saat proses server dimatikan (graceful shutdown), opsional.
async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

/* ============================================================
 * 3B) ANALISIS WEBSITE — kunjungi URL pakai Puppeteer beneran
 *     (bukan sandbox browsing AI yang suka gagal), lalu ambil
 *     info + screenshot + hasil tes dasar
 * ============================================================ */

function normalizeUrl(rawUrl) {
  const trimmed = (rawUrl || '').trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Kunjungi sebuah website, ambil data mentahnya (bukan kesimpulan —
 * itu tugas AI di percakapan). Dipakai lewat tool "analyze_website".
 * @param {string} rawUrl
 * @param {{timeout?: number}} options
 */
async function analyzeWebsite(rawUrl, options = {}) {
  const url = normalizeUrl(rawUrl);
  const timeout = options.timeout || 20000;
  const browser = await getBrowser();
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    await page.setViewport({ width: 1280, height: 800 });

    const start = Date.now();
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout });
    const loadTimeMs = Date.now() - start;

    const pageData = await page.evaluate(() => {
      const getMeta = (attr, value) => {
        const el = document.querySelector(`meta[${attr}="${value}"]`);
        return el ? el.getAttribute('content') || '' : '';
      };

      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .map((h) => h.textContent.trim())
        .filter(Boolean)
        .slice(0, 25);

      const images = Array.from(document.querySelectorAll('img'));
      const imagesWithoutAlt = images.filter((img) => !img.getAttribute('alt')).length;

      const links = Array.from(document.querySelectorAll('a[href]'));
      const internalLinks = links.filter((a) => {
        try {
          return new URL(a.href).origin === window.location.origin;
        } catch {
          return false;
        }
      }).length;

      const bodyText = document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : '';

      return {
        title: document.title || '',
        metaDescription: getMeta('name', 'description') || getMeta('property', 'og:description') || '',
        headings,
        totalImages: images.length,
        imagesWithoutAlt,
        internalLinks,
        externalLinks: links.length - internalLinks,
        mobileFriendly: !!document.querySelector('meta[name="viewport"]'),
        // Cuplikan teks visible di halaman — dipakai AI utk merangkum FITUR
        // dgn kata2 sendiri, BUKAN utk disalin mentah2 ke PDF (soal hak cipta).
        textSnippet: bodyText.slice(0, 1500),
      };
    });

    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 70 });
    const screenshotBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;

    return {
      ok: true,
      url,
      statusCode: response ? response.status() : null,
      loadTimeMs,
      consoleErrorCount: consoleErrors.length,
      screenshot: screenshotBase64,
      ...pageData,
    };
  } catch (err) {
    return {
      ok: false,
      url,
      error: err.message,
    };
  } finally {
    await page.close();
  }
}

/* ============================================================
 * 4) TOOL SCHEMA — format function-calling ala OpenAI (dipakai Groq)
 * ============================================================ */

const analyzeWebsiteTool = {
  type: 'function',
  function: {
    name: 'analyze_website',
    description:
      'Kunjungi sebuah website pakai browser sungguhan di server (bukan sandbox browsing AI), lalu ambil judul, deskripsi, heading, cuplikan teks, screenshot, dan hasil tes dasar (status HTTP, waktu load, mobile-friendly, jumlah gambar tanpa alt text, jumlah error console). Panggil tool ini kalau user minta dibuatkan portofolio/laporan dari sebuah URL website. SETELAH dapat hasilnya: rangkum fitur & kesan website itu pakai kata-katamu sendiri (jangan salin teks website mentah-mentah), baru panggil generate_portfolio_pdf. Kalau `ok: false`, berarti website gagal diakses — beri tahu user, jangan mengarang data.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL website yang mau dianalisis, contoh: https://www.contoh.com' },
      },
      required: ['url'],
    },
  },
};

const generatePortfolioPdfTool = {
  type: 'function',
  function: {
    name: 'generate_portfolio_pdf',
    description:
      'Buat file PDF portofolio profesional dari data yang sudah dikumpulkan lewat percakapan (nama, jabatan, ringkasan, skill, pengalaman kerja, proyek, pendidikan, kontak). Panggil HANYA setelah info penting sudah didapat dari pengguna — jangan mengarang data yang belum disebutkan.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nama lengkap pengguna' },
        title: { type: 'string', description: 'Jabatan / bidang keahlian, mis. "Frontend Developer"' },
        tagline: { type: 'string', description: 'Satu kalimat singkat yang menonjolkan value pengguna' },
        email: { type: 'string' },
        phone: { type: 'string' },
        location: { type: 'string' },
        website: { type: 'string' },
        linkedin: { type: 'string' },
        github: { type: 'string' },
        summary: { type: 'string', description: 'Paragraf singkat "tentang saya"' },
        skills: { type: 'array', items: { type: 'string' } },
        experience: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              company: { type: 'string' },
              period: { type: 'string' },
              description: { type: 'string' },
              highlights: { type: 'array', items: { type: 'string' } },
            },
            required: ['role', 'company'],
          },
        },
        projects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              tech: { type: 'array', items: { type: 'string' } },
              link: { type: 'string' },
              screenshot: {
                type: 'string',
                description:
                  'Opsional. Data base64 screenshot website (dari hasil tool analyze_website) untuk ditampilkan di kartu proyek ini.',
              },
            },
            required: ['name'],
          },
        },
        education: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              degree: { type: 'string' },
              school: { type: 'string' },
              period: { type: 'string' },
            },
            required: ['degree', 'school'],
          },
        },
        certifications: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              issuer: { type: 'string' },
              year: { type: 'string' },
            },
          },
        },
        accentColor: {
          type: 'string',
          description: 'Kode warna hex untuk aksen desain, mis. "#6366F1". Opsional.',
        },
      },
      required: ['name', 'title'],
    },
  },
};

/* ============================================================
 * 5) EKSEKUSI TOOL — render PDF & simpan ke disk
 * ============================================================ */

// Serverless cuma boleh menulis ke /tmp; di dev tulis ke public/portfolios.
const OUTPUT_DIR = IS_SERVERLESS
  ? path.join('/tmp', 'portfolios')
  : path.join(process.cwd(), 'public', 'portfolios');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function runGeneratePortfolioPdf(args) {
  const pdfBuffer = await generatePortfolioPdf(args);

  const safeName =
    (args.name || 'portfolio')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'portfolio';
  const fileName = `${safeName}-${crypto.randomBytes(3).toString('hex')}.pdf`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  fs.writeFileSync(filePath, pdfBuffer);

  // URL absolute supaya model menyampaikan link yang bisa langsung diklik
  // tanpa berisiko menambahkan domain lain di depannya.
  const baseUrl = process.env.PUBLIC_BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : '');
  const pdfUrl = baseUrl
    ? `${baseUrl}/api/portfolios/${fileName}`
    : `/api/portfolios/${fileName}`;

  // Vercel serverless: folder /tmp tidak dibagikan antar instance, jadi file
  // yang ditulis saat request chat bisa hilang saat user membuka link-nya.
  // Kalau BLOB_READ_WRITE_TOKEN tersedia, simpan juga ke Vercel Blob (persisten)
  // dan link tetap memakai route /api/portfolios/... yang mengambil dari Blob.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import('@vercel/blob');
      await put(fileName, pdfBuffer, {
        access: 'private',
        contentType: 'application/pdf',
        cacheControlMaxAge: 86400,
      });
    } catch (e) {
      console.error('[portfolio] upload ke Vercel Blob gagal:', e instanceof Error ? e.message : String(e));
    }
  }

  return {
    fileName,
    filePath,
    url: pdfUrl, // disajikan route API app/api/portfolios/[file]/route.ts
  };
}

/**
 * Eksekusi tool "analyze_website" — dipanggil pas AI minta cek sebuah URL.
 * @param {{url: string}} args
 */
async function runAnalyzeWebsite(args) {
  return analyzeWebsite(args.url);
}

module.exports = {
  buildPortfolioHTML,
  generatePortfolioPdf,
  generatePortfolioPdfTool,
  runGeneratePortfolioPdf,
  analyzeWebsite,
  analyzeWebsiteTool,
  runAnalyzeWebsite,
  closeBrowser,
};
