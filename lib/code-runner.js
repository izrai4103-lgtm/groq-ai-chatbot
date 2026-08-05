/**
 * Code Runner Sandbox — multi-language via Judge0 + JS lokal fallback.
 *
 * Env (pilih salah satu):
 *  JUDGE0_API_URL   — self-host, mis. https://judge0.example.com
 *  JUDGE0_API_KEY   — RapidAPI / Sulu / auth header (opsional self-host)
 *  JUDGE0_RAPIDAPI_KEY — jika pakai RapidAPI Judge0 CE
 *  JUDGE0_RAPIDAPI_HOST — default judge0-ce.p.rapidapi.com
 *
 * Alur: sandbox → tool-sandbox → semua models AI
 */

import vm from 'node:vm'

const MAX_CODE_CHARS = 20_000
const DEFAULT_TIMEOUT_MS = 2_500
const MAX_OUTPUT_CHARS = 12_000
const JUDGE0_WAIT_MS = 15_000

/** Judge0 CE language_id (umum dipakai) */
export const JUDGE0_LANG = {
  javascript: 63, // Node.js
  js: 63,
  node: 63,
  typescript: 74,
  ts: 74,
  python: 71, // Python 3.8.1
  python3: 71,
  py: 71,
  java: 62,
  c: 50, // GCC
  cpp: 54, // GCC C++
  'c++': 54,
  csharp: 51,
  'c#': 51,
  go: 60,
  golang: 60,
  rust: 73,
  php: 68,
  ruby: 72,
  rb: 72,
  kotlin: 78,
  kt: 78,
  swift: 83,
  r: 80,
  bash: 46,
  shell: 46,
  sh: 46,
  sql: 82,
  scala: 81,
  perl: 85,
  lua: 64,
  haskell: 61,
  pascal: 67,
  fortran: 59,
  assembly: 45,
  nasm: 45,
}

function resolveLanguageId(language) {
  const key = String(language || 'javascript').toLowerCase().trim()
  if (JUDGE0_LANG[key] != null) return { id: JUDGE0_LANG[key], key }
  const asNum = Number(key)
  if (Number.isFinite(asNum) && asNum > 0) return { id: asNum, key: String(asNum) }
  return null
}

function judge0Configured() {
  return Boolean(
    process.env.JUDGE0_API_URL ||
      process.env.JUDGE0_RAPIDAPI_KEY ||
      process.env.JUDGE0_API_KEY,
  )
}

function judge0Endpoint() {
  if (process.env.JUDGE0_API_URL) {
    return process.env.JUDGE0_API_URL.replace(/\/$/, '')
  }
  // RapidAPI CE default
  const host = process.env.JUDGE0_RAPIDAPI_HOST || 'judge0-ce.p.rapidapi.com'
  return `https://${host}`
}

function judge0Headers() {
  const headers = {
    'Content-Type': 'application/json',
  }
  if (process.env.JUDGE0_RAPIDAPI_KEY) {
    headers['X-RapidAPI-Key'] = process.env.JUDGE0_RAPIDAPI_KEY
    headers['X-RapidAPI-Host'] = process.env.JUDGE0_RAPIDAPI_HOST || 'judge0-ce.p.rapidapi.com'
  } else if (process.env.JUDGE0_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.JUDGE0_API_KEY}`
    // beberapa host pakai X-Auth-Token
    headers['X-Auth-Token'] = process.env.JUDGE0_API_KEY
  }
  return headers
}

/**
 * Eksekusi via Judge0 (wait=true).
 */
export async function runJudge0({ language, code, stdin = '' }) {
  const resolved = resolveLanguageId(language)
  if (!resolved) {
    return {
      ok: false,
      language: String(language || ''),
      error: `Bahasa tidak dikenali: ${language}. Contoh: python, javascript, java, cpp, go, rust, php, ruby.`,
      stdout: '',
      stderr: '',
      provider: 'judge0',
    }
  }
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, language: resolved.key, error: 'Kode kosong', stdout: '', stderr: '', provider: 'judge0' }
  }
  if (code.length > MAX_CODE_CHARS) {
    return {
      ok: false,
      language: resolved.key,
      error: `Kode terlalu panjang (max ${MAX_CODE_CHARS})`,
      stdout: '',
      stderr: '',
      provider: 'judge0',
    }
  }

  const base = judge0Endpoint()
  const url = `${base}/submissions?base64_encoded=false&wait=true`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), JUDGE0_WAIT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: judge0Headers(),
      body: JSON.stringify({
        source_code: code,
        language_id: resolved.id,
        stdin: typeof stdin === 'string' ? stdin : '',
        cpu_time_limit: 5,
        memory_limit: 128000,
      }),
      signal: controller.signal,
    })
    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      return {
        ok: false,
        language: resolved.key,
        error: `Judge0 response invalid (${res.status}): ${text.slice(0, 200)}`,
        stdout: '',
        stderr: '',
        provider: 'judge0',
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        language: resolved.key,
        error: data?.error || data?.message || `Judge0 HTTP ${res.status}`,
        stdout: '',
        stderr: '',
        provider: 'judge0',
        detail: typeof data === 'object' ? data : undefined,
      }
    }

    const statusId = data?.status?.id
    const statusDesc = data?.status?.description || ''
    const stdout = String(data?.stdout || '').slice(0, MAX_OUTPUT_CHARS)
    const stderr = String(data?.stderr || data?.compile_output || '').slice(0, MAX_OUTPUT_CHARS)
    // 3 = Accepted
    const ok = statusId === 3
    return {
      ok,
      language: resolved.key,
      language_id: resolved.id,
      status: statusDesc,
      status_id: statusId,
      stdout,
      stderr,
      time: data?.time ?? null,
      memory: data?.memory ?? null,
      error: ok ? null : statusDesc || stderr || 'Eksekusi gagal',
      provider: 'judge0',
    }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'Judge0 timeout' : err?.message || String(err)
    return {
      ok: false,
      language: resolved.key,
      error: msg,
      stdout: '',
      stderr: '',
      provider: 'judge0',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * JavaScript lokal (fallback / tanpa Judge0).
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
 * Entry utama: Judge0 jika dikonfigurasi, else JS lokal.
 */
export async function runCode({ language = 'javascript', code = '', stdin = '' } = {}) {
  const lang = String(language || 'javascript').toLowerCase().trim()
  const isJs = ['javascript', 'js', 'node'].includes(lang)

  if (judge0Configured()) {
    const out = await runJudge0({ language: lang, code, stdin })
    // Jika Judge0 gagal config/network dan bahasa JS → fallback lokal
    if (!out.ok && isJs && /Judge0|fetch|network|HTTP|timeout|invalid/i.test(out.error || '')) {
      const local = runJavaScript(code)
      return { ...local, fallbackFrom: 'judge0', judge0Error: out.error }
    }
    return out
  }

  if (isJs) return runJavaScript(code)

  return {
    ok: false,
    language: lang,
    error:
      'Judge0 belum dikonfigurasi. Set JUDGE0_API_URL (self-host) atau JUDGE0_RAPIDAPI_KEY di Vercel env. JavaScript tetap bisa tanpa Judge0.',
    stdout: '',
    stderr: '',
    provider: 'none',
    hint: 'Tambahkan env Judge0 untuk Python/Java/C++/Go/Rust/dll.',
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

export const RUN_CODE_TOOL = {
  type: 'function',
  function: {
    name: 'run_code',
    description:
      'Eksekusi kode di sandbox. JavaScript selalu tersedia. Dengan Judge0: python, java, cpp, c, go, rust, php, ruby, typescript, kotlin, bash, dll. Wajib tampilkan output (print/console.log).',
    parameters: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          description:
            'Bahasa: javascript, python, java, cpp, c, go, rust, php, ruby, typescript, kotlin, bash, sql, …',
        },
        code: {
          type: 'string',
          description: 'Kode sumber yang dijalankan.',
        },
        stdin: {
          type: 'string',
          description: 'Input standar (opsional).',
        },
      },
      required: ['code'],
    },
  },
}

export async function executeRunCodeTool(args) {
  const code = typeof args?.code === 'string' ? args.code : ''
  const language = typeof args?.language === 'string' ? args.language : 'javascript'
  const stdin = typeof args?.stdin === 'string' ? args.stdin : ''
  const out = await runCode({ language, code, stdin })
  if (!out.ok) {
    return {
      ok: false,
      language: out.language,
      error: out.error,
      stdout: out.stdout || '',
      stderr: out.stderr || '',
      provider: out.provider,
      hint: out.hint,
      timedOut: !!out.timedOut,
    }
  }
  return {
    ok: true,
    language: out.language,
    stdout: out.stdout || '',
    stderr: out.stderr || '',
    result: out.result ?? null,
    status: out.status,
    time: out.time,
    memory: out.memory,
    provider: out.provider,
  }
}
