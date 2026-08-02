/**
 * AI Website Controller
 * ------------------------------------------------------------------
 * File ini memberi kemampuan ke AI (lewat "function calling" / "tool use")
 * untuk mengontrol website secara langsung di browser:
 *   - klik elemen (tombol, link, dll)
 *   - isi input / textarea
 *   - navigasi ke halaman lain (same-origin saja, untuk keamanan)
 *   - scroll ke elemen tertentu
 *   - membaca "peta" halaman saat ini (tombol, link, input apa saja yang ada)
 *
 * File ini berjalan di BROWSER (client-side), karena aksi seperti klik dan
 * isi form memang harus terjadi di DOM. Backend Node.js/Express kamu tetap
 * yang memanggil Groq/Gemini API (supaya API key aman), lalu hasil tool_call
 * dari AI dikirim ke frontend untuk dieksekusi pakai file ini.
 *
 * CARA PAKAI:
 * 1. Include di HTML:
 *      <script src="/ai-website-controller.js"></script>
 *
 * 2. Saat kirim request ke Groq, sertakan tools-nya:
 *      body: JSON.stringify({
 *        model: "llama-3.3-70b-versatile",
 *        messages,
 *        tools: AIWebsiteController.tools,
 *      })
 *
 *    Kalau pakai Gemini, pakai format functionDeclarations:
 *      tools: AIWebsiteController.toGeminiTools()
 *
 * 3. Kalau AI membalas dengan tool_call / function_call, jalankan:
 *      const result = AIWebsiteController.executeAction(toolName, toolArgs);
 *
 *    Lalu kirim balik `result` ke AI (sebagai tool result message) supaya
 *    AI tahu aksinya berhasil atau gagal, dan bisa lanjut merespons user.
 */

(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // 1. DOM ACTIONS — aksi nyata yang dijalankan di halaman
  // ------------------------------------------------------------------

  function findElement(selector) {
    const el = document.querySelector(selector);
    if (!el) throw new Error('Elemen tidak ditemukan: ' + selector);
    return el;
  }

  function clickElement({ selector }) {
    const el = findElement(selector);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.click();
    return { success: true, message: 'Berhasil klik elemen "' + selector + '"' };
  }

  function fillInput({ selector, value }) {
    const el = findElement(selector);

    // Trik supaya framework seperti React/Vue tetap mendeteksi perubahan
    // (bukan cuma set .value biasa, yang kadang tidak trigger onChange)
    const proto = el.tagName === 'TEXTAREA'
      ? global.HTMLTextAreaElement.prototype
      : global.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') &&
      Object.getOwnPropertyDescriptor(proto, 'value').set;

    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, message: 'Berhasil isi "' + selector + '" dengan "' + value + '"' };
  }

  function navigateTo({ url }) {
    // Hanya izinkan path relatif atau same-origin, supaya AI tidak bisa
    // diarahkan (atau mengarahkan user) ke website luar yang berbahaya.
    const isSafe = url.startsWith('/') || url.startsWith(global.location.origin);
    if (!isSafe) {
      throw new Error('Navigasi ditolak, bukan same-origin: ' + url);
    }
    global.location.href = url;
    return { success: true, message: 'Navigasi ke ' + url };
  }

  function scrollToElement({ selector }) {
    const el = findElement(selector);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { success: true, message: 'Scroll ke "' + selector + '"' };
  }

  function getPageContext() {
    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .slice(0, 30)
      .map(function (el) {
        return {
          text: (el.innerText || '').trim().slice(0, 60),
          selector: cssPathFor(el),
        };
      });

    const inputs = Array.from(document.querySelectorAll('input, textarea, select'))
      .slice(0, 30)
      .map(function (el) {
        return {
          name: el.name || el.id || '',
          type: el.type || el.tagName.toLowerCase(),
          placeholder: el.placeholder || '',
          selector: cssPathFor(el),
        };
      });

    return {
      url: global.location.href,
      title: document.title,
      buttons: buttons,
      inputs: inputs,
    };
  }

  // Bikin selector sederhana & (biasanya) unik dari sebuah elemen
  function cssPathFor(el) {
    if (el.id) return '#' + el.id;
    if (el.name) return '[name="' + el.name + '"]';
    let path = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string' && el.className.trim()) {
      path += '.' + el.className.trim().split(/\s+/).join('.');
    }
    return path;
  }

  // ------------------------------------------------------------------
  // 2. TOOL DEFINITIONS — schema supaya AI tahu aksi apa saja yang tersedia
  //    Format di bawah ini format OpenAI-style, dipakai langsung oleh Groq.
  // ------------------------------------------------------------------

  const actions = {
    click_element: clickElement,
    fill_input: fillInput,
    navigate_to: navigateTo,
    scroll_to_element: scrollToElement,
    get_page_context: getPageContext,
  };

  const tools = [
    {
      type: 'function',
      function: {
        name: 'click_element',
        description: 'Klik sebuah elemen di halaman (tombol, link, dll) berdasarkan CSS selector.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector elemen yang mau diklik, misal "#submit-btn"' },
          },
          required: ['selector'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fill_input',
        description: 'Isi input atau textarea di halaman dengan teks tertentu.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector input, misal "#email" atau "[name=email]"' },
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
        description: 'Pindah/navigasi ke halaman lain di website yang sama (same-origin).',
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
        description: 'Scroll halaman ke posisi elemen tertentu.',
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
        description: 'Ambil daftar tombol, link, dan input yang ada di halaman saat ini, supaya AI tahu apa saja yang bisa dilakukan sebelum mengambil aksi.',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];

  // Konversi ke format Gemini (functionDeclarations) — strukturnya sedikit beda
  function toGeminiTools() {
    return [
      {
        functionDeclarations: tools.map(function (t) {
          return {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          };
        }),
      },
    ];
  }

  // ------------------------------------------------------------------
  // 3. EXECUTOR — jalankan aksi yang diminta AI + tangani error dengan aman
  // ------------------------------------------------------------------

  function executeAction(name, args) {
    const fn = actions[name];
    if (!fn) {
      return { success: false, error: 'Aksi tidak dikenal: ' + name };
    }
    try {
      return fn(args || {});
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ------------------------------------------------------------------
  // 4. EXPORT KE GLOBAL SCOPE
  // ------------------------------------------------------------------

  global.AIWebsiteController = {
    tools: tools,
    toGeminiTools: toGeminiTools,
    executeAction: executeAction,
  };
})(window);
