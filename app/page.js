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
    <div className={`msg ${msg.role}`}>
      <div className="msg-row">
        <div className="msg-av">
          <div className={`av ${msg.role === 'user' ? 'user' : 'assistant'}`}>
            {msg.role === 'user' ? 'U' : 'AI'}
          </div>
        </div>
        <div className="msg-c">
          <div className="msg-txt">{msg.content}</div>
          {msg.role === 'assistant' && (
            <div className="msg-acts">
              <button onClick={() => navigator.clipboard.writeText(msg.content)} title="Salin">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="msg assistant">
      <div className="msg-row">
        <div className="msg-av">
          <div className="av assistant">AI</div>
        </div>
        <div className="msg-c">
          <div className="typing"><span></span><span></span><span></span></div>
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
  const [showScroll, setShowScroll] = useState(false)
  const chatRef = useRef(null)
  const taRef = useRef(null)

  const scrollDown = useCallback((sm = true) => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: sm ? 'smooth' : 'instant' })
  }, [])

  useEffect(() => { scrollDown() }, [messages, scrollDown])
  useEffect(() => { if (!loading) taRef.current?.focus() }, [loading])

  const handleScroll = useCallback(() => {
    if (!chatRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatRef.current
    setShowScroll(scrollHeight - scrollTop - clientHeight > 300)
  }, [])

  const sendMsg = useCallback(async (e) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { role: 'user', content: text }
    const all = [...messages, userMsg]
    setMessages(all)
    setInput('')
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: all.map(m => ({ role: m.role, content: m.content })) })
      })
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}))
        throw new Error(e2.error || `Error ${res.status}`)
      }
      const data = await res.json()
      if (!data.content) throw new Error('Respon kosong')
      setMessages(prev => [...prev, { role: 'assistant', content: data.content }])
    } catch (err) {
      setError(err.message || 'Gagal')
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages])

  const handleKey = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() }
  }, [sendMsg])

  const newChat = useCallback(() => {
    setMessages([{ role: 'assistant', content: 'Halo! Aku Groq AI Chatbot. Ada yang bisa aku bantu?' }])
    setError(''); setInput(''); taRef.current?.focus()
  }, [])

  const pickSuggestion = useCallback((text) => {
    setInput(text)
    setTimeout(() => taRef.current?.focus(), 50)
  }, [])

  useEffect(() => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px' }
  }, [input])

  return (
    <>
      {/* SIDEBAR */}
      <div className="sidebar">
        <div className="sidebar-hd">
          <button className="new-btn" onClick={newChat}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New chat
          </button>
        </div>
        <div className="sidebar-list">
          <div className="sidebar-item active">
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            Groq AI Chatbot
          </div>
        </div>
        <div className="sidebar-bt">
          <div className="sidebar-user">
            <div className="sidebar-user-av">B</div>
            <span className="sidebar-user-nm">BrutalStrike</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
            </svg>
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div className="main">
        <div className="chat" ref={chatRef} onScroll={handleScroll}>
          {messages.length === 0 ? (
            <div className="greet">
              <h1>Ada yang bisa saya bantu?</h1>
              <div className="greet-grid">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="greet-btn" onClick={() => pickSuggestion(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-inner">
              {messages.map((msg, i) => <ChatMessage key={i} msg={msg} />)}
              {loading && <TypingIndicator />}
              {error && (
                <div className="err">
                  <span>⚠️</span> {error}
                  <button onClick={() => setError('')}>✕</button>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          className={`scroll-btm ${showScroll ? 'show' : ''}`}
          onClick={() => scrollDown()}
          aria-label="Scroll"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>

        <div className="input-area">
          <form className="input-wrap" onSubmit={sendMsg}>
            <button type="button" className="input-plus" aria-label="Tambah">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <textarea
              ref={taRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ketik pesan..."
              disabled={loading}
              rows={1}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className={`input-send ${input.trim() ? 'active' : ''}`}
              aria-label="Kirim"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/>
              </svg>
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
