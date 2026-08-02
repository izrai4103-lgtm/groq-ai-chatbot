/**
 * 🧮 MATH TOOL — hitung matematika sungguhan lewat kode (sandbox).
 *
 * Tool ini dipasang di SEMUA model AI (chat, thinking, research, creative,
 * upload, conference). Kalau model ragu (desimal, aritmatika, akar, pangkat,
 * dll), model memanggil tool ini dan jawab sesuai hasil hitung — bukan
 * menebak. Ini yang membuat jawaban angka 100% benar.
 *
 * Evaluator aman (tanpa eval/Function): parser recursive-descent sendiri
 * yang hanya mengenal angka, operator, tanda kurung, dan fungsi tertentu.
 */

/* ===== FUNGSI ===== */
const FN = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: (v) => Math.round(v),
  floor: Math.floor,
  ceil: Math.ceil,
  pow: Math.pow,
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  sin: (v) => Math.sin(v),
  cos: (v) => Math.cos(v),
  tan: (v) => Math.tan(v),
  log: (v) => Math.log10(v),
  ln: (v) => Math.log(v),
  exp: (v) => Math.exp(v),
  fact,
  comb,
  perm,
}

function fact(n) {
  n = Math.round(Number(n))
  if (!Number.isFinite(n) || n < 0 || n > 170) throw new Error('faktorial tidak valid')
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

function comb(n, k) {
  n = Math.round(Number(n)); k = Math.round(Number(k))
  if (!Number.isFinite(n) || !Number.isFinite(k) || n < 0 || k < 0 || k > n) {
    throw new Error('kombinasi tidak valid')
  }
  k = Math.min(k, n - k)
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return r
}

function perm(n, k) {
  n = Math.round(Number(n)); k = Math.round(Number(k))
  if (!Number.isFinite(n) || !Number.isFinite(k) || n < 0 || k < 0 || k > n) {
    throw new Error('permutasi tidak valid')
  }
  let r = 1
  for (let i = 0; i < k; i++) r *= n - i
  return r
}

function countLetter(word, letter) {
  const w = String(word || '')
  const l = String(letter || '')
  if (!l) return 0
  let n = 0
  for (const ch of w) if (ch.toLowerCase() === l.toLowerCase()) n++
  return n
}

/* ===== PARSER AMAN ===== */
function evaluate(expr) {
  const s = String(expr || '').replace(/\s+/g, '')
  if (!s) throw new Error('Ekspresi kosong')
  let i = 0

  const peek = () => s[i]
  const eat = (c) => {
    if (s[i] === c) { i++; return true }
    return false
  }

  function parseExpr() {
    let v = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = s[i++]
      const r = parseTerm()
      v = op === '+' ? v + r : v - r
    }
    return v
  }

  function parseTerm() {
    let v = parseFactor()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = s[i++]
      const r = parseFactor()
      if (op === '*') v = v * r
      else if (op === '/') {
        if (r === 0) throw new Error('Pembagian dengan nol')
        v = v / r
      } else v = v % r
    }
    return v
  }

  function parseFactor() {
    const v = parseUnary()
    if (peek() === '^') { i++; return Math.pow(v, parseUnary()) }
    return v
  }

  function parseUnary() {
    if (eat('-')) return -parseUnary()
    if (eat('+')) return parseUnary()
    return parsePrimary()
  }

  function parsePrimary() {
    if (peek() === '(') {
      i++
      const v = parseExpr()
      if (!eat(')')) throw new Error('Tanda kurung tutup hilang')
      return v
    }
    const ch = peek()
    if (ch && /[a-zA-Z_]/.test(ch)) return parseCall()
    let num = ''
    while (peek() && /[0-9.]/.test(peek())) num += s[i++]
    if (!num) throw new Error(`Ekspresi tidak valid di posisi ${i}`)
    return parseFloat(num)
  }

  function parseStringArg() {
    const q = peek()
    if (q !== "'" && q !== '"') {
      // argumen tanpa tanda kutip: baca sampai koma / kurung tutup
      let w = ''
      while (peek() && peek() !== ',' && peek() !== ')') w += s[i++]
      return w
    }
    i++
    let str = ''
    while (s[i] && s[i] !== q) str += s[i++]
    if (s[i] !== q) throw new Error('String tidak ditutup')
    i++
    return str
  }

  function parseCall() {
    let name = ''
    while (peek() && /[a-zA-Z_]/.test(peek())) name += s[i++]
    if (name === 'pi') return Math.PI
    if (name === 'e') return Math.E
    if (!eat('(')) throw new Error(`Fungsi ${name} harus diikuti "("`)
    if (name === 'count') {
      const word = parseStringArg()
      if (!eat(',')) throw new Error('count butuh 2 argumen')
      const letter = parseStringArg()
      if (!eat(')')) throw new Error('count butuh ")"')
      return countLetter(word, letter)
    }
    const args = []
    if (peek() !== ')') {
      args.push(parseExpr())
      while (eat(',')) args.push(parseExpr())
    }
    if (!eat(')')) throw new Error(`Fungsi ${name} butuh ")"`)
    const fn = FN[name]
    if (!fn) throw new Error(`Fungsi tidak dikenal: ${name}`)
    return fn(...args)
  }

  const result = parseExpr()
  if (i < s.length) throw new Error(`Ada sisa ekspresi di posisi ${i}: "${s.slice(i)}"`)
  return result
}

/** Rapikan hasil floating point (0.30000000000000004 → 0.3). */
function tidy(v) {
  if (!Number.isFinite(v)) throw new Error('Hasil bukan angka valid')
  const r = Math.round(v * 1e12) / 1e12
  return Object.is(r, -0) ? 0 : r
}

/* ===== SKEMA TOOL ===== */
export const MATH_TOOL = {
  type: 'function',
  function: {
    name: 'hitung_math',
    description:
      'Hitung ekspresi matematika secara akurat (aritmatika, desimal, persen, akar, pangkat, trigonometri, logaritma, jumlah huruf). Kembalikan hasil angka yang PERSIS. WAJIB dipakai untuk semua perhitungan angka (mis. membandingkan desimal: hitung selisihnya) agar jawaban 100% benar.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description:
            'Ekspresi matematika. Contoh: "9.11 - 9.9", "3/4 + 1/2", "sqrt(144) + 2^10", "(2*2^2+3*2)-(0*0^2+3*0)", "count(strawberry, r)". Hasil negatif dari selisih a-b berarti b lebih besar.',
        },
      },
      required: ['expression'],
    },
  },
}

/* ===== EKSEKUSI ===== */
export function runMathTool(args) {
  const expression = String((args && args.expression) || '').trim()
  if (!expression) return { ok: false, error: 'Ekspresi kosong' }
  try {
    const raw = evaluate(expression)
    const result = tidy(raw)
    return { ok: true, expression, result }
  } catch (e) {
    return { ok: false, expression, error: e instanceof Error ? e.message : String(e) }
  }
}
