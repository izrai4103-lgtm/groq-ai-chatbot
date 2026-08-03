'use client'

import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import Markdown from './Markdown'
import ProfilePanel from '../components/ProfilePanel'
import { loadProfile, saveProfile, DEFAULT_PROFILE } from '../lib/profile'
import { loadSession, saveSession, clearSession } from '../lib/auth-sandbox'

/* ===== CONSTANTS ===== */
const STORAGE_KEY = 'groq_chats_v1'
const ANIM_KEY = 'groq_anim_v1'

let idCounter = 0
const nextId = () => `m${++idCounter}-${Date.now()}`
const truncate = (s, n = 34) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const formatTokens = (n) => {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(Math.round(n))
}
const formatReset = (s) => {
  if (s == null || !Number.isFinite(s)) return '—'
  const sec = Math.max(0, Math.ceil(s))
  if (sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const r = sec % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/* ===== REAL-TIME TOKEN ENGINE ===== */
const TOKEN_LS_KEY = 'zanco_token_rt_v1'
const TOKEN_WINDOW_MS = 60_000
const TOKEN_QUOTA_GUEST = 10000
const TOKEN_QUOTA_LOGIN = 20000

function tokenWindowEnd(now = Date.now()) {
  return Math.ceil((now + 1) / TOKEN_WINDOW_MS) * TOKEN_WINDOW_MS
}

function urgencyFrom(remaining, quota) {
  if (remaining <= 0) return 'empty'
  const pct = quota > 0 ? remaining / quota : 1
  if (pct <= 0.1) return 'critical'
  if (pct <= 0.25) return 'low'
  if (pct <= 0.5) return 'mid'
  return 'ok'
}

function normalizeTokenUser(u, now = Date.now()) {
  const quota = Number(u?.quota) > 0 ? Number(u.quota) : TOKEN_QUOTA_GUEST
  let resetAt = Number(u?.resetAt)
  if (!Number.isFinite(resetAt) || resetAt <= 0) resetAt = tokenWindowEnd(now)
  let used = Math.max(0, Number(u?.used) || 0)
  if (now >= resetAt) {
    used = 0
    resetAt = tokenWindowEnd(now)
  }
  const remaining = Math.max(0, quota - used)
  const pct = quota > 0 ? remaining / quota : 1
  return {
    isLoggedIn: Boolean(u?.isLoggedIn),
    quota, used, remaining, resetAt,
    serverNow: Number(u?.serverNow) || now,
    pct: Math.round(pct * 1000) / 1000,
    urgency: urgencyFrom(remaining, quota),
  }
}

function loadLocalTokenUser(isLoggedIn) {
  try {
    const raw = localStorage.getItem(TOKEN_LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return normalizeTokenUser({
      ...parsed, isLoggedIn,
      quota: isLoggedIn ? TOKEN_QUOTA_LOGIN : TOKEN_QUOTA_GUEST,
    })
  } catch (e) { return null }
}

function saveLocalTokenUser(user) {
  try {
    if (!user) return
    localStorage.setItem(TOKEN_LS_KEY, JSON.stringify({
      used: user.used, resetAt: user.resetAt, quota: user.quota,
      isLoggedIn: user.isLoggedIn, updatedAt: Date.now(),
    }))
  } catch (e) { /* ignore */ }
}

function mergeTokenUser(local, remote, now = Date.now()) {
  const isLoggedIn = Boolean(remote?.isLoggedIn ?? local?.isLoggedIn)
  const quota = isLoggedIn ? TOKEN_QUOTA_LOGIN : TOKEN_QUOTA_GUEST
  const a = local ? normalizeTokenUser({ ...local, isLoggedIn, quota }, now) : null
  const b = remote ? normalizeTokenUser({ ...remote, isLoggedIn, quota }, now) : null
  if (!a && !b) return normalizeTokenUser({ isLoggedIn, quota, used: 0, resetAt: tokenWindowEnd(now) }, now)
  if (!a) return b
  if (!b) return a
  if (a.resetAt === b.resetAt) {
    const used = Math.max(a.used, b.used)
    return normalizeTokenUser({ isLoggedIn, quota, used, resetAt: a.resetAt, serverNow: b.serverNow || a.serverNow }, now)
  }
  const pick = a.resetAt >= b.resetAt ? a : b
  return normalizeTokenUser(pick, now)
}

function estimateSpend(text, file) {
  const len = (text || '').length + (file ? 800 : 0)
  return Math.max(48, Math.ceil(len / 4) + 80)
}

function TokenRing({ pct, urgency, size = 18 }) {
  const r = 7
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, pct ?? 1))
  const offset = c * (1 - p)
  const stroke =
    urgency === 'empty' || urgency === 'critical' ? '#ff6b6b'
    : urgency === 'low' ? '#ff8f5a'
    : urgency === 'mid' ? '#f5c451'
    : '#19c37d'
  return (
    <svg className="m-tokens-ring" width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="2.5" />
      <circle cx="9" cy="9" r={r} fill="none" stroke={stroke} strokeWidth="2.5"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        transform="rotate(-90 9 9)"
        style={{ transition: 'stroke-dashoffset .35s ease, stroke .3s ease' }} />
    </svg>
  )
}

function TokenBadge({ usage, now }) {
  const raw = usage?.user
  if (!raw) return null
  const user = normalizeTokenUser(raw, now)
  const { remaining, quota, resetAt, urgency, pct } = user
  const resetInSec = resetAt != null ? Math.max(0, (resetAt - now) / 1000) : null
  const shared = usage?.shared
  const title = [
    `Sisa ${Number(remaining).toLocaleString('id-ID')} / ${Number(quota).toLocaleString('id-ID')} token per menit`,
    resetInSec != null ? `Reset dalam ${formatReset(resetInSec)}` : null,
    shared ? `Pool riset: ${formatTokens(shared.remaining)}/${formatTokens(shared.limit)} (${shared.urgency || 'ok'})` : null,
  ].filter(Boolean).join(' · ')
  return (
    <span className={`m-tokens urg-${urgency}`} title={title} role="status" aria-live="polite">
      <TokenRing pct={pct} urgency={urgency} />
      <span className="m-tokens-col">
        <span className="m-tokens-n">{formatTokens(remaining)}</span>
        <span className="m-tokens-r">
          {resetInSec != null ? formatReset(resetInSec) : '—'}
          {urgency === 'critical' || urgency === 'empty' ? ' ⚡' : ''}
        </span>
      </span>
      <span className="m-tokens-bar" aria-hidden>
        <span className="m-tokens-bar-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
      </span>
    </span>
  )
}

/* ===== MATRIX RAIN BACKGROUND ===== */
function MatrixRain() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*'
    const fontSize = 14
    let cols = 0, drops = [], raf = 0, running = true
    const resize = () => {
      const parent = canvas.parentElement
      const w = parent?.clientWidth || window.innerWidth
      const h = parent?.clientHeight || window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.ceil(w / fontSize)
      drops = Array.from({ length: cols }, () => Math.random() * -50)
    }
    const draw = () => {
      if (!running) return
      const w = canvas.clientWidth, h = canvas.clientHeight
      ctx.fillStyle = 'rgba(0,0,0,0.08)'
      ctx.fillRect(0, 0, w, h)
      ctx.font = `bold ${fontSize}px monospace`
      for (let i = 0; i < drops.length; i++) {
        const ch = letters[(Math.random() * letters.length) | 0]
        const x = i * fontSize, y = drops[i] * fontSize
        ctx.fillStyle = '#b6ffb6'
        ctx.fillText(ch, x, y)
        ctx.fillStyle = '#00ff41'
        ctx.fillText(letters[(Math.random() * letters.length) | 0], x, y - fontSize)
        if (y > h && Math.random() > 0.975) drops[i] = 0
        else drops[i]++
      }
      raf = requestAnimationFrame(draw)
    }
    resize()
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    raf = requestAnimationFrame(draw)
    window.addEventListener('resize', resize)
    const onVis = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf) }
      else if (!running) { running = true; raf = requestAnimationFrame(draw) }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { running = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  return <canvas ref={ref} className="matrix-bg" aria-hidden />
}

function logUX(event, extra) {
  try { console.debug(`[UX] ${event}`, extra || '') } catch (e) { /* ignore */ }
}

/* ===== STORAGE ===== */
function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) { const parsed = JSON.parse(raw); if (parsed && Array.isArray(parsed.chats)) return parsed }
  } catch (e) { /* ignore */ }
  return { chats: [], activeId: null }
}
function saveStore(chats, activeId) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ chats, activeId })) } catch (e) { /* ignore */ }
}
function loadAnimPref() {
  try { return localStorage.getItem(ANIM_KEY) === 'off' ? 'off' : 'on' } catch (e) {} return 'on'
}

/* ===== ICONS ===== */
const ICONS = {
  archive: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>,
  unarchive: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M12 18V9" /><path d="M8 12l4-4 4 4" /></svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>,
}

/* ===== STREAMING TEXT ===== */
function StreamingText({ text, onTick, onDone }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (n < text.length) { const t = setTimeout(() => setN(Math.min(n + 5, text.length)), 15); return () => clearTimeout(t) }
    const t = setTimeout(() => onDone?.(), 150); return () => clearTimeout(t)
  }, [n, text, onDone])
  useEffect(() => { if (n > 0) onTick?.() }, [n, onTick])
  return <div className="msg-txt"><Markdown text={text.slice(0, n)} /></div>
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok
  } catch (e) { return false }
}

function readImageBitmap(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('gambar gagal dimuat')) }
    img.src = url
  })
}

async function compressImageFile(file) {
  const bmp = await readImageBitmap(file); const MAX = 1400
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = canvas.getContext('2d'); ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('kompresi gambar gagal')
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}

async function makeThumb(file) {
  try {
    const bmp = await readImageBitmap(file); const MAX = 96
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d'); ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch (e) { return '' }
}

/* ===== FORMAT CONFERENCE RESULT ===== */
function formatConferenceResult(data) {
  let out = ''
  if (data.rounds && data.rounds.length > 0) {
    for (const rd of data.rounds) {
      out += `### 🏁 Round ${rd.round}\n\n`
      for (const r of rd.responses) {
        if (r.error) continue
        out += `**${r.model}:**\n${r.content}\n\n`
      }
    }
  }
  if (data.conclusion) {
    out += `---\n\n### ✅ Kesimpulan\n\n${data.conclusion}\n`
  }
  return out.trim() || data.conclusion || 'Tidak ada hasil.'
}

/* ===== MESSAGE ===== */
function ChatMessage({ msg, isLast, loading, onEdit, onRegenerate, onRate, rating, onCopy, copied, onStreamDone, onStreamTick }) {
  if (msg.role === 'system') return null
  const isUser = msg.role === 'user'
  const showActions = !isUser ? !msg.streaming : !loading
  const len = (msg.content || '').length
  const cls = ['msg', isUser ? 'user' : 'assistant']
  if (msg.entry) cls.push('entry')
  if (isUser) cls.push(len < 90 ? 'short' : len > 240 ? 'long' : 'med')
  else {
    cls.push(len > 240 ? 'long' : len < 80 ? 'short' : 'med')
    if (/(\*\*|```|^\s*[-*] |^\s*\d+\. )/m.test(msg.content)) cls.push('rich')
    if (msg.content.trim().endsWith('?')) cls.push('ask')
  }
  return (
    <div className={cls.join(' ')}>
      <div className="msg-row">
        <div className="msg-av"><div className={`av ${isUser ? 'user' : 'assistant'}`}>
          {isUser ? 'U' : <img src="/ai-avatar.png" alt="AI" className="av-img" />}
        </div></div>
        <div className="msg-c">
          {isUser && msg.attachment && (
            <div className="msg-file">
              {msg.attachment.thumb
                ? <img className="msg-file-thumb" src={msg.attachment.thumb} alt={msg.attachment.name} />
                : <div className="msg-file-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8M10 9H8" /></svg></div>}
              <span className="msg-file-nm" title={msg.attachment.name}>{msg.attachment.name}</span>
            </div>
          )}
          {msg.streaming && !isUser
            ? <StreamingText text={msg.content} onTick={onStreamTick} onDone={() => onStreamDone?.(msg.id)} />
            : <div className="msg-txt"><Markdown text={msg.content} /></div>}
          {showActions && (
            <div className="msg-acts">
              {isUser ? (
                <button className="act-btn" title="Edit pesan" onClick={() => onEdit(msg)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                </button>
              ) : (
                <>
                  <button className={`act-btn ${copied ? 'copy-done' : ''}`} title="Salin" onClick={() => onCopy(msg)}>
                    {copied
                      ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                      : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>}
                  </button>
                  <button className={`act-btn ${rating === 'up' ? 'rated' : ''}`} title="Suka" onClick={() => onRate(msg, 'up')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 10v12" /><path d="M15 5.88L14 10h5.83a2 2 0 011.92 2.56l-2.33 8A2 2 0 0115.5 22H8a2 2 0 01-2-2v-8a2 2 0 011-1.73l7-4a2 2 0 012.12.26l-1.12 1.35z" /></svg>
                  </button>
                  <button className={`act-btn ${rating === 'down' ? 'down' : ''}`} title="Tidak suka" onClick={() => onRate(msg, 'down')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 14V2" /><path d="M9 18.12L10 14H4.17a2 2 0 01-1.92-2.56l2.33-8A2 2 0 018.5 2H16a2 2 0 012 2v8a2 2 0 01-1 1.73l-7 4a2 2 0 01-2.12-.26l1.12-1.35z" /></svg>
                  </button>
                  {isLast && !loading && (
                    <button className="act-btn regen" title="Buat ulang" onClick={() => onRegenerate(msg)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 11-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {isUser && msg.status && (
            <div className="msg-meta"><span className={`msg-status ${msg.status}`} title={msg.status === 'read' ? 'Dibaca' : 'Terkirim'}>
              {msg.status === 'read' ? '✓✓' : '✓'}
            </span></div>
          )}
        </div>
      </div>
      {msg.content && !msg.streaming && (
        <div className={`msg-copy-row ${isUser ? 'user' : 'assistant'}`}>
          <button type="button" className={`msg-copy-btn ${copied ? 'done' : ''}`} onClick={() => onCopy(msg)} title={copied ? 'Disalin!' : 'Salin teks chat'}>
            {copied
              ? <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg><span>Disalin</span></>
              : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg><span>Salin</span></>}
          </button>
        </div>
      )}
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="msg assistant">
      <div className="msg-row">
        <div className="msg-av"><div className="av assistant"><img src="/ai-avatar.png" alt="AI" className="av-img" /></div></div>
        <div className="msg-c">
          <div className="typing chat typing-orbit" aria-label="Mengetik">
            <div className="typ-orbit" role="status">
              <span className="typ-orbit-dot" /><span className="typ-orbit-dot" />
              <span className="typ-orbit-dot" /><span className="typ-orbit-dot" />
              <span className="typ-orbit-dot" /><span className="typ-orbit-dot" />
              <span className="typ-orbit-dot" /><span className="typ-orbit-dot" />
            </div>
            <span className="typ-label">🗣️🧠🔍🎨 Models sedang berdiskusi…</span>
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
  useEffect(() => {
    if (window.innerWidth <= 768) setSidebarOpen(false)
    const onResize = () => { if (window.innerWidth > 768) setSidebarOpen(true) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [showArchive, setShowArchive] = useState(false)
  const [file, setFile] = useState(null)
  const [ratings, setRatings] = useState({})
  const [copiedId, setCopiedId] = useState(null)
  const [toast, setToast] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')
  const [animPref, setAnimPref] = useState(loadAnimPref)
  const [showSettings, setShowSettings] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [profile, setProfile] = useState(loadProfile)
  const [session, setSession] = useState(loadSession)
  const [tokenUsage, setTokenUsage] = useState(null)
  const [now, setNow] = useState(Date.now())

  const chatRef = useRef(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)
  const abortRef = useRef(null)
  const toastTimer = useRef(null)
  const copiedTimer = useRef(null)
  const attachFilesRef = useRef(new Map())
  const scrollRAF = useRef(null)
  const userScrolledUpRef = useRef(false)

  useEffect(() => { saveStore(chats, activeId) }, [chats, activeId])
  useEffect(() => { try { localStorage.setItem(ANIM_KEY, animPref) } catch (e) {} }, [animPref])
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const apply = () => setSidebarOpen(!mq.matches)
    apply(); mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])

  const isLoggedInToken = Boolean(session?.guestId)

  const applyTokenUsage = useCallback((remoteUser) => {
    if (!remoteUser || typeof remoteUser !== 'object') return
    setTokenUsage(prev => {
      const now = Date.now()
      const merged = mergeTokenUser(prev?.user, remoteUser, now)
      saveLocalTokenUser(merged)
      return { ...(prev || {}), user: merged, shared: prev?.shared, _clientFetchedAt: now }
    })
  }, [])

  const deductLocalTokens = useCallback((tokens) => {
    const n = Math.max(0, Math.round(Number(tokens) || 0))
    if (n <= 0) return
    setTokenUsage(prev => {
      const now = Date.now()
      const base = normalizeTokenUser(prev?.user || { isLoggedIn: isLoggedInToken, quota: isLoggedInToken ? TOKEN_QUOTA_LOGIN : TOKEN_QUOTA_GUEST }, now)
      const used = base.used + n
      const next = normalizeTokenUser({ ...base, used }, now)
      saveLocalTokenUser(next)
      return { ...(prev || {}), user: next, _clientFetchedAt: now }
    })
  }, [isLoggedInToken])

  const pollTokenUsage = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    try {
      const gid = session?.guestId || ''
      const res = await fetch(`/api/token-usage?guestId=${encodeURIComponent(gid)}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setTokenUsage(prev => {
        const now = Date.now()
        const mergedUser = mergeTokenUser(prev?.user, data.user, now)
        saveLocalTokenUser(mergedUser)
        return { shared: data.shared, user: mergedUser, _clientFetchedAt: now }
      })
    } catch (e) {}
  }, [session])

  useEffect(() => {
    const local = loadLocalTokenUser(isLoggedInToken)
    if (local) {
      setTokenUsage(prev => ({ ...(prev || {}), user: mergeTokenUser(local, prev?.user, Date.now()), _clientFetchedAt: Date.now() }))
    } else {
      const seed = normalizeTokenUser({ isLoggedIn: isLoggedInToken, quota: isLoggedInToken ? TOKEN_QUOTA_LOGIN : TOKEN_QUOTA_GUEST, used: 0, resetAt: tokenWindowEnd() })
      setTokenUsage(prev => ({ ...(prev || {}), user: seed, _clientFetchedAt: Date.now() }))
      saveLocalTokenUser(seed)
    }
    pollTokenUsage()
  }, [isLoggedInToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let timer
    const schedule = () => {
      const u = tokenUsage?.user
      const urgency = u?.urgency || 'ok'
      const leftMs = u?.resetAt ? u.resetAt - Date.now() : 99999
      let interval = 2500
      if (urgency === 'empty' || urgency === 'critical') interval = 600
      else if (urgency === 'low') interval = 1200
      else if (urgency === 'mid') interval = 1800
      if (leftMs > 0 && leftMs < 5000) interval = Math.min(interval, 300)
      timer = setTimeout(async () => { await pollTokenUsage(); schedule() }, interval)
    }
    schedule()
    const onVis = () => { if (!document.hidden) pollTokenUsage() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [pollTokenUsage, tokenUsage?.user?.urgency, tokenUsage?.user?.resetAt])

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now(); setNow(t)
      setTokenUsage(prev => {
        if (!prev?.user) return prev
        const next = normalizeTokenUser(prev.user, t)
        if (next.used === prev.user.used && next.resetAt === prev.user.resetAt && next.remaining === prev.user.remaining) return prev
        saveLocalTokenUser(next)
        return { ...prev, user: next }
      })
    }, 100)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const resetAt = tokenUsage?.user?.resetAt
    if (!resetAt) return
    const left = resetAt - Date.now()
    if (left > 0 && left < 1500) {
      const t = setTimeout(() => pollTokenUsage(), Math.max(0, left) + 50)
      return () => clearTimeout(t)
    }
  }, [now, tokenUsage?.user?.resetAt, pollTokenUsage])

  useEffect(() => { saveProfile(profile) }, [profile])
  useEffect(() => { if (session) saveSession(session); else clearSession() }, [session])

  useEffect(() => {
    if (!activeId || !messages.some(m => m.role === 'user')) return
    setChats(prev => {
      const exists = prev.some(c => c.id === activeId)
      const updated = exists
        ? prev.map(c => c.id === activeId ? { ...c, messages, title: chatTitle, updatedAt: Date.now() } : c)
        : [...prev, { id: activeId, title: chatTitle, messages, archived: false, updatedAt: Date.now() }]
      return updated
    })
  }, [messages, activeId, chatTitle])

  const isNearBottom = useCallback((threshold = 120) => {
    const el = chatRef.current; if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
  }, [])

  const scrollDown = useCallback((smooth = true) => {
    userScrolledUpRef.current = false
    const el = chatRef.current; if (!el) return
    cancelAnimationFrame(scrollRAF.current)
    const target = () => Math.max(0, el.scrollHeight - el.clientHeight)
    if (!smooth) { el.scrollTop = target(); return }
    const start = el.scrollTop, end = target(), distance = end - start
    if (Math.abs(distance) < 1) { el.scrollTop = end; return }
    const duration = Math.min(520, Math.max(180, 140 + Math.sqrt(Math.abs(distance)) * 14))
    let t0 = null
    const step = (ts) => {
      if (t0 == null) t0 = ts
      const p = Math.min((ts - t0) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 5)
      const liveEnd = target()
      el.scrollTop = start + (liveEnd - start) * ease
      if (p < 1) scrollRAF.current = requestAnimationFrame(step)
      else el.scrollTop = target()
    }
    scrollRAF.current = requestAnimationFrame(step)
  }, [])

  const autoScroll = useCallback((smooth = true) => {
    if (userScrolledUpRef.current) return
    const el = chatRef.current; if (!el) return
    if (!isNearBottom(180) && !loading) return
    cancelAnimationFrame(scrollRAF.current)
    if (smooth) scrollDown(true)
    else scrollRAF.current = requestAnimationFrame(() => { if (el && !userScrolledUpRef.current) el.scrollTop = el.scrollHeight })
  }, [scrollDown, isNearBottom, loading])

  useEffect(() => { autoScroll(true) }, [messages, autoScroll])
  useEffect(() => {
    if (!loading) return
    if (userScrolledUpRef.current) return
    const id = setInterval(() => { const el = chatRef.current; if (!el || userScrolledUpRef.current) return; el.scrollTop = el.scrollHeight }, 100)
    return () => clearInterval(id)
  }, [loading])
  useEffect(() => { if (!loading) taRef.current?.focus() }, [loading])
  useEffect(() => { return () => cancelAnimationFrame(scrollRAF.current) }, [])

  const showToast = useCallback((msg) => {
    setToast(msg); clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2200)
  }, [])

  const handleScroll = useCallback(() => {
    const el = chatRef.current; if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScroll(dist > 140)
    if (dist > 140) userScrolledUpRef.current = true
    else if (dist < 24) userScrolledUpRef.current = false
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSidebarOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /* ===== SEND — ALWAYS CONFERENCE (semua model saling bicara) ===== */
  const send = useCallback(async (messageList, text, attach = null) => {
    if ((!text && !attach) || loading) return
    setLoading(true); setError('')
    logUX('send')

    let clientTokenHint = null
    try {
      const u = loadLocalTokenUser(Boolean(session?.guestId))
      if (u) clientTokenHint = { used: u.used, resetAt: u.resetAt }
    } catch (e) { clientTokenHint = null }

    const est = estimateSpend(text, attach)
    deductLocalTokens(est)

    if (animPref === 'on') await new Promise(r => setTimeout(r, 300 + Math.random() * 600))

    const controller = new AbortController()
    abortRef.current = controller

    try {
      let endpoint, fetchBody

      if (attach) {
        // File upload tetap pakai /api/upload
        endpoint = '/api/upload'
        const form = new FormData()
        form.append('message', text)
        form.append('file', attach.file)
        form.append('history', JSON.stringify(messageList.map(m => ({ role: m.role, content: m.content }))))
        form.append('guestId', session?.guestId || '')
        fetchBody = form
      } else {
        // SEMUA pertanyaan teks → conference (semua model berdiskusi)
        endpoint = '/api/conference'
        fetchBody = JSON.stringify({
          topic: text,
          rounds: 2,
          guestId: session?.guestId || '',
        })
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: attach ? undefined : { 'Content-Type': 'application/json' },
        body: fetchBody,
        signal: controller.signal,
      })

      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}))
        if (e2.tokenUsage) applyTokenUsage(e2.tokenUsage)
        throw new Error(e2.error || `Error ${res.status}`)
      }

      const data = await res.json()
      if (data.tokenUsage) applyTokenUsage(data.tokenUsage)

      let content = ''
      if (endpoint === '/api/conference') {
        // Format hasil conference: tiap model + kesimpulan
        content = formatConferenceResult(data)
      } else {
        // Upload result
        content = data.content || ''
      }

      if (!content) throw new Error(data?.error || 'Respon kosong')

      logUX('delivered')
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
      pollTokenUsage()
    }
  }, [loading, animPref, pollTokenUsage, applyTokenUsage, session, deductLocalTokens])

  const handleSubmit = useCallback((e) => {
    e?.preventDefault()
    const text = input.trim()
    if ((!text && !file) || loading) return
    if (!activeId) setActiveId(nextId())
    const attach = file ? {
      name: file.name, type: file.type, thumb: file.thumb,
      kind: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'doc',
      file: file.file,
    } : null
    const userMsg = {
      id: nextId(), role: 'user', content: text, entry: true, status: 'sent',
      attachment: attach ? { name: attach.name, type: attach.type, thumb: attach.thumb, kind: attach.kind } : null,
    }
    if (attach) attachFilesRef.current.set(userMsg.id, attach.file)
    const all = [...messages, userMsg]
    setMessages(all); setInput(''); setFile(null)
    if (!messages.some(m => m.role === 'user')) setChatTitle(truncate(text || attach?.name, 40))
    userScrolledUpRef.current = false
    setTimeout(() => scrollDown(true), 50)
    send(all, text, attach)
  }, [input, loading, messages, activeId, send, file, scrollDown])

  const stopGeneration = useCallback(() => { abortRef.current?.abort(); setLoading(false) }, [])

  const retry = useCallback(() => {
    if (loading) return
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    setError(''); userScrolledUpRef.current = false
    const retryFile = attachFilesRef.current.get(lastUser.id)
    send(messages, lastUser.content, retryFile ? { ...lastUser.attachment, file: retryFile } : null)
  }, [loading, messages, send])

  const editMessage = useCallback((msg) => {
    if (loading) return
    setMessages(prev => { const idx = prev.findIndex(m => m.id === msg.id); return idx === -1 ? prev : prev.slice(0, idx) })
    setInput(msg.content); setError('')
    setTimeout(() => { taRef.current?.focus() }, 60)
  }, [loading])

  const regenerate = useCallback((msg) => {
    if (loading) return
    const idx = messages.findIndex(m => m.id === msg.id); if (idx === -1) return
    const before = messages.slice(0, idx)
    const userMsg = [...before].reverse().find(m => m.role === 'user')
    if (!userMsg) return
    setMessages(before); showToast('Membuat ulang jawaban...')
    const regenFile = attachFilesRef.current.get(userMsg.id)
    send(before, userMsg.content, regenFile ? { ...userMsg.attachment, file: regenFile } : null)
  }, [loading, messages, send, showToast])

  const rate = useCallback((msg, val) => {
    const current = ratings[msg.id]; const next = current === val ? null : val
    setRatings(prev => ({ ...prev, [msg.id]: next }))
    showToast(next === null ? 'Penilaian dihapus' : next === 'up' ? 'Terima kasih! 👍' : 'Terima kasih atas masukannya 👎')
  }, [ratings, showToast])

  const copy = useCallback((msg) => {
    const done = () => {
      setCopiedId(msg.id); showToast('Pesan disalin!')
      clearTimeout(copiedTimer.current); copiedTimer.current = setTimeout(() => setCopiedId(null), 2000)
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(msg.content).then(done).catch(() => { if (fallbackCopy(msg.content)) done() })
    else if (fallbackCopy(msg.content)) done()
  }, [showToast])

  const finishStream = useCallback((id) => { setMessages(prev => prev.map(m => m.id === id ? { ...m, streaming: false } : m)) }, [])

  const newChat = useCallback(() => {
    abortRef.current?.abort(); setLoading(false)
    setActiveId(null); setMessages([]); setChatTitle('Zanco-Ai')
    setError(''); setInput(''); setFile(null); setRatings({})
    setShowArchive(false); taRef.current?.focus()
  }, [])

  const openChat = useCallback((id) => {
    const c = chats.find(x => x.id === id); if (!c) return
    abortRef.current?.abort(); setLoading(false)
    setActiveId(id); setMessages(c.messages); setChatTitle(c.title)
    setError(''); setInput(''); setRatings({})
    setSidebarOpen(() => window.innerWidth > 768)
  }, [chats])

  const archiveChat = useCallback((id) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, archived: true, updatedAt: Date.now() } : c))
    if (id === activeId) { setActiveId(null); setMessages([]); setChatTitle('Zanco-Ai'); setError(''); setInput('') }
    showToast('Chat diarsipkan')
  }, [activeId, showToast])

  const archiveActive = useCallback(() => {
    if (!activeId) { setShowArchive(true); return }
    archiveChat(activeId); setShowArchive(true)
  }, [activeId, archiveChat])

  const unarchiveChat = useCallback((id) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, archived: false, updatedAt: Date.now() } : c))
    showToast('Chat dipulihkan dari arsip')
  }, [showToast])

  const deleteChat = useCallback((id) => {
    setChats(prev => prev.filter(c => c.id !== id))
    if (id === activeId) { setActiveId(null); setMessages([]); setChatTitle('Zanco-Ai'); setError(''); setInput('') }
    showToast('Chat dihapus')
  }, [activeId, showToast])

  const clearHistoryChat = useCallback(() => {
    abortRef.current?.abort(); setLoading(false); setChats([]); setActiveId(null); setMessages([])
    setChatTitle('Zanco-Ai'); setError(''); setInput(''); setFile(null); setRatings({})
    setShowArchive(false); setShowMenu(false)
    try { localStorage.removeItem(STORAGE_KEY) } catch (e) {}
    showToast('Riwayat chat dihapus'); taRef.current?.focus()
  }, [showToast])

  const handleFile = useCallback(async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    if (f.size > 4 * 1024 * 1024) { showToast('File maksimal 4MB'); e.target.value = ''; return }
    try {
      const isImage = f.type.startsWith('image/')
      const uploadFile = isImage ? await compressImageFile(f) : f
      const thumb = isImage ? await makeThumb(f) : ''
      setFile({ name: f.name, size: f.size, type: f.type, file: uploadFile, thumb })
    } catch (err) { showToast('Gagal memproses file') }
    e.target.value = ''
  }, [showToast])

  const share = useCallback(() => { navigator.clipboard.writeText(window.location.href).then(() => showToast('Link disalin!')) }, [showToast])

  useEffect(() => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px' }
  }, [input])

  const handleKey = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }, [handleSubmit])

  const placeholder = "Tanya apa saja — semua AI berdiskusi untukmu..."

  const activeChats = [...chats].filter(c => !c.archived).sort((a, b) => b.updatedAt - a.updatedAt)
  const archivedChats = [...chats].filter(c => c.archived).sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className={`layout ${animPref === 'off' ? 'anim-off' : ''}`}>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
        <div className="sb-brand">
          <span className="sb-logo" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="url(#zg)"/><defs><linearGradient id="zg" x1="2" y1="2" x2="22" y2="22"><stop stopColor="#459AFF"/><stop offset="1" stopColor="#6054FF"/></linearGradient></defs></svg>
          </span>
          <span className="sb-brand-name">ZANCO</span>
        </div>
        <div className="sb-actions">
          <button className="new-btn" onClick={newChat}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New chat
          </button>
          <button className="sb-search-btn" type="button" title="Cari" onClick={() => document.getElementById('hist-search')?.focus()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          </button>
        </div>
        <div className="sidebar-search">
          <div className="search-wrap">
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input id="hist-search" className="search-input" placeholder="Cari riwayat..." value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} />
          </div>
        </div>
        <div className="sidebar-list">
          {showArchive ? (
            <>
              <div className="hist-row"><span className="hist-group">Arsip ({archivedChats.length})</span></div>
              {archivedChats.length === 0 ? <div className="empty-state">Tidak ada chat di arsip</div>
              : archivedChats.filter(c => c.title.toLowerCase().includes(historyQuery.toLowerCase())).map(c => (
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
              <div className="hist-row">
                <span className="hist-group">Your conversations</span>
                <button type="button" className="hist-clear" onClick={clearHistoryChat}>Clear All</button>
              </div>
              {activeChats.length === 0 ? <div className="empty-state">Belum ada chat. Mulai percakapan baru!</div>
              : activeChats.filter(c => c.title.toLowerCase().includes(historyQuery.toLowerCase())).map(c => (
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
            <button className="sidebar-bt-item" onClick={() => setShowArchive(false)}>{ICONS.back} Kembali ke chat</button>
          ) : (
            <button className="sidebar-bt-item" onClick={() => setShowArchive(true)}>
              {ICONS.archive} Arsip {archivedChats.length > 0 && <span className="arch-badge">{archivedChats.length}</span>}
            </button>
          )}
          <button className="sidebar-bt-item sb-settings" onClick={() => setShowSettings(true)}>
            <span className="sb-ic-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m9.9 9.9l2.1 2.1m0-14.1l-2.1 2.1M7 17.1l-2.1 2.1" /></svg></span>
            Settings
          </button>
          <button type="button" className="sidebar-user" onClick={() => setShowProfile(true)} title="Profil">
            <div className="sidebar-user-av">
              {profile.avatar ? <img src={profile.avatar} alt="" /> : <span>{(profile.name || DEFAULT_PROFILE.name).charAt(0).toUpperCase()}</span>}
            </div>
            <span className="sidebar-user-nm">{profile.name || DEFAULT_PROFILE.name}</span>
            <span className="sb-logout-ic" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
          </button>
        </div>
      </aside>

      <main className="main figma-main">
        <div className="figma-top">
          <button className="topbar-btn figma-menu-btn" onClick={() => setSidebarOpen(o => !o)} title="Menu" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <div className="figma-ai-avatar" title="Zanco-Ai"><span className="figma-ai-diamond" aria-hidden /></div>
          <div className="figma-top-meta">
            <span className="figma-top-title">Zanco-Ai</span>
            <TokenBadge usage={tokenUsage} now={now} />
          </div>
          <div className="figma-top-actions">
            <button className="topbar-btn" onClick={share} title="Bagikan" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
            </button>
            <div className="topbar-menu-wrap">
              <button className="topbar-btn" title="Menu" aria-haspopup="menu" aria-expanded={showMenu} onClick={() => setShowMenu(o => !o)} type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
              </button>
              {showMenu && (
                <>
                  <div className="topbar-menu-backdrop" onClick={() => setShowMenu(false)} />
                  <div className="topbar-menu" role="menu" aria-label="Menu">
                    <button type="button" role="menuitem" className="topbar-menu-item danger" onClick={clearHistoryChat}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
                      Clear history chat
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="chat" ref={chatRef} onScroll={handleScroll}>
          <div className="chat-inner">
            {messages.map((msg, i) => (
              <ChatMessage key={msg.id} msg={msg} isLast={i === messages.length - 1} loading={loading}
                onEdit={editMessage} onRegenerate={regenerate} onRate={rate} rating={ratings[msg.id]}
                onCopy={copy} copied={copiedId === msg.id} onStreamDone={finishStream} onStreamTick={() => autoScroll(false)} />
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
        </div>

        <button className={`scroll-btm ${showScroll ? 'show' : ''}`} onClick={() => scrollDown()} aria-label="Scroll ke bawah">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>

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
              <textarea ref={taRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
                placeholder={placeholder} disabled={loading} rows={1} />
              {loading ? (
                <button type="button" className="send-btn stop" onClick={stopGeneration} title="Hentikan">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                </button>
              ) : (
                <button type="submit" disabled={!input.trim() && !file} className={`send-btn ${input.trim() || file ? 'active' : ''}`} title="Kirim pesan">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
              )}
            </form>
          </div>
        </div>
      </main>

      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings" role="dialog" aria-modal="true" aria-label="Setelan" onClick={e => e.stopPropagation()}>
            <div className="settings-hd">
              <h3>Setelan</h3>
              <button className="settings-close" onClick={() => setShowSettings(false)} aria-label="Tutup setelan">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="settings-about">
              <div className="settings-about-ic" aria-hidden>✨</div>
              <p className="settings-about-tx">AI ini dibuat oleh developer tunggal<br /><strong>~Andmute🎉</strong></p>
            </div>
          </div>
        </div>
      )}

      {showProfile && <ProfilePanel profile={profile} session={session} onProfileChange={setProfile} onSessionChange={setSession} onClose={() => setShowProfile(false)} onToast={showToast} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
