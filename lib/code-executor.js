/**
 * ⚡ Code Executor — Membaca + Menjalankan Kode dalam Sandbox
 * 
 * - JavaScript: dijalankan via Node.js VM sandbox (real execution)
 * - Python & lainnya: dijalankan via AI Code Executor (simulasi cerdas)
 */

import { SandboxError } from './sandbox.js'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// ===== KONFIGURASI MODEL =====
const MODELS = {
  reader: {
    apiKey: () => process.env.GROQ_API_KEY_2,
    model: 'llama-3.1-8b-instant',
    maxTokens: 550,
    label: 'Code Reader',
  },
  executor: {
    apiKey: () => process.env.GROQ_API_KEY_3,
    model: 'llama-3.1-8b-instant',
    maxTokens: 550,
    label: 'Code Executor',
  }
}

async function callModel(modelConfig, systemPrompt, userMessage) {
  const apiKey = modelConfig.apiKey()
  if (!apiKey) {
    throw new SandboxError('MODEL_KEY_MISSING', `API Key ${modelConfig.label} tidak tersedia`)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: modelConfig.maxTokens,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new SandboxError('MODEL_ERROR', `${modelConfig.label} error (${res.status})`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err.name === 'AbortError') throw new SandboxError('MODEL_TIMEOUT', `${modelConfig.label} timeout`)
    throw new SandboxError('MODEL_FAIL', `${modelConfig.label} gagal: ${err.message}`)
  } finally { clearTimeout(timeout) }
}

// ===== CODE READER =====
const READER_PROMPT = `Kamu adalah Code Reader AI. Tugasmu membaca dan memvalidasi kode.
1. Identifikasi bahasa pemrograman
2. Pastikan kode AMAN (TIDAK boleh: fs, network, spawn, exec, eval berbahaya)
3. Beri penjelasan singkat
4. Jika berbahaya, TOLAK

Format JSON WAJIB:
{
  "safe": true/false,
  "language": "javascript|python|go|rust|html|css|java|dll",
  "explanation": "Penjelasan singkat",
  "rejection": "Alasan jika tidak aman (kosong jika aman)"
}`

// ===== EKSEKUSI JS VIA VM =====
function executeJavaScript(code) {
  try {
    const vm = require('vm')
    const outputs = []
    const sandbox = {
      console: { log: (...args) => { outputs.push(args.map(String).join(' ')) } },
      setTimeout: undefined, setInterval: undefined,
      fetch: undefined, require: undefined, process: undefined, Buffer: undefined,
    }
    const context = vm.createContext(sandbox)
    const script = new vm.Script(code, { timeout: 5000 })
    const result = script.runInContext(context, { timeout: 5000 })
    let output = outputs.join('\n')
    if (result !== undefined && result !== null) output += (output ? '\n' : '') + String(result)
    return { success: true, output: output || '(tidak ada output)' }
  } catch (err) {
    return { success: false, output: '', error: err.message }
  }
}

// ===== EKSEKUSI PYTHON & LAINNYA VIA AI SIMULATOR =====
const AI_EXECUTOR_PROMPT = `Kamu adalah Code Executor AI. Tugasmu menjalankan kode dengan mensimulasikan eksekusinya.

PENTING: Jawab HANYA JSON valid. TANPA markdown, TANPA backticks, TANPA teks lain.

Contoh JSON output:
{"output": "Hello", "error": null}
{"output": "5", "error": null}
{"output": "0\n1\n2", "error": null}
{"output": "", "error": "NameError: name 'x' not defined"}

WAJIB: {}
{
  "output": "Hasil eksekusi persis seperti jika dijalankan sungguhan",
  "error": null
}`

function executeViaAI(code, language) {
  // Langsung return executor, nanti dipanggil di main flow
  return { useAI: true, code, language }
}

// ===== MAIN EXECUTOR =====
export async function readAndExecute(code, language) {
  const result = { success: false, explanation: '', output: '', error: null, modelUsed: '' }

  try {
    // Step 1: Code Reader — validasi
    const readerMsg = `Kode:\n\`\`\`\n${code}\n\`\`\`\n\nBahasa: ${language || 'auto-detect'}`
    const readerResponse = await callModel(MODELS.reader, READER_PROMPT, readerMsg)
    result.modelUsed = 'Code Reader'

    let readerData
    try { readerData = JSON.parse(readerResponse) }
    catch { const match = readerResponse.match(/\{[\s\S]*\}/); readerData = match ? JSON.parse(match[0]) : { safe: false } }

    result.explanation = readerData.explanation || readerData.rejection || ''

    if (!readerData.safe) {
      result.error = readerData.rejection || 'Kode tidak aman'
      result.modelUsed += ' → Ditolak'
      return result
    }

    const lang = (readerData.language || language || '').toLowerCase()
    let execResult

    // Step 2: Eksekusi — JS pakai VM, lainnya pakai AI
    if (lang.includes('javascript') || lang.includes('js') || lang.includes('node')) {
      execResult = executeJavaScript(code)
    } else {
      // Python, Go, Rust, Java, dll → simulasi AI
      execResult = executeViaAI(code, lang)
    }

    // Step 3: Proses hasil
    if (execResult.useAI) {
      // Eksekusi via AI Code Executor
      result.modelUsed += ' → Code Executor'
      
      const executorMsg = `Jalankan kode ${lang || 'unknown'} ini dan beri output:\n\n\`\`\`${lang || ''}\n${code}\n\`\`\``
      const executorResponse = await callModel(MODELS.executor, AI_EXECUTOR_PROMPT, executorMsg)
      
      let execData
      try {
          // Bersihin dulu dari markdown/backticks
          let clean = executorResponse.replace(/```json\n?|```\n?|```/g, '').trim()
          execData = JSON.parse(clean)
        } catch {
          const match = executorResponse.match(/\{[\s\S]*\}/)
          if (match) {
            try { execData = JSON.parse(match[0]) } catch { execData = { output: executorResponse } }
          } else {
            execData = { output: executorResponse }
          }
        }
      
      result.output = execData.output || ''
      result.error = execData.error || null
      result.success = !result.error
    } 
    else if (execResult.success) {
      // JS berhasil di VM
      result.modelUsed += ' → Code Executor'
      result.output = execResult.output
      
      try {
        const executorMsg = `Kode:\n\`\`\`\n${code}\n\`\`\`\n\nOutput:\n${execResult.output}`
        const executorResponse = await callModel(MODELS.executor, `Jelaskan hasil eksekusi kode ini. Format JSON: { "output": "...", "explanation": "..." }`, executorMsg)
        let execData
        try { execData = JSON.parse(executorResponse) }
        catch { const match = executorResponse.match(/\{[\s\S]*\}/); execData = match ? JSON.parse(match[0]) : null }
        
        result.output = execData?.output || execResult.output
        result.explanation = (result.explanation ? result.explanation + '\n' : '') + (execData?.explanation || '')
      } catch {}
      
      result.success = true
    } 
    else {
      // JS error — minta AI jelaskan
      result.modelUsed += ' → Code Executor'
      try {
        const executorMsg = `Kode:\n\`\`\`\n${code}\n\`\`\`\n\nError VM:\n${execResult.error}\n\nJelaskan error dan cara fix. Format JSON: { "error": "...", "fix": "..." }`
        const executorResponse = await callModel(MODELS.executor, 
          `Jelaskan error kode ini dengan singkat. Format JSON WAJIB: { "error": "penjelasan error", "fix": "saran perbaikan" }`, executorMsg)
        
        let execData
        try { execData = JSON.parse(executorResponse) }
        catch { const match = executorResponse.match(/\{[\s\S]*\}/); execData = match ? JSON.parse(match[0]) : null }
        
        result.error = execData?.error || execResult.error
        result.explanation = '💡 Saran: ' + (execData?.fix || '')
      } catch { result.error = execResult.error }
    }

  } catch (err) {
    result.error = err instanceof SandboxError ? err.message : `Error: ${err.message}`
  }

  return result
}

export { MODELS }
