'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

export default function Home() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Halo! Aku Groq AI Chatbot. Ada yang bisa aku bantu?' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const chatRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
        })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Error ${res.status}`)
      }

      const data = await res.json()
      if (!data.content) throw new Error('Respon kosong dari AI')

      setMessages(prev => [...prev, { role: 'assistant', content: data.content }])
    } catch (err) {
      console.error('Chat error:', err)
      setError(err.message || 'Gagal mendapatkan respon. Coba lagi.')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, messages])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="container">
      <header>
        <h1>🤖 Groq Chatbot</h1>
        <p>Powered by Llama 3.1 & Groq</p>
      </header>

      <div className="chat-container" ref={chatRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Mulai percakapan dengan AI</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="avatar">{msg.role === 'user' ? 'U' : 'AI'}</div>
            <div className="bubble"><p>{msg.content}</p></div>
          </div>
        ))}

        {loading && (
          <div className="message assistant">
            <div className="avatar">AI</div>
            <div className="bubble">
              <div className="typing-dots">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="error-banner">
            <span>⚠️</span> {error}
            <button className="retry-btn" onClick={() => setError('')}>✕</button>
          </div>
        )}
      </div>

      <form className="input-area" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ketik pesan..."
          disabled={loading}
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label="Kirim pesan"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </button>
      </form>
    </div>
  )
}
