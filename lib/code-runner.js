/**
 * Code Runner Sandbox — eksekusi kode AI dengan isolasi.
 * Pola: Node vm + timeout (cocok Vercel serverless, tanpa Docker).
 * Referensi: pola umum AI code-exec sandbox (isolated eval + capture console).
 *
 * Integrasi: sandbox → tool-sandbox → semua models AI
 */

import vm from 'node:vm'
import { createRequire } from 'module'

const MAX_CODE_CHARS = 12_000
const DEFAULT_TIMEOUT_MS = 2_500
const MAX_OUTPUT_CHARS = 8_000

/**
 * Jalankan JavaScript di konteks terisolasi (tanpa require/fs/network).
 * @param {string} code
 * @param {{ timeoutMs?: number }} [opts]
 */
export function runJavaScript(code, opts = {}) {
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, 200), 8_000)
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, language: 'javascript', error: 'Kode kosong', stdout: '', result: null }
  }
  if (code.length > MAX_CODE_CHARS) {
    return { ok: false, language: 'javascript', error: `Kode terlalu panjang (max ${MAX_CODE_CHARS})`, stdout: '', result: null }
  }

  // Blokir pola berbahaya yang sering muncul di kode LLM
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
    // helper aman
    print: (...args) => fakeConsole.log(...args),
  }

  const context = vm.createContext(sandbox, { name: 'zanco-code-sandbox' })

  let result = null
  try {
    const script = new vm.Script(
      `(function(){\n"use strict";\n${code}\n})()`,
      { filename: 'user-code.js' },
    )
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
  }
}

/**
 * Tool-friendly entry: language + code.
 * python: tidak dijalankan native di Vercel — arahkan ke JS / math tool.
 */
export function runCode({ language = 'javascript', code = '' } = {}) {
  const lang = String(language || 'javascript').toLowerCase().trim()
  if (lang === 'javascript' || lang === 'js' || lang === 'node') {
    return runJavaScript(code)
  }
  if (lang === 'python' || lang === 'py') {
    return {
      ok: false,
      language: 'python',
      error:
        'Python native belum tersedia di sandbox serverless. Tulis ulang logika dalam JavaScript, atau pakai tool hitung_math untuk perhitungan.',
      stdout: '',
      result: null,
      hint: 'Gunakan language: "javascript"',
    }
  }
  return {
    ok: false,
    language: lang,
    error: `Bahasa "${lang}" tidak didukung. Gunakan javascript.`,
    stdout: '',
    result: null,
  }
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

/** Skema tool untuk function calling */
export const RUN_CODE_TOOL = {
  type: 'function',
  function: {
    name: 'run_code',
    description:
      'Eksekusi kode di sandbox aman (JavaScript). Pakai untuk hitung, simulasi, transform data, generate teks/HTML sederhana, uji logika. Tampilkan hasil via console.log atau nilai return. Tidak ada akses file, network, atau process.',
    parameters: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['javascript', 'js'],
          description: 'Bahasa kode. Saat ini hanya javascript.',
        },
        code: {
          type: 'string',
          description: 'Kode sumber yang akan dijalankan di sandbox.',
        },
      },
      required: ['code'],
    },
  },
}

export async function executeRunCodeTool(args) {
  const code = typeof args?.code === 'string' ? args.code : ''
  const language = typeof args?.language === 'string' ? args.language : 'javascript'
  const out = runCode({ language, code })
  // Format ringkas untuk model
  if (!out.ok) {
    return {
      ok: false,
      language: out.language,
      error: out.error,
      stdout: out.stdout || '',
      timedOut: !!out.timedOut,
      hint: out.hint || undefined,
    }
  }
  return {
    ok: true,
    language: out.language,
    stdout: out.stdout || '',
    result: out.result,
  }
}
