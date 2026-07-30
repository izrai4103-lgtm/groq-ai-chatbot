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
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState(null)
  const [showVoiceMenu, setShowVoiceMenu] = useState(false)
  const [ttsRate, setTtsRate] = useState(0.9)
  const [ttsPitch, setTtsPitch] = useState(1.1)
  const chatRef = useRef(null)
  const inputRef = useRef(null)
  const synthRef = useRef(null)
  const pendingSpeakRef = useRef(null)

  // Init & load voices
  useEffect(() => {
    if (typeof window === 'undefined') return
    synthRef.current = window.speechSynthesis

    const loadVoices = () => {
      const v = synthRef.current.getVoices()
      if (v.length > 0) {
        // Prioritaskan: Google Indonesia → Google perempuan → lainnya
        const sorted = [
          ...v.filter(vc => vc.lang.startsWith('id') && vc.name.includes('Google')),
          ...v.filter(vc => vc.lang.startsWith('id') && !vc.name.includes('Google')),
          ...v.filter(vc => vc.name.includes('Female') || vc.name.includes('Woman') || vc.name.includes('Perempuan')),
          ...v.filter(vc => vc.lang.startsWith('en') && vc.name.includes('Google')),
          ...v,
        ]
        const unique = []
        const seen = new Set()
        for (const vc of sorted) {
          if (!seen.has(vc.name)) { seen.add(vc.name); unique.push(vc) }
        }
        setVoices(unique)

        // Auto-select: Google Indonesia atau suara perempuan pertama
        const best = unique.find(v => v.lang.startsWith('id') && v.name.includes('Google'))
          || unique.find(v => v.lang.startsWith('id'))
          || unique.find(v => v.name.includes('Female'))
          || unique.find(v => v.lang.startsWith('en') && v.name.includes('Google'))
          || unique[0]
        if (best) setSelectedVoice(best)
        
        if (pendingSpeakRef.current) {
          doSpeak(pendingSpeakRef.current.text, pendingSpeakRef.current.id, best || unique[0])
          pendingSpeakRef.current = null
        }
      }
    }

    loadVoices()
    synthRef.current.onvoiceschanged = loadVoices
  }, [])

  // TTS speak
  const doSpeak = useCallback((text, id, voiceOverride) => {
    const synth = synthRef.current
    if (!synth) return
    synth.cancel()

    if (speakingId === id) { setSpeakingId(null); return }

    const utterance = new SpeechSynthesisUtterance(text)
    const voice = voiceOverride || selectedVoice

    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang || 'id-ID'
    utterance.rate = ttsRate
    utterance.pitch = ttsPitch
    utterance.volume = 1

    utterance.onend = () => setSpeakingId(null)
    utterance.onerror = () => setSpeakingId(null)

    setSpeakingId(id)
    synth.speak(utterance)
  }, [speakingId, selectedVoice, ttsRate, ttsPitch])

  const speak = useCallback((text, id) => {
    if (!synthRef.current) return
    
    // Play voice sample sebagai intro
    try {
      const audio = new Audio('/voice-sample.m4a')
      audio.volume = 0.8
      audio.play()
    } catch (e) {}
    
    if (!selectedVoice && voices.length === 0) {
      pendingSpeakRef.current = { text, id }
      return
    }
    doSpeak(text, id)
  }, [doSpeak, selectedVoice, voices])

  // Auto TTS for new AI messages
  useEffect(() => {
    if (autoTTS && messages.length > 1) {
      const last = messages[messages.length - 1]
      if (last.role === 'assistant' && !loading) {
        speak(last.content, `msg-${messages.length - 1}`)
      }
    }
  }, [messages, loading, autoTTS, speak])

  const scrollToBottom = useCallback((smooth = true) => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])
  useEffect(() => { inputRef.current?.focus() }, [])

  const handleScroll = useCallback(() => {
    if (!chatRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatRef.current
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 150)
  }, [])

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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })) })
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`)
      const data = await res.json()
      if (!data.content) throw new Error('Respon kosong')
      const aiTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      setMessages(prev => [...prev, { role: 'assistant', content: data.content, time: aiTime }])
    } catch (err) {
      setError(err.message || 'Gagal')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, messages])

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }

  const clearChat = () => {
    synthRef.current?.cancel()
    setSpeakingId(null)
    setMessages([{ role: 'assistant', content: 'Halo! Aku Groq AI Chatbot. Ada yang bisa aku bantu?', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }])
    setError('')
  }

  const changeVoice = (v) => {
    setSelectedVoice(v)
    setShowVoiceMenu(false)
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
          <div className="voice-selector" onClick={() => setShowVoiceMenu(!showVoiceMenu)}>
            <button className="header-btn voice-btn" title="Pilih Suara" aria-label="Pilih Suara">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
            {showVoiceMenu && (
              <div className="voice-menu">
                <div className="voice-menu-header">Pilih Suara</div>
                <div className="voice-rate-control">
                  <label>Kecepatan: {ttsRate.toFixed(1)}x</label>
                  <input type="range" min="0.5" max="1.5" step="0.1" value={ttsRate} onChange={e => setTtsRate(parseFloat(e.target.value))} />
                </div>
                <div className="voice-scroll">
                  {voices.map((v, i) => (
                    <div key={i} className={`voice-item ${selectedVoice?.name === v.name ? 'active' : ''}`} onClick={() => changeVoice(v)}>
                      <span className="voice-lang">{v.lang}</span>
                      <span className="voice-name">{v.name.replace(/Google\s*/g, '').replace(/Indonesian/g, 'Indonesia')}</span>
                    </div>
                  ))}
                  {voices.length === 0 && <div className="voice-item muted">Memuat suara...</div>}
                </div>
                <div className="voice-menu-footer">
                  <span>📁 Kirim MP3 untuk suara kustom</span>
                </div>
              </div>
            )}
          </div>

          <button className={`header-btn ${autoTTS ? 'active' : ''}`} onClick={() => setAutoTTS(!autoTTS)} title="Auto TTS" aria-label="Auto TTS">
            <svg width="16" height="16" viewBox="0 0 24 24" fill={autoTTS ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 010 14.14" /><path d="M15.54 8.46a5 5 0 010 7.07" />
            </svg>
          </button>
          <button className="header-btn" onClick={clearChat} title="Hapus" aria-label="Hapus">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>
      </header>

      {showVoiceMenu && <div className="voice-overlay" onClick={() => setShowVoiceMenu(false)} />}

      <div className="chat-container" ref={chatRef} onScroll={handleScroll}>
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="avatar">{msg.role === 'user' ? 'U' : 'AI'}</div>
            <div>
              <div className="bubble"><p>{msg.content}</p></div>
              <div className="msg-actions">
                {msg.time && <span className="msg-time">{msg.time}</span>}
                {msg.role === 'assistant' && (
                  <button className={`tts-btn ${speakingId === `msg-${i}` ? 'playing' : ''}`}
                    onClick={() => speak(msg.content, `msg-${i}`)}
                    title={speakingId === `msg-${i}` ? 'Stop' : 'Dengarkan'}>
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
            <div className="bubble"><div className="typing-dots"><span></span><span></span><span></span></div></div>
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
          <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown} placeholder="Ketik pesan..." disabled={loading} autoFocus />
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
