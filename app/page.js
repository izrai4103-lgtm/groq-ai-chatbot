'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

export default function Home() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Halo! Aku Groq AI Chatbot. Ada yang bisa aku bantu?', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [speakingId, setSpeakingId] = useState(null)
  const [autoTTS, setAutoTTS] = useState(false)
  const chatRef = useRef(null)
  const inputRef = useRef(null)
  const synthRef = useRef(null)

  // Init speech synthesis
  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis
    }
  }, [])

  const scrollToBottom = useCallback((smooth = true) => {
    if (!chatRef.current) return
    chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])
  useEffect(() => { inputRef.current?.focus() }, [])

  const handleScroll = useCallback(() => {
    if (!chatRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatRef.current
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 150)
  }, [])

  // TTS function
  const speak = useCallback((text, id) => {
    if (!synthRef.current) return
    
    // Stop current speech
    synthRef.current.cancel()
    
    if (speakingId === id) {
      setSpeakingId(null)
      return
    }

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'id-ID'
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.volume = 1.0

    // Pilih suara Google Indonesia
    const voices = synthRef.current.getVoices()
    const googleVoice = voices.find(v => v.name.includes('Google') && v.lang.startsWith('id'))
    if (googleVoice) utterance.voice = googleVoice

    utterance.onend = () => setSpeakingId(null)
    utterance.onerror = () => setSpeakingId(null)
    
    setSpeakingId(id)
    synthRef.current.speak(utterance)
  }, [speakingId])

  // Load voices when they change
  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.onvoiceschanged = () => synthRef.current.getVoices()
    }
  }, [])

  // Auto TTS untuk pesan AI baru
  useEffect(() => {
    if (autoTTS && messages.length > 1) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.role === 'assistant') {
        speak(lastMsg.content, `msg-${messages.length - 1}`)
      }
    }
  }, [messages, autoTTS, speak])

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const userMsg = { role: 'user', content: text, time }
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
      if (!data.content) throw new Error('Respon kosong')

      const aiTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      setMessages(prev => [...prev, { role: 'assistant', content: data.content, time: aiTime }])
    } catch (err) {
      setError(err.message || 'Gagal mendapatkan respon')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, messages])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  const clearChat = () => {
    if (synthRef.current) synthRef.current.cancel()
    setSpeakingId(null)
    setMessages([{ role: 'assistant', content: 'Halo! Aku Groq AI Chatbot. Ada yang bisa aku bantu?', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }])
    setError('')
  }

  return (
    <div className="container">
      <header>
        <div className="header-left">
          <div className="header-avatar">🤖</div>
          <div className="header-info">
            <h1>Groq AI</h1>
            <p><span className="status-dot"></span>🧠 Thinking · 🔍 Web Research</p>
          </div>
        </div>
        <div className="header-actions">
          <button className={`header-btn ${autoTTS ? 'active' : ''}`} onClick={() => setAutoTTS(!autoTTS)} title="Auto TTS" aria-label="Auto TTS">
            <svg width="16" height="16" viewBox="0 0 24 24" fill={autoTTS ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 010 14.14" /><path d="M15.54 8.46a5 5 0 010 7.07" />
            </svg>
          </button>
          <button className="header-btn" onClick={clearChat} title="Hapus" aria-label="Hapus">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>
      </header>

      <div className="chat-container" ref={chatRef} onScroll={handleScroll}>
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="avatar">{msg.role === 'user' ? 'U' : 'AI'}</div>
            <div>
              <div className="bubble"><p>{msg.content}</p></div>
              <div className="msg-actions">
                {msg.time && <span className="msg-time">{msg.time}</span>}
                {msg.role === 'assistant' && (
                  <button
                    className={`tts-btn ${speakingId === `msg-${i}` ? 'playing' : ''}`}
                    onClick={() => speak(msg.content, `msg-${i}`)}
                    title={speakingId === `msg-${i}` ? 'Stop' : 'Dengarkan'}
                    aria-label="Dengarkan"
                  >
                    {speakingId === `msg-${i}` ? '🔊' : '🔈'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="message assistant">
            <div className="avatar">AI</div>
            <div className="bubble">
              <div className="typing-dots"><span></span><span></span><span></span></div>
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

      <button className={`scroll-bottom ${showScrollBtn ? 'visible' : ''}`} onClick={() => scrollToBottom()} aria-label="Scroll">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <form className="input-area" onSubmit={handleSubmit}>
        <div className="input-wrapper">
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
          <button type="submit" disabled={loading || !input.trim()} aria-label="Kirim">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  )
}
