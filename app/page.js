'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

const SUGGESTIONS = [
  'Apa itu artificial intelligence?',
  'Jelaskan cara kerja blockchain',
  'Buatkan puisi tentang coding',
  'Apa perbedaan HTTP dan HTTPS?',
]

function ChatMessage({ msg }) {
  if (msg.role === 'system') return null
  return (
    <div className={`message-group ${msg.role}`}>
      <div className="message-row">
        <div className="avatar-col">
          <div className={`avatar ${msg.role === 'user' ? 'user' : 'assistant'}`}>
            {msg.role === 'user' ? 'U' : 'AI'}
          </div>
        </div>
        <div className="content-col">
          <div className="message-text">{msg.content}</div>
        </div>
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="message-group assistant">
      <div className="message-row">
        <div className="avatar-col">
          <div className="avatar assistant">AI</div>
        </div>
        <div className="content-col">
          <div className="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Halo! Aku Groq AI Chatbot. Ada yang bisa aku bantu?' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const chatRef = useRef(null)
  const textareaRef = useRef(null)

  const scrollToBottom = useCallback((smooth = true) => {
    const el = chatRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  useEffect(() => {
    if (!loading) textareaRef.current?.focus()
  }, [loading])

  const handleScroll = useCallback(() => {
    if (!chatRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatRef.current
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 250)
  }, [])

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { role: 'user', content: text }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content }))
        })
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Error ${res.status}`)
      }
      const data = await res.json()
      if (!data.content) throw new Error('Respon kosong')
      setMessages(prev => [...prev, { role: 'assistant', content: data.content }])
    } catch (err) {
      setError(err.message || 'Gagal mendapatkan respon')
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const newChat = useCallback(() => {
    setMessages([{ role: 'assistant', content: 'Halo! Aku Groq AI Chatbot. Ada yang bisa aku bantu?' }])
    setError('')
    setInput('')
    textareaRef.current?.focus()
  }, [])

  const handleSuggestion = useCallback((text) => {
    setInput(text)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
    }
  }, [input])

  return (
    <>
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <button className="new-chat-btn" onClick={newChat}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New chat
          </button>
        </div>

        <div className="sidebar-history">
          <div className="sidebar-item active">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            Groq AI Chatbot
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user-avatar">B</div>
          <span>BrutalStrike</span>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="main">
        <div className="chat-header">
          <h1>Groq<span> AI</span></h1>
        </div>

        <div className="chat-container" ref={chatRef} onScroll={handleScroll}>
          {messages.length === 0 ? (
            <div className="greeting">
              <div className="greeting-logo">💬</div>
              <h2>Apa yang bisa saya bantu?</h2>
              <p>Saya siap membantu Anda dengan berbagai pertanyaan</p>
              <div className="suggestion-chips">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="suggestion-chip" onClick={() => handleSuggestion(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-scroll">
              {messages.map((msg, i) => (
                <ChatMessage key={i} msg={msg} />
              ))}
              {loading && <TypingIndicator />}
              {error && (
                <div className="error-banner">
                  <span>⚠️</span> {error}
                  <button className="retry-btn" onClick={() => setError('')}>✕</button>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          className={`scroll-bottom ${showScrollBtn ? 'visible' : ''}`}
          onClick={() => scrollToBottom()}
          aria-label="Scroll to bottom"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <div className="input-area">
          <form className="input-wrapper" onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ketik pesan..."
              disabled={loading}
              rows={1}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className={input.trim() ? 'send-active' : ''}
              aria-label="Kirim pesan"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
