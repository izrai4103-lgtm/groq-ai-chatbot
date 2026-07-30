export async function POST(request) {
  try {
    const { messages } = await request.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: 'Messages diperlukan' }, { status: 400 })
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages,
        temperature: 0.7,
        max_tokens: 2048,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Groq API error:', res.status, err)
      return Response.json({ error: `Groq API: ${res.status}` }, { status: res.status })
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''

    return Response.json({ content })
  } catch (err) {
    console.error('Internal error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
