'use client'

import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import Markdown from './Markdown'

const SUGGESTIONS = [
  'Apa itu artificial intelligence?',
  'Jelaskan cara kerja blockchain',
  'Buatkan puisi tentang coding',
  'Apa perbedaan HTTP dan HTTPS?',
]

const MODELS = [
  { id: 'chat', icon: '💬', name: 'Groq AI', desc: 'Respons cepat & ramah' },
  { id: 'thinking', icon: '🧠', name: 'Thinking', desc: 'Analisa mendalam & logis' },
  { id: 'research', icon: '🔍', name: 'Web Research', desc: 'Cari informasi faktual' },
  { id: 'conference', icon: '🗣️', name: 'Multi-AI', desc: '4 model saling diskusi' },
]

const HISTORY = [
  { group: 'Hari Ini', items: [{ t: 'Groq AI Chatbot' }] },
  { group: 'Kemarin', items: [{ t: 'Belajar Machine Learning' }, { t: 'Tips React JS' }] },
  { group: '7 Hari Terakhir', items: [{ t: 'Apa itu Web3?' }, { t: 'Buatkan puisi coding' }] },
]

let idCounter = 0
const nextId = () => `m${++idCounter}-${Date.now()}`
const truncate = (s, n = 42) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/* ===== STREAMING TEXT (typewriter) ===== */
function StreamingText({ text, onTick, onDone }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (n < text.length) {
      const t = setTimeout(() => setN(Math.min(n + 5, text.length)), 15)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => onDone?.(), 150)
    return () => clearTimeout(t)
  }, [n, text, onDone])

  useEffect(() => {
    if (n > 0) onTick?.()
  }, [n, onTick])

  return <div className="msg-txt"><Markdown text={text.slice(0, n)} /></div>
}

/* ===== MESSAGE ===== */
function ChatMessage({
  msg, isLast, loading,
  onEdit, onRegenerate, onRate, rating, onCopy, copied, onStreamDone, onStreamTick,
}) {
  if (msg.role === 'system') return null
  const isUser = msg.role === 'user'
  const showActions = !isUser ? !msg.streaming : !loading

  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
      <div className="msg-row">
        <div className="msg-av">
          <div className={`av ${isUser ? 'user' : 'assistant'}`}>
            {isUser ? 'U' : 'AI'}
          </div>
        </div>
        <div className="msg-c">
          {msg.streaming && !isUser ? (
            <StreamingText text={msg.content} onTick={onStreamTick} onDone={() => onStreamDone?.(msg.id)} />
          ) : (
            <div className="msg-txt"><Markdown text={msg.content} /></div>
          )}

          {showActions && (
            <div className="msg-acts">
              {isUser ? (
                <button className="act-btn" title="Edit pesan" onClick={() => onEdit(msg)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                </button>
              ) : (
                <>
                  <button className={`act-btn ${copied ? 'copy-done' : ''}`} title="Salin" onClick={() => onCopy(msg)}>
                    {copied ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                    )}
                  </button>
                  <button className={`act-btn ${rating === 'up' ? 'rated' : ''}`} title="Suka" onClick={() => onRate(msg, 'up')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 10v12" /><path d="M15 5.88L14 10h5.83a2 2 0 011.92 2.56l-2.33 8A2 2 0 0115.5 22H8a2 2 0 01-2-2v-8a2 2 0 011-1.73l7-4a2 2 0 012.12.26l-1.12 1.35z" /></svg>
                  </button>
                  <button className={`act-btn ${rating === 'down' ? 'rated' : ''}`} title="Tidak suka" onClick={() => onRate(msg, 'down')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 14V2" /><path d="M9 18.12L10 14H4.17a2 2 0 01-1.92-2.56l2.33-8A2 2 0 018.5 2H16a2 2 0 012 2v8a2 2 0 01-1 1.73l-7 4a2 2 0 01-2.12-.26l1.12-1.35z" /></svg>
                  </button>
                  {isLast && !loading && (
                    <button className="act-btn" title="Buat ulang" onClick={() => onRegenerate(msg)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 11-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ===== TYPING ===== */
function TypingIndicator() {
  return (
    <div className="msg assistant">
      <div className="msg-row">
        <div className="msg-av"><div className="av assistant">AI</div></div>
        <div className="msg-c"><div className="typing"><span></span><span></span><span></span></div></div>
      </div>
    </div>
  )
}

/* ===== MAIN APP ===== */
export default function Home() {
  const [messages, setMessages] = useState(() => [
    { id: nextId(), role: 'assistant', content: 'Halo! Aku Groq AI Chatbot. Ada yang bisa aku bantu?' }
  ])
  const [chatTitle, setChatTitle] = useState('Groq AI Chatbot')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showScroll, setShowScroll] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [model, setModel] = useState('chat')
  const [menuOpen, setMenuOpen] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [file, setFile] = useState(null)
  const [ratings, setRatings] = useState({})
  const [copiedId, setCopiedId] = useState(null)
  const [toast, setToast] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')

  const chatRef = useRef(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)
  const menuRef = useRef(null)
  const abortRef = useRef(null)
  const toastTimer = useRef(null)
  const copiedTimer = useRef(null)

  /* ===== SCROLL ===== */
  const scrollDown = useCallback((smooth = true) => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Scroll ke bawah hanya kalau user sedang dekat bawah (seperti ChatGPT)
  const autoScroll = useCallback((smooth = true) => {
    const el = chatRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    if (dist < 160) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => { autoScroll() }, [messages, autoScroll])
  useEffect(() => { if (!loading) taRef.current?.focus() }, [loading])

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2200)
  }, [])

  const handleScroll = useCallback(() => {
    if (!chatRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatRef.current
    setShowScroll(scrollHeight - scrollTop - clientHeight > 300)
  }, [])

  /* ===== CLOSE MENU ON OUTSIDE CLICK / ESC ===== */
  useEffect(() => {
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { setMenuOpen(false); setSidebarOpen(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  /* ===== SEND ===== */
  const send = useCallback(async (messageList, text) => {
    if (!text || loading) return
    setLoading(true)
    setError('')

    const controller = new AbortController()
    abortRef.current = controller

    const isConference = model === 'conference'
    const useResearch = webSearch && !isConference && model !== 'thinking'

    let endpoint = '/api/chat'
    let body = { messages: messageList.map(m => ({ role: m.role, content: m.content })) }

    if (isConference) {
      endpoint = '/api/conference'
      body = { topic: text, rounds: 2 }
    } else if (model === 'thinking' || useResearch) {
      endpoint = '/api/think'
      body = { question: text }
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}))
        throw new Error(e2.error || `Error ${res.status}`)
      }
      const data = await res.json()

      let content = ''
      if (endpoint === '/api/chat') {
        content = data.content
      } else if (endpoint === '/api/think') {
        // Thinking → analisa; Research → hasil research
        content = model === 'thinking'
          ? (data.thinking || data.answer || '')
          : (data.research || data.answer || '')
      } else if (endpoint === '/api/conference') {
        content = formatConference(data)
      }

      if (!content) throw new Error('Respon kosong')

      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content, streaming: true }])
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message || 'Gagal mendapatkan respon')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [loading, model, webSearch])

  const handleSubmit = useCallback((e) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    const userMsg = { id: nextId(), role: 'user', content: text }
    const all = [...messages, userMsg]
    setMessages(all)
    setInput('')
    setFile(null)
    // Set judul chat dari pesan pertama user
    if (!messages.some(m => m.role === 'user')) setChatTitle(truncate(text))
    send(all, text)
  }, [input, loading, messages, send])

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
  }, [])

  /* ===== RETRY setelah error ===== */
  const retry = useCallback(() => {
    if (loading) return
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    setError('')
    send(messages, lastUser.content)
  }, [loading, messages, send])

  /* ===== EDIT ===== */
  const editMessage = useCallback((msg) => {
    if (loading) return
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === msg.id)
      return idx === -1 ? prev : prev.slice(0, idx)
    })
    setInput(msg.content)
    setError('')
    setTimeout(() => { taRef.current?.focus() }, 60)
  }, [loading])

  /* ===== REGENERATE ===== */
  const regenerate = useCallback((msg) => {
    if (loading) return
    const idx = messages.findIndex(m => m.id === msg.id)
    if (idx === -1) return
    const before = messages.slice(0, idx)
    const userMsg = [...before].reverse().find(m => m.role === 'user')
    if (!userMsg) return
    setMessages(before)
    send(before, userMsg.content)
  }, [loading, messages, send])

  /* ===== RATING / COPY ===== */
  const rate = useCallback((msg, val) => {
    setRatings(prev => ({ ...prev, [msg.id]: prev[msg.id] === val ? null : val }))
  }, [])

  const copy = useCallback((msg) => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopiedId(msg.id)
      showToast('Pesan disalin!')
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopiedId(null), 2000)
    })
  }, [showToast])

  /* ===== STREAM DONE ===== */
  const finishStream = useCallback((id) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, streaming: false } : m))
  }, [])

  /* ===== NEW CHAT ===== */
  const newChat = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
    setMessages([{ id: nextId(), role: 'assistant', content: 'Halo! Aku Groq AI Chatbot. Ada yang bisa aku bantu?' }])
    setChatTitle('Groq AI Chatbot')
    setError(''); setInput(''); setFile(null); setRatings({}); setWebSearch(false)
    taRef.current?.focus()
  }, [])

  const pickSuggestion = useCallback((text) => {
    setInput(text)
    setTimeout(() => taRef.current?.focus(), 50)
  }, [])

  /* ===== MODEL SWITCH ===== */
  const switchModel = useCallback((id) => {
    setModel(id)
    setMenuOpen(false)
    if (loading) {
      abortRef.current?.abort()
      setLoading(false)
      setError('')
    }
    taRef.current?.focus()
  }, [loading])

  /* ===== FILE ===== */
  const handleFile = useCallback((e) => {
    const f = e.target.files?.[0]
    if (f) setFile({ name: f.name, size: f.size })
    e.target.value = ''
  }, [])

  /* ===== SHARE ===== */
  const share = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => showToast('Link disalin!'))
  }, [showToast])

  /* ===== AUTO RESIZE ===== */
  useEffect(() => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px' }
  }, [input])

  const handleKey = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }, [handleSubmit])

  const greeting = messages.length === 1 && messages[0].role === 'assistant' && !messages[0].streaming
  const placeholder = model === 'conference'
    ? 'Masukkan topik diskusi 4 AI...'
    : model === 'research'
      ? 'Tanyakan apa pun, saya cari di web...'
      : model === 'thinking'
        ? 'Masukkan pertanyaan untuk dianalisa...'
        : 'Ketik pesan...'

  return (
    <div className="layout">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* ===== SIDEBAR ===== */}
      <aside className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
        <div className="sidebar-hd">
          <button className="new-btn" onClick={newChat}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New chat
          </button>
        </div>

        <div className="sidebar-search">
          <div className="search-wrap">
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input className="search-input" placeholder="Cari riwayat..." value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} />
          </div>
        </div>

        <div className="sidebar-list">
          <div className="hist-group">Chat Aktif</div>
          <button className="sidebar-item active" onClick={newChat}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
            {truncate(chatTitle, 34)}
          </button>

          {HISTORY.map(group => {
            const items = group.items.filter(i => i.t.toLowerCase().includes(historyQuery.toLowerCase()))
            if (items.length === 0) return null
            return (
              <Fragment key={group.group}>
                <div className="hist-group">{group.group}</div>
                {items.map(item => (
                  <button key={item.t} className="sidebar-item" onClick={newChat}>
                    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                    {item.t}
                  </button>
                ))}
              </Fragment>
            )
          })}
        </div>

        <div className="sidebar-bt">
          <button className="sidebar-bt-item">
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            Riwayat & Folder
          </button>
          <button className="sidebar-bt-item">
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
            Arsip
          </button>
          <button className="sidebar-bt-item">
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m9.9 9.9l2.1 2.1m0-14.1l-2.1 2.1M7 17.1l-2.1 2.1" /></svg>
            Setelan
          </button>
          <div className="sidebar-user">
            <div className="sidebar-user-av">B</div>
            <span className="sidebar-user-nm">BrutalStrike</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
          </div>
        </div>
      </aside>

      {/* ===== MAIN ===== */}
      <main className="main">
        {/* TOPBAR */}
        <div className="topbar">
          <div className="topbar-side">
            <button className="topbar-btn" onClick={() => setSidebarOpen(o => !o)} title="Toggle sidebar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
          </div>

          {/* MODEL SELECTOR */}
          <div className={`model-picker ${menuOpen ? 'open' : ''}`} ref={menuRef}>
            <button className="model-btn" onClick={() => setMenuOpen(o => !o)} aria-haspopup="listbox" aria-expanded={menuOpen}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z" /><path d="M12 6v6l4 2" /></svg>
              <span className="m-name">{MODELS.find(m => m.id === model)?.name}</span>
              <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <div className="model-menu" role="listbox">
              {MODELS.map(m => (
                <button key={m.id} role="option" aria-selected={model === m.id} className={`model-opt ${model === m.id ? 'selected' : ''}`} onClick={() => switchModel(m.id)}>
                  <div className="m-ic">{m.icon}</div>
                  <div className="m-info">
                    <div className="m-name">{m.name}</div>
                    <div className="m-desc">{m.desc}</div>
                  </div>
                  <svg className="m-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                </button>
              ))}
            </div>
          </div>

          <div className="topbar-side right">
            <button className="topbar-btn" onClick={share} title="Bagikan">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
            </button>
            <button className="topbar-btn" title="Lainnya">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
            </button>
          </div>
        </div>

        {/* CHAT */}
        <div className="chat" ref={chatRef} onScroll={handleScroll}>
          {greeting ? (
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
              {messages.map((msg, i) => (
                <ChatMessage
                  key={msg.id}
                  msg={msg}
                  isLast={i === messages.length - 1}
                  loading={loading}
                  onEdit={editMessage}
                  onRegenerate={regenerate}
                  onRate={rate}
                  rating={ratings[msg.id]}
                  onCopy={copy}
                  copied={copiedId === msg.id}
                  onStreamDone={finishStream}
                  onStreamTick={() => autoScroll(false)}
                />
              ))}
              {loading && <TypingIndicator />}
              {error && (
                <div className="err">
                  <span>⚠️</span> {error}
                  <button onClick={retry} title="Coba lagi">↻ Coba lagi</button>
                  <button onClick={() => setError('')}>✕</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* SCROLL BOTTOM */}
        <button className={`scroll-btm ${showScroll ? 'show' : ''}`} onClick={() => scrollDown()} aria-label="Scroll ke bawah">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>

        {/* COMPOSER */}
        <div className="composer-area">
          <div className="composer-wrap">
            {file && (
              <div className="file-chip">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
                {file.name}
                <button onClick={() => setFile(null)} title="Hapus lampiran">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            <form className="composer" onSubmit={handleSubmit}>
              <button type="button" className="comp-btn" onClick={() => fileRef.current?.click()} title="Lampirkan file">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
              </button>
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleFile} />

              <button
                type="button"
                className={`comp-btn ${webSearch ? 'on' : ''}`}
                onClick={() => setWebSearch(w => !w)}
                title={webSearch ? 'Matikan pencarian web' : 'Aktifkan pencarian web'}
                aria-pressed={webSearch}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
              </button>

              <textarea
                ref={taRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={placeholder}
                disabled={loading}
                rows={1}
              />

              {loading ? (
                <button type="button" className="send-btn stop" onClick={stopGeneration} title="Hentikan">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className={`send-btn ${input.trim() ? 'active' : ''}`}
                  title="Kirim pesan"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
              )}
            </form>
            <div className="composer-hint">Groq AI dapat membuat kesalahan. Periksa informasi penting.</div>
          </div>
        </div>

        {/* TOAST */}
        {toast && <div className="toast">{toast}</div>}
      </main>
    </div>
  )
}

/* ===== FORMAT CONFERENCE ===== */
function formatConference(data) {
  if (!data) return ''
  let out = ''
  if (data.modelsUsed?.length) {
    out += `**Model yang berdiskusi:** ${data.modelsUsed.join(', ')}\n\n`
  }
  for (const round of data.rounds || []) {
    out += `\n### Round ${round.round}\n\n`
    for (const r of round.responses || []) {
      out += `**${r.model}:**\n${r.content}\n\n`
    }
  }
  if (data.conclusion) out += `### Kesimpulan\n\n${data.conclusion}`
  return out
}
