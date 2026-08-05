/**
 * Code Runner Sandbox — eksekusi JavaScript lokal (tanpa API key).
 * Isolasi Node vm + timeout. Tidak butuh Judge0 / layanan eksternal.
 *
 * Integrasi: sandbox → tool-sandbox → semua models AI
 */

import vm from 'node:vm'

const MAX_CODE_CHARS = 12_000
const DEFAULT_TIMEOUT_MS = 2_500
const MAX_OUTPUT_CHARS = 8_000

/**
 * Jalankan JavaScript di konteks terisolasi (tanpa require/fs/network).
 */
export function runJavaScript(code, opts = {}) {
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, 200), 8_000)
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, language: 'javascript', error: 'Kode kosong', stdout: '', result: null, provider: 'local-vm' }
  }
  if (code.length > MAX_CODE_CHARS) {
    return {
      ok: false,
      language: 'javascript',
      error: `Kode terlalu panjang (max ${MAX_CODE_CHARS})`,
      stdout: '',
      result: null,
      provider: 'local-vm',
    }
  }

  const blocked = [
    /\bprocess\b/,
    /\brequire\s*\(/,
    /\bimport\s*\(/,
    /\bchild_process\b/,
    /\bfs\b\s*\./,
    /\bworker_threads\b/,
    /\bWebAssembly\b/,
    /\beval\s*\(/,
    /\bFunction\s*\(/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
  ]
  for (const re of blocked) {
    if (re.test(code)) {
      return {
        ok: false,
        language: 'javascript',
        error: `Kode ditolak: pola tidak diizinkan (${re})`,
        stdout: '',
        result: null,
        provider: 'local-vm',
      }
    }
  }

  const logs = []
  const fakeConsole = {
    log: (...args) => logs.push(args.map(stringify).join(' ')),
    info: (...args) => logs.push(args.map(stringify).join(' ')),
    warn: (...args) => logs.push('[warn] ' + args.map(stringify).join(' ')),
    error: (...args) => logs.push('[error] ' + args.map(stringify).join(' ')),
  }

  const sandbox = {
    console: fakeConsole,
    Math,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    Infinity,
    NaN,
    undefined,
    print: (...args) => fakeConsole.log(...args),
  }

  const context = vm.createContext(sandbox, { name: 'zanco-code-sandbox' })
  let result = null
  try {
    const script = new vm.Script(`(function(){\n"use strict";\n${code}\n})()`, {
      filename: 'user-code.js',
    })
    result = script.runInContext(context, {
      timeout: timeoutMs,
      displayErrors: true,
      breakOnSigint: true,
    })
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err)
    return {
      ok: false,
      language: 'javascript',
      error: msg.slice(0, 500),
      stdout: logs.join('\n').slice(0, MAX_OUTPUT_CHARS),
      result: null,
      timedOut: /Script execution timed out/i.test(msg),
      provider: 'local-vm',
    }
  }

  const stdout = logs.join('\n').slice(0, MAX_OUTPUT_CHARS)
  let resultStr = null
  try {
    if (result !== undefined) resultStr = stringify(result).slice(0, MAX_OUTPUT_CHARS)
  } catch {
    resultStr = '[unserializable]'
  }

  return {
    ok: true,
    language: 'javascript',
    error: null,
    stdout,
    result: resultStr,
    timedOut: false,
    provider: 'local-vm',
  }
}

/**
 * Entry: hanya JavaScript lokal, tanpa API key.
 */
export async function runCode({ language = 'javascript', code = '' } = {}) {
  const lang = String(language || 'javascript').toLowerCase().trim()
  const isJs = !lang || ['javascript', 'js', 'node', 'typescript', 'ts'].includes(lang)

  if (!isJs) {
    return {
      ok: false,
      language: lang,
      error: `Bahasa "${lang}" tidak didukung. Sandbox hanya menjalankan JavaScript (tanpa API key). Tulis ulang logika dalam JavaScript.`,
      stdout: '',
      result: null,
      provider: 'local-vm',
      hint: 'Gunakan language: "javascript"',
    }
  }

  // TypeScript disederhanakan: jalankan sebagai JS (tanpa type-check)
  return runJavaScript(code)
}

function stringify(v) {
  if (typeof v === 'string') return v
  if (typeof v === 'undefined') return 'undefined'
  if (typeof v === 'function') return '[function]'
  try {
    return JSON.stringify(v, null, 2) ?? String(v)
  } catch {
    return String(v)
  }
}

export const RUN_CODE_TOOL = {
  type: 'function',
  function: {
    name: 'run_code',
    description:
      'Eksekusi kode JavaScript di sandbox lokal (tanpa API key). Pakai untuk hitung, algoritma, simulasi, transform data. Tampilkan hasil lewat console.log atau return. Tidak ada akses file/network/process.',
    parameters: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['javascript', 'js'],
          description: 'Hanya javascript.',
        },
        code: {
          type: 'string',
          description: 'Kode JavaScript yang dijalankan.',
        },
      },
      required: ['code'],
    },
  },
}

export async function executeRunCodeTool(args) {
  const code = typeof args?.code === 'string' ? args.code : ''
  const language = typeof args?.language === 'string' ? args.language : 'javascript'
  const out = await runCode({ language, code })
  if (!out.ok) {
    return {
      ok: false,
      language: out.language,
      error: out.error,
      stdout: out.stdout || '',
      provider: out.provider,
      hint: out.hint,
      timedOut: !!out.timedOut,
    }
  }
  return {
    ok: true,
    language: out.language,
    stdout: out.stdout || '',
    result: out.result,
    provider: out.provider,
  }
}
