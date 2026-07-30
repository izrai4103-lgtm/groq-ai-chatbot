export async function POST(request) {
  try {
    const body = await request.json()
    const { code, language } = body

    if (!code || typeof code !== 'string') {
      return Response.json({ error: 'Kode diperlukan' }, { status: 400 })
    }
    if (code.length > 2000) {
      return Response.json({ error: 'Kode terlalu panjang' }, { status: 400 })
    }

    const apiKey = process.env.GROQ_API_KEY_3
    if (!apiKey) {
      return Response.json({ success: false, error: 'API Key tidak tersedia' })
    }

    const lang = (language || 'javascript').toLowerCase()
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: `Kamu adalah Code Executor. Simulasikan eksekusi kode ${lang} ini dan berikan OUTPUT yang akurat. Jawab HANYA dengan JSON: {"output": "hasil", "error": null} atau {"output": "", "error": "pesan error"}` },
          { role: 'user', content: `Jalankan kode ini:\n\`\`\`${lang}\n${code}\n\`\`\`` }
        ],
        temperature: 0.3,
        max_tokens: 150,
      }),
    })

    if (!res.ok) {
      return Response.json({ success: false, error: `AI error (${res.status})` })
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || '{}'
    
    let result
    try { result = JSON.parse(text) }
    catch { result = { output: text, error: null } }

    return Response.json({
      success: !result.error,
      output: result.output || '',
      error: result.error || null,
      explanation: '',
      modelUsed: '🔍 Research (Groq)',
    })
  } catch (err) {
    return Response.json({ success: false, error: err.message })
  }
}
