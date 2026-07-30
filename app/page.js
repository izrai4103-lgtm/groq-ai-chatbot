'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

const SUGGESTIONS = [
  'Apa itu artificial intelligence?',
  'Jelaskan cara kerja blockchain',
  'Buatkan puisi tentang coding',
  'Apa perbedaan HTTP dan HTTPS?',
  'Bagaimana cara memulai bisnis online?',
  'Tips belajar programming untuk pemula',
]

const TODAY = 'Sekarang'
const YESTERDAY = 'Kemarin'
const PREV_7 = '7 Hari Terakhir'

const historyItems = [
  { id: 1, label: 'Groq AI Chatbot', group: TODAY },
  { id: 2, label: 'Belajar Machine Learning', group: YESTERDAY },
  { id: 3, label: 'Tips React JS', group: YESTERDAY },
  { id: 4, label: 'Apa itu Web3?', group: PREV_7 },
]

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button onClick={handleCopy} title={copied ? 'Tersalin!' : 'Salin'}>
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  )
}

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
          {msg.role === 'assistant' && (
            <div className="message-actions">
              <CopyButton text={msg.content} />
            </div>
          )}
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
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 300)
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
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)
  }, [])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
    }
  }, [input])

  // Group history items by date
  const groupedHistory = {}
  historyItems.forEach(item => {
    if (!groupedHistory[item.group]) groupedHistory[item.group] = []
    groupedHistory[item.group].push(item)
  })
  const groupOrder = [TODAY, YESTERDAY, PREV_7]

  return (
    <>
      {/* ===== SIDEBAR ===== */}
      <div className="sidebar">
        <div className="sidebar-top">
          <button className="new-chat-btn" onClick={newChat}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New chat
          </button>
        </div>

        <div className="sidebar-search">
          <div className="search-wrap">
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input className="search-input" type="text" placeholder="Cari riwayat..." />
          </div>
        </div>

        <div className="sidebar-history">
          {groupOrder.map(group => (
            groupedHistory[group] && (
              <div key={group}>
                <div className="history-group-label">{group}</div>
                {groupedHistory[group].map(item => (
                  <div key={item.id} className={`sidebar-item ${item.id === 1 ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                    {item.label}
                  </div>
                ))}
              </div>
            )
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-bottom-item">
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Settings
          </div>

          <div className="sidebar-user">
            <div className="sidebar-user-avatar">B</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">BrutalStrike</div>
              <div className="sidebar-user-plan">Free Plan</div>
            </div>
            <svg className="sidebar-user-dots" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
          </div>
        </div>
      </div>

      {/* ===== MAIN CHAT ===== */}
      <div className="main">
        <div className="chat-container" ref={chatRef} onScroll={handleScroll}>
          {messages.length === 0 ? (
            <div className="greeting">
              <div className="greeting-logo">💬</div>
              <h2>Apa yang bisa saya bantu?</h2>
              <p>Saya siap membantu Anda dengan berbagai pertanyaan</p>
              <div className="greeting-suggestions">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="greeting-suggestion" onClick={() => handleSuggestion(s)}>
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
            <button type="button" className="input-plus-btn" aria-label="Tambah">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
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
              className={`input-send-btn ${input.trim() ? 'active' : ''}`}
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
