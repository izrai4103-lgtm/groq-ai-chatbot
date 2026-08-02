'use client'

import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import Markdown from './Markdown'
import ProfilePanel from '../components/ProfilePanel'
import { loadProfile, saveProfile, DEFAULT_PROFILE } from '../lib/profile'
import { loadSession, saveSession, clearSession } from '../lib/auth-sandbox'

/* ===== CONSTANTS ===== */
const MODELS = [
  { id: 'chat', icon: '💬', name: 'Zanco-Ai', desc: 'Respons cepat & ramah' },
  { id: 'thinking', icon: '🧠', name: 'Thinking', desc: 'Analisa mendalam & logis' },
  { id: 'research', icon: '🔍', name: 'Web Research', desc: 'Cari informasi faktual' },
  { id: 'conference', icon: '🗣️', name: 'Multi-AI', desc: '4 model saling diskusi' },
]
const STORAGE_KEY = 'groq_chats_v1'
const ANIM_KEY = 'groq_anim_v1'

let idCounter = 0
const nextId = () => `m${++idCounter}-${Date.now()}`
const truncate = (s, n = 34) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const formatTokens = (n) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const tokenLevel = (remaining, limit) => {
  if (remaining == null || !limit) return ''
  const pct = remaining / limit
  return pct > 0.5 ? 'ok' : pct > 0.2 ? 'mid' : 'low'
}
const formatReset = (s) => {
  if (s == null || !Number.isFinite(s)) return ''
  if (s <= 0) return '0s'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`
}
function TokenBadge({ usage, now }) {
  if (!usage) return null
  const { remaining, limit, resetAt } = usage
  const resetIn = resetAt ? Math.max(0, Math.ceil((resetAt - now) / 1000)) : null
  return (
    <span className={`m-tokens ${tokenLevel(remaining, limit)}`} title={`Sisa token: ${remaining.toLocaleString('id-ID')} (kuota per menit)`}>
      <span className="m-tokens-n">{formatTokens(remaining)}</span>
      {resetIn != null && <span className="m-tokens-r">reset {formatReset(resetIn)}</span>}
    </span>
  )
}

/* ===== UX EVENT LOG (ringan, console saja — tidak disimpan) ===== */
function logUX(event, extra) {
  try { console.debug(`[UX] ${event}`, extra || '') } catch (e) { /* ignore */ }
}

/* ===== STORAGE (JS: persistensi arsip di browser) ===== */
function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.chats)) return parsed
    }
  } catch (e) { /* ignore */ }
  return { chats: [], activeId: null }
}

function saveStore(chats, activeId) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ chats, activeId }))
  } catch (e) { /* ignore */ }
}

function loadAnimPref() {
  try {
    return localStorage.getItem(ANIM_KEY) === 'off' ? 'off' : 'on'
  } catch (e) { /* ignore */ }
  return 'on'
}

/* ===== ICONS ===== */
const ICONS = {
  archive: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>
  ),
  unarchive: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M12 18V9" /><path d="M8 12l4-4 4 4" /></svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
  ),
}

/* ===== STREAMING TEXT ===== */
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

/* ===== CLIPBOARD FALLBACK (copy tetap jalan walau API clipboard tak tersedia) ===== */
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch (e) {
    return false
  }
}

/* ===== GAMBAR (JS: kompres + thumbnail sebelum upload) ===== */
function readImageBitmap(file) {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file)
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('gambar gagal dimuat')) }
    img.src = url
  })
}

async function compressImageFile(file) {
  const bmp = await readImageBitmap(file)
  const MAX = 1400
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('kompresi gambar gagal')
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}

async function makeThumb(file) {
  try {
    const bmp = await readImageBitmap(file)
    const MAX = 96
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch (e) {
    return ''
  }
}

/* ===== MESSAGE ===== */
function ChatMessage({
  msg, isLast, loading,
  onEdit, onRegenerate, onRate, rating, onCopy, copied, onStreamDone, onStreamTick,
}) {
  if (msg.role === 'system') return null
  const isUser = msg.role === 'user'
  const showActions = !isUser ? !msg.streaming : !loading
  const len = (msg.content || '').length
  const cls = ['msg', isUser ? 'user' : 'assistant']
  if (msg.entry) cls.push('entry')
  if (isUser) {
    cls.push(len < 90 ? 'short' : len > 240 ? 'long' : 'med')
  } else {
    cls.push(len > 240 ? 'long' : len < 80 ? 'short' : 'med')
    if (/(\*\*|```|^\s*[-*] |^\s*\d+\. )/m.test(msg.content)) cls.push('rich')
    if (msg.content.trim().endsWith('?')) cls.push('ask')
  }

  return (
    <div className={cls.join(' ')}>
      <div className="msg-row">
        <div className="msg-av">
          <div className={`av ${isUser ? 'user' : 'assistant'}`}>
            {isUser ? 'U' : <img src="/ai-avatar.png" alt="AI" className="av-img" />}
          </div>
        </div>
        <div className="msg-c">
          {isUser && msg.attachment && (
            <div className="msg-file">
              {msg.attachment.thumb ? (
                <img className="msg-file-thumb" src={msg.attachment.thumb} alt={msg.attachment.name} />
              ) : (
                <div className="msg-file-ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8M10 9H8" /></svg>
                </div>
              )}
              <span className="msg-file-nm" title={msg.attachment.name}>{msg.attachment.name}</span>
            </div>
          )}
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
                  <button className={`act-btn ${copied ? 'copy-done' : ''}`} title="Salin" aria-label="Salin pesan" aria-pressed={copied} onClick={() => onCopy(msg)}>
                    {copied ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                    )}
                  </button>
                  <button className={`act-btn ${rating === 'up' ? 'rated' : ''}`} title="Suka" aria-label="Suka pesan ini" aria-pressed={rating === 'up'} onClick={() => onRate(msg, 'up')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 10v12" /><path d="M15 5.88L14 10h5.83a2 2 0 011.92 2.56l-2.33 8A2 2 0 0115.5 22H8a2 2 0 01-2-2v-8a2 2 0 011-1.73l7-4a2 2 0 012.12.26l-1.12 1.35z" /></svg>
                  </button>
                  <button className={`act-btn ${rating === 'down' ? 'down' : ''}`} title="Tidak suka" aria-label="Tidak suka pesan ini" aria-pressed={rating === 'down'} onClick={() => onRate(msg, 'down')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 14V2" /><path d="M9 18.12L10 14H4.17a2 2 0 01-1.92-2.56l2.33-8A2 2 0 018.5 2H16a2 2 0 012 2v8a2 2 0 01-1 1.73l-7 4a2 2 0 01-2.12-.26l1.12-1.35z" /></svg>
                  </button>
                  {isLast && !loading && (
                    <button className="act-btn regen" title="Buat ulang" aria-label="Buat ulang jawaban" onClick={() => onRegenerate(msg)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 11-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {isUser && msg.status && (
            <div className="msg-meta">
              <span className={`msg-status ${msg.status}`} title={msg.status === 'read' ? 'Dibaca' : 'Terkirim'}>
                {msg.status === 'read' ? '✓✓' : '✓'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ===== TYPING (loader kontekstual per model) ===== */
const TYPING_LABELS = {
  chat: 'Mengetik…',
  thinking: 'Menganalisa…',
  research: 'Mencari di web…',
  conference: 'Menyusun diskusi…',
}

function TypingIndicator({ model = 'chat' }) {
  const label = TYPING_LABELS[model] || 'Mengetik…'
  return (
    <div className="msg assistant">
      <div className="msg-row">
        <div className="msg-av"><div className="av assistant"><img src="/ai-avatar.png" alt="AI" className="av-img" /></div></div>
        <div className="msg-c">
          <div className={`typing ${model}`}>
            <span className="typ-dot"><span></span><span></span><span></span></span>
            <span className="typ-label">{label}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ===== MAIN APP ===== */
export default function Home() {
  const initialRef = useRef(null)
  if (initialRef.current === null) initialRef.current = loadStore()
  const initial = initialRef.current

  const [chats, setChats] = useState(initial.chats)
  const [activeId, setActiveId] = useState(initial.activeId)
  const [messages, setMessages] = useState(() => {
    const c = initial.chats.find(c => c.id === initial.activeId)
    return c?.messages ?? []
  })
  const [chatTitle, setChatTitle] = useState(() => {
    const c = initial.chats.find(c => c.id === initial.activeId)
    return c?.title ?? 'Zanco-Ai'
  })

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showScroll, setShowScroll] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showArchive, setShowArchive] = useState(false)
  const [model, setModel] = useState('chat')
  const [menuOpen, setMenuOpen] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [file, setFile] = useState(null)
  const [ratings, setRatings] = useState({})
  const [copiedId, setCopiedId] = useState(null)
  const [toast, setToast] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')
  const [animPref, setAnimPref] = useState(loadAnimPref)
  const [showSettings, setShowSettings] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [profile, setProfile] = useState(loadProfile)
  const [session, setSession] = useState(loadSession)
  const [tokenUsage, setTokenUsage] = useState(null)
  const [now, setNow] = useState(Date.now())

  const chatRef = useRef(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)
  const menuRef = useRef(null)
  const abortRef = useRef(null)
  const toastTimer = useRef(null)
  const copiedTimer = useRef(null)
  const attachFilesRef = useRef(new Map())

  /* ===== PERSIST (JS: simpan chats + status arsip) ===== */
  useEffect(() => {
    saveStore(chats, activeId)
  }, [chats, activeId])

  useEffect(() => {
    try { localStorage.setItem(ANIM_KEY, animPref) } catch (e) { /* ignore */ }
  }, [animPref])

  /* Sidebar: otomatis tertutup di layar kecil (mobile) */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const apply = () => setSidebarOpen(!mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])

  /* Sisa token Groq: angka real-time (polling tiap 6 detik) */
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch('/api/token-usage', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (alive) setTokenUsage(data)
      } catch (e) { /* server restart / offline */ }
    }
    poll()
    const id = setInterval(poll, 6000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  /* Countdown reset token: tick tiap detik */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    saveProfile(profile)
  }, [profile])

  useEffect(() => {
    if (session) saveSession(session)
    else clearSession()
  }, [session])

  // Sinkronkan pesan aktif ke daftar chats (hanya jika sudah ada pesan user)
  useEffect(() => {
    if (!activeId || !messages.some(m => m.role === 'user')) return
    setChats(prev => {
      const exists = prev.some(c => c.id === activeId)
      const updated = exists
        ? prev.map(c => c.id === activeId ? { ...c, messages, title: chatTitle, updatedAt: Date.now() } : c)
        : [...prev, { id: activeId, title: chatTitle, messages, archived: false, updatedAt: Date.now() }]
      return updated
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeId, chatTitle])

  /* ===== SCROLL ===== */
  const scrollDown = useCallback((smooth = true) => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

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

  /* ===== CLOSE MENU ===== */
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
  const send = useCallback(async (messageList, text, attach = null) => {
    if ((!text && !attach) || loading) return
    setLoading(true)
    setError('')
    logUX('send', { model })

    // Jeda alami seperti manusia mengetik (0.3–0.9 dtk, hanya saat animasi aktif)
    if (animPref === 'on') {
      await new Promise(r => setTimeout(r, 300 + Math.random() * 600))
    }

    const controller = new AbortController()
    abortRef.current = controller

    const isConference = model === 'conference'
    const useResearch = webSearch && !isConference && model !== 'thinking'

    let endpoint = '/api/chat'
    let body = { messages: messageList.map(m => ({ role: m.role, content: m.content })) }
    let form = null

    if (attach) {
      // Vision → pillow → sandbox → models AI
      endpoint = '/api/upload'
      form = new FormData()
      form.append('message', text)
      form.append('file', attach.file)
      form.append('history', JSON.stringify(messageList.map(m => ({ role: m.role, content: m.content }))))
    } else if (isConference) {
      endpoint = '/api/conference'
      body = { topic: text, rounds: 2 }
    } else if (model === 'thinking' || useResearch) {
      endpoint = '/api/think'
      body = { question: text, web: useResearch }
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: form ? undefined : { 'Content-Type': 'application/json' },
        body: form ? form : JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}))
        throw new Error(e2.error || `Error ${res.status}`)
      }
      const data = await res.json()

      let content = ''
      if (endpoint === '/api/chat' || endpoint === '/api/upload') {
        content = data.content
      } else if (endpoint === '/api/think') {
        content = model === 'thinking'
          ? (data.thinking || data.answer || '')
          : (data.research || data.answer || '')
      } else if (endpoint === '/api/conference') {
        content = formatConference(data)
      }

      if (!content) throw new Error('Respon kosong')

      logUX('delivered', { model })
      setMessages(prev => [
        ...prev.map(m => m.role === 'user' ? { ...m, status: 'read' } : m),
        { id: nextId(), role: 'assistant', content, streaming: true },
      ])
    } catch (err) {
      if (err.name === 'AbortError') return
      logUX('error', err.message)
      setError(err.message || 'Gagal mendapatkan respon')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [loading, model, webSearch, animPref])

  const handleSubmit = useCallback((e) => {
    e?.preventDefault()
    const text = input.trim()
    if ((!text && !file) || loading) return

    // Buat chat baru kalau belum ada
    if (!activeId) setActiveId(nextId())

    const attach = file ? {
      name: file.name,
      type: file.type,
      thumb: file.thumb,
      kind: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'doc',
      file: file.file,
    } : null

    const userMsg = {
      id: nextId(), role: 'user', content: text, entry: true, status: 'sent',
      attachment: attach ? { name: attach.name, type: attach.type, thumb: attach.thumb, kind: attach.kind } : null,
    }
    if (attach) attachFilesRef.current.set(userMsg.id, attach.file)
    const all = [...messages, userMsg]
    setMessages(all)
    setInput('')
    setFile(null)
    if (!messages.some(m => m.role === 'user')) setChatTitle(truncate(text || attach?.name, 40))
    send(all, text, attach)
  }, [input, loading, messages, activeId, send, file])

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
  }, [])

  /* ===== RETRY ===== */
  const retry = useCallback(() => {
    if (loading) return
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    setError('')
    const retryFile = attachFilesRef.current.get(lastUser.id)
    send(messages, lastUser.content, retryFile ? { ...lastUser.attachment, file: retryFile } : null)
  }, [loading, messages, send])

  /* ===== EDIT / REGENERATE ===== */
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

  const regenerate = useCallback((msg) => {
    if (loading) return
    const idx = messages.findIndex(m => m.id === msg.id)
    if (idx === -1) return
    const before = messages.slice(0, idx)
    const userMsg = [...before].reverse().find(m => m.role === 'user')
    if (!userMsg) return
    setMessages(before)
    showToast('Membuat ulang jawaban...')
    const regenFile = attachFilesRef.current.get(userMsg.id)
    send(before, userMsg.content, regenFile ? { ...userMsg.attachment, file: regenFile } : null)
  }, [loading, messages, send, showToast])

  const rate = useCallback((msg, val) => {
    const current = ratings[msg.id]
    const next = current === val ? null : val
    setRatings(prev => ({ ...prev, [msg.id]: next }))
    showToast(next === null ? 'Penilaian dihapus' : next === 'up' ? 'Terima kasih! 👍' : 'Terima kasih atas masukannya 👎')
  }, [ratings, showToast])

  const copy = useCallback((msg) => {
    const done = () => {
      setCopiedId(msg.id)
      showToast('Pesan disalin!')
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopiedId(null), 2000)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(msg.content).then(done).catch(() => { if (fallbackCopy(msg.content)) done() })
    } else if (fallbackCopy(msg.content)) {
      done()
    }
  }, [showToast])

  const finishStream = useCallback((id) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, streaming: false } : m))
  }, [])

  /* ===== NEW CHAT ===== */
  const newChat = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
    setActiveId(null)
    setMessages([])
    setChatTitle('Zanco-Ai')
    setError(''); setInput(''); setFile(null); setRatings({}); setWebSearch(false)
    setShowArchive(false)
    taRef.current?.focus()
  }, [])

  /* ===== BUKA CHAT ===== */
  const openChat = useCallback((id) => {
    const c = chats.find(x => x.id === id)
    if (!c) return
    abortRef.current?.abort()
    setLoading(false)
    setActiveId(id)
    setMessages(c.messages)
    setChatTitle(c.title)
    setError(''); setInput(''); setRatings({})
    setSidebarOpen(() => window.innerWidth > 768)
  }, [chats])

  /* ===== ARSIP (JS: fungsional) ===== */
  const archiveChat = useCallback((id) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, archived: true, updatedAt: Date.now() } : c))
    if (id === activeId) {
      setActiveId(null)
      setMessages([])
      setChatTitle('Zanco-Ai')
      setError(''); setInput('')
    }
    showToast('Chat diarsipkan')
  }, [activeId, showToast])

  const archiveActive = useCallback(() => {
    if (!activeId) { setShowArchive(true); return }
    archiveChat(activeId)
    setShowArchive(true)
  }, [activeId, archiveChat])

  const unarchiveChat = useCallback((id) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, archived: false, updatedAt: Date.now() } : c))
    showToast('Chat dipulihkan dari arsip')
  }, [showToast])

  const deleteChat = useCallback((id) => {
    setChats(prev => prev.filter(c => c.id !== id))
    if (id === activeId) {
      setActiveId(null)
      setMessages([])
      setChatTitle('Zanco-Ai')
      setError(''); setInput('')
    }
    showToast('Chat dihapus')
  }, [activeId, showToast])

  /* ===== MODEL ===== */
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

  /* ===== FILE / SHARE ===== */
  const handleFile = useCallback(async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 4 * 1024 * 1024) {
      showToast('File maksimal 4MB')
      e.target.value = ''
      return
    }
    try {
      const isImage = f.type.startsWith('image/')
      const uploadFile = isImage ? await compressImageFile(f) : f
      const thumb = isImage ? await makeThumb(f) : ''
      setFile({ name: f.name, size: f.size, type: f.type, file: uploadFile, thumb })
    } catch (err) {
      showToast('Gagal memproses file')
    }
    e.target.value = ''
  }, [showToast])

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

  const placeholder = model === 'conference'
    ? 'Masukkan topik diskusi 4 AI...'
    : model === 'research'
      ? 'Tanyakan apa pun, saya cari di web...'
      : model === 'thinking'
        ? 'Masukkan pertanyaan untuk dianalisa...'
        : 'Ketik pesan...'

  const activeChats = [...chats].filter(c => !c.archived).sort((a, b) => b.updatedAt - a.updatedAt)
  const archivedChats = [...chats].filter(c => c.archived).sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className={`layout ${animPref === 'off' ? 'anim-off' : ''}`}>
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
          {showArchive ? (
            <>
              <div className="hist-group">Arsip ({archivedChats.length})</div>
              {archivedChats.length === 0 ? (
                <div className="empty-state">Tidak ada chat di arsip</div>
              ) : archivedChats
                .filter(c => c.title.toLowerCase().includes(historyQuery.toLowerCase()))
                .map(c => (
                  <div key={c.id} className="chat-item">
                    <button className={`sidebar-item chat-item-main ${c.id === activeId ? 'active' : ''}`} onClick={() => openChat(c.id)}>
                      <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                      <span>{truncate(c.title, 24)}</span>
                    </button>
                    <div className="chat-item-actions">
                      <button className="act-btn" title="Pulihkan" onClick={() => unarchiveChat(c.id)}>{ICONS.unarchive}</button>
                      <button className="act-btn" title="Hapus" onClick={() => deleteChat(c.id)}>{ICONS.trash}</button>
                    </div>
                  </div>
                ))}
            </>
          ) : (
            <>
              <div className="hist-group">Chat Aktif</div>
              {activeChats.length === 0 ? (
                <div className="empty-state">Belum ada chat. Mulai percakapan baru!</div>
              ) : activeChats
                .filter(c => c.title.toLowerCase().includes(historyQuery.toLowerCase()))
                .map(c => (
                  <div key={c.id} className="chat-item">
                    <button className={`sidebar-item chat-item-main ${c.id === activeId ? 'active' : ''}`} onClick={() => openChat(c.id)}>
                      <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                      <span>{truncate(c.title, 24)}</span>
                    </button>
                    <div className="chat-item-actions">
                      <button className="act-btn" title="Arsipkan" onClick={() => archiveChat(c.id)}>{ICONS.archive}</button>
                      <button className="act-btn" title="Hapus" onClick={() => deleteChat(c.id)}>{ICONS.trash}</button>
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>

        <div className="sidebar-bt">
          {showArchive ? (
            <button className="sidebar-bt-item" onClick={() => setShowArchive(false)}>
              {ICONS.back}
              Kembali ke chat
            </button>
          ) : (
            <>
              <button className="sidebar-bt-item" onClick={() => setShowArchive(true)}>
                {ICONS.archive}
                Arsip
                {archivedChats.length > 0 && <span className="arch-badge">{archivedChats.length}</span>}
              </button>
              <button className="sidebar-bt-item" onClick={() => { setShowArchive(true); setHistoryQuery('') }}>
                {ICONS.trash}
                Hapus & Kelola
              </button>
            </>
          )}
          <button className="sidebar-bt-item" onClick={() => setShowSettings(true)}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m9.9 9.9l2.1 2.1m0-14.1l-2.1 2.1M7 17.1l-2.1 2.1" /></svg>
            Setelan
          </button>
          <button type="button" className="sidebar-user" onClick={() => setShowProfile(true)} title="Profil">
            <div className="sidebar-user-av">
              {profile.avatar
                ? <img src={profile.avatar} alt="" />
                : <span>{(profile.name || DEFAULT_PROFILE.name).charAt(0).toUpperCase()}</span>}
            </div>
            <span className="sidebar-user-nm">{profile.name || DEFAULT_PROFILE.name}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
          </button>
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

          <div className={`model-picker ${menuOpen ? 'open' : ''}`} ref={menuRef}>
            <button className="model-btn" onClick={() => setMenuOpen(o => !o)} aria-haspopup="listbox" aria-expanded={menuOpen}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z" /><path d="M12 6v6l4 2" /></svg>
              <span className="m-name">{MODELS.find(m => m.id === model)?.name}</span>
              <TokenBadge usage={tokenUsage} now={now} />
              <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <div className="model-menu" role="listbox">
              {MODELS.map(m => (
                <button key={m.id} role="option" aria-selected={model === m.id} className={`model-opt ${model === m.id ? 'selected' : ''}`} onClick={() => switchModel(m.id)}>
                  <div className="m-ic">{m.icon}</div>
                  <div className="m-info">
                    <div className="m-name-row">
                      <div className="m-name">{m.name}</div>
                      <TokenBadge usage={tokenUsage} now={now} />
                    </div>
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
            <button className="topbar-btn" title="Setelan" onClick={() => setShowSettings(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
            </button>
          </div>
        </div>

        {/* CHAT */}
        <div className="chat" ref={chatRef} onScroll={handleScroll}>
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
            {loading && <TypingIndicator model={model} />}
            {error && (
              <div className="err">
                <span>⚠️</span> {error}
                <button onClick={retry} title="Coba lagi">↻ Coba lagi</button>
                <button onClick={() => setError('')}>✕</button>
              </div>
            )}
          </div>
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
                {file.thumb && <img className="file-chip-thumb" src={file.thumb} alt="" />}
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
                  disabled={!input.trim() && !file}
                  className={`send-btn ${input.trim() || file ? 'active' : ''}`}
                  title="Kirim pesan"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
              )}
            </form>
            <div className="composer-hint">Groq AI dapat membuat kesalahan. Periksa informasi penting.</div>
          </div>
        </div>

        {/* SETTINGS */}
        {showSettings && (
          <div className="settings-overlay" onClick={() => setShowSettings(false)}>
            <div className="settings" role="dialog" aria-modal="true" aria-label="Setelan" onClick={e => e.stopPropagation()}>
              <div className="settings-hd">
                <h3>Setelan</h3>
                <button className="settings-close" onClick={() => setShowSettings(false)} aria-label="Tutup setelan">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-nm">Animasi halus</div>
                  <div className="setting-ds">Fade lembut, micro-interaction & jeda respons alami.</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={animPref === 'on'}
                  aria-label="Animasi halus"
                  className={`switch ${animPref === 'on' ? 'on' : ''}`}
                  onClick={() => {
                    const next = animPref === 'on' ? 'off' : 'on'
                    logUX('anim_toggle', next)
                    setAnimPref(next)
                  }}
                >
                  <span className="switch-knob" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PROFIL */}
        {showProfile && (
          <ProfilePanel
            profile={profile}
            session={session}
            onProfileChange={setProfile}
            onSessionChange={setSession}
            onClose={() => setShowProfile(false)}
            onToast={showToast}
          />
        )}

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
