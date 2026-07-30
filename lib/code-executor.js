/**
 * ⚡ Code Executor — Membaca + Menjalankan Kode dalam Sandbox
 * 
 * Menggunakan 2 model Groq terpisah:
 * - Code Reader: membaca, memahami, dan memvalidasi kode
 * - Code Executor: menjalankan kode di lingkungan terisolasi
 */

import { SandboxError } from './sandbox.js'

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

// ===== CALL MODEL GROQ =====
async function callModel(modelConfig, systemPrompt, userMessage) {
  const apiKey = modelConfig.apiKey()
  if (!apiKey) {
    throw new SandboxError('MODEL_KEY_MISSING', `API Key untuk ${modelConfig.label} tidak tersedia`)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
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

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new SandboxError('MODEL_ERROR', `${modelConfig.label} error (${res.status})`)
    }

    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err.name === 'AbortError') {
      throw new SandboxError('MODEL_TIMEOUT', `${modelConfig.label} timeout`)
    }
    throw new SandboxError('MODEL_FAIL', `${modelConfig.label} gagal: ${err.message}`)
  } finally {
    clearTimeout(timeout)
  }
}

// ===== CODE READER — Membaca & Memvalidasi Kode =====
const READER_PROMPT = `Kamu adalah Code Reader AI. Tugasmu:
1. Baca kode yang diberikan user
2. Identifikasi bahasa pemrograman
3. Deteksi apakah kode aman dijalankan (TIDAK boleh: fs, network, spawn, exec, eval berbahaya)
4. Beri penjelasan singkat apa yang kode itu lakukan
5. Jika berbahaya, TOLAK dengan alasan jelas

Format respon JSON WAJIB:
{
  "safe": true/false,
  "language": "javascript|python|html|css",
  "explanation": "Penjelasan singkat apa yang kode lakukan",
  "rejection": "Alasan jika tidak aman (kosong jika aman)"
}`

// ===== CODE EXECUTOR — Menjelaskan Hasil =====
const EXECUTOR_PROMPT = `Kamu adalah Code Executor AI. Tugasmu menjelaskan hasil eksekusi kode.

Format respon JSON WAJIB:
{
  "output": "Hasil/output dari kode tersebut",
  "explanation": "Penjelasan tentang hasilnya"
}`

// ===== EKSEKUSI JS =====
function executeJavaScript(code) {
  try {
    // Dynamic import vm (built-in Node.js)
    const vm = require('vm')
    const outputs = []
    
    const sandbox = {
      console: { log: (...args) => { outputs.push(args.map(String).join(' ')) } },
      setTimeout: undefined,
      fetch: undefined,
      require: undefined,
    }

    const context = vm.createContext(sandbox)
    const script = new vm.Script(code, { timeout: 5000 })
    const result = script.runInContext(context, { timeout: 5000 })
    
    let output = outputs.join('\n')
    if (result !== undefined && result !== null) {
      output += (output ? '\n' : '') + String(result)
    }
    return { success: true, output: output || '(tidak ada output)' }
  } catch (err) {
    return { success: false, output: '', error: err.message }
  }
}

// ===== EKSEKUSI PYTHON =====
function executePython(code) {
  try {
    const { execSync } = require('child_process')
    const result = execSync(`python3 -c ${JSON.stringify(code)}`, {
      timeout: 5000,
      maxBuffer: 10 * 1024,
      encoding: 'utf-8',
    })
    return { success: true, output: result.trim() || '(tidak ada output)' }
  } catch (err) {
    return {
      success: false,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message
    }
  }
}

// ===== MAIN EXECUTOR =====
export async function readAndExecute(code, language) {
  const result = {
    success: false,
    explanation: '',
    output: '',
    error: null,
    modelUsed: '',
  }

  try {
    // Step 1: Code Reader — baca & validasi
    const readerMsg = `Kode:\n\`\`\`\n${code}\n\`\`\`\n\nBahasa: ${language || 'auto-detect'}`
    const readerResponse = await callModel(MODELS.reader, READER_PROMPT, readerMsg)
    result.modelUsed = 'Code Reader'

    let readerData
    try {
      readerData = JSON.parse(readerResponse)
    } catch {
      const match = readerResponse.match(/\{[\s\S]*\}/)
      readerData = match ? JSON.parse(match[0]) : { safe: false, explanation: 'Gagal membaca kode' }
    }

    result.explanation = readerData.explanation || readerData.rejection || ''

    if (!readerData.safe) {
      result.error = readerData.rejection || 'Kode tidak aman untuk dijalankan'
      result.modelUsed += ' → Ditolak'
      return result
    }

    // Step 2: Eksekusi
    const lang = (readerData.language || language || '').toLowerCase()
    let execResult

    if (lang.includes('javascript') || lang.includes('js')) {
      execResult = executeJavaScript(code)
    } else if (lang.includes('python') || lang.includes('py')) {
      execResult = executePython(code)
    } else {
      // Coba JS dulu
      execResult = executeJavaScript(code)
      if (!execResult.success) {
        execResult = executePython(code)
      }
    }

    // Step 3: Code Executor — proses hasil
    if (execResult.success) {
      result.modelUsed += ' → Code Executor'
      result.output = execResult.output
      
      // Minta Code Executor jelaskan hasilnya
      try {
        const executorMsg = `Kode ${lang || 'javascript'}:\n\`\`\`\n${code}\n\`\`\`\n\nOutput:\n${execResult.output}`
        const executorResponse = await callModel(MODELS.executor, EXECUTOR_PROMPT, executorMsg)
        
        try {
          const execData = JSON.parse(executorResponse)
          result.output = execData.output || execResult.output
          result.explanation = (result.explanation ? result.explanation + '\n' : '') + (execData.explanation || '')
        } catch {
          // Respon bukan JSON, simpan sebagai output
          if (executorResponse.length < 500) {
            result.output = executorResponse
          }
        }
      } catch {
        // Executor gagal, tetap pakai output asli
      }

      result.success = true
    } else {
      // Step 3 fallback: minta Code Executor jelaskan error
      result.modelUsed += ' → Code Executor'
      try {
        const executorMsg = `Kode:\n\`\`\`\n${code}\n\`\`\`\n\nError:\n${execResult.error}\n\nJelaskan error ini dan cara memperbaikinya.`
        const executorResponse = await callModel(MODELS.executor, 
          'Jelaskan error kode ini dengan singkat dan beri saran perbaikan. Format JSON: { "error": "penjelasan error", "fix": "cara memperbaiki" }',
          executorMsg)
        
        try {
          const execData = JSON.parse(executorResponse)
          result.error = execData.error || execResult.error
          result.explanation = '💡 Saran: ' + (execData.fix || '')
        } catch {
          result.error = execResult.error
        }
      } catch {
        result.error = execResult.error || 'Gagal mengeksekusi kode'
      }
    }

  } catch (err) {
    if (err instanceof SandboxError) {
      result.error = err.message
    } else {
      result.error = `Sandbox error: ${err.message}`
    }
  }

  return result
}

export { MODELS }
