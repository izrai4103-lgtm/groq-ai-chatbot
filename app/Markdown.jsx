'use client'

import { Fragment, useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

// Parse text menjadi React nodes (aman, tanpa innerHTML)
export default function Markdown({ text }) {
  if (!text) return null
  const nodes = parseBlocks(text)
  return <>{nodes}</>
}

/* ===== KOTAK KECIL SUMBER/LINK (dari web research) ===== */
function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch (e) {
    return String(url)
  }
}

function SourceChip({ href, label }) {
  const host = hostnameOf(href)
  const lbl = String(label || '').trim()
  const text = lbl && lbl !== href ? lbl : host
  return (
    <a className="src-chip" href={href} target="_blank" rel="noopener noreferrer" title={host}>
      <svg className="src-chip-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
      <span className="src-chip-txt">{text}</span>
      <svg className="src-chip-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
        <path d="M15 3h6v6" />
        <path d="M10 14L21 3" />
      </svg>
    </a>
  )
}

/* ===== KOTAK KODE KECIL + TOMBOL SALIN ===== */
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

const PREVIEW_LANGS = ['html', 'jsx']

function canPreview(lang) {
  return PREVIEW_LANGS.includes(String(lang || '').toLowerCase().trim())
}

function escapeScriptTags(s) {
  return String(s).replace(/<\/script/gi, '<\\/script')
}

// Dokumen preview HTML (dibungkus template bila hanya snippet)
function buildHtmlDoc(code) {
  const lower = String(code).toLowerCase()
  if (lower.includes('<!doctype') || lower.includes('<html')) return code
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#111;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
  body{padding:24px;min-height:100vh;box-sizing:border-box}
  img,svg,video,canvas{max-width:100%}
</style>
</head>
<body>
${code}
</body>
</html>`
}

// Dokumen preview JSX: transpile dengan Babel standalone + React di iframe sandbox
function buildJsxDoc(code) {
  const src = escapeScriptTags(
    String(code)
      .replace(/^\s*import\s+(\w+)\s*,\s*\{([^}]*)\}\s+from\s+['"]react['"]\s*;?\s*$/gim, 'const $1 = window.React; const { $2 } = window.React;')
      .replace(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"]react['"]\s*;?\s*$/gim, 'const $1 = window.React;')
      .replace(/^\s*import\s+\{([^}]*)\}\s+from\s+['"]react['"]\s*;?\s*$/gim, 'const { $1 } = window.React;')
      .replace(/^\s*import\s+(\w+)\s+from\s+['"]react['"]\s*;?\s*$/gim, 'const $1 = window.React;')
      .replace(/^\s*import\s+(\w+)\s+from\s+['"]react-dom['"]\s*;?\s*$/gim, 'const $1 = window.ReactDOM;')
      .replace(/^\s*import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*$/gim, '')
      .replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gim, '')
      .replace(/^\s*export\s+default\s+/gm, '')
      .replace(/^\s*export\s+/gm, '')
  )
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://unpkg.com/@babel/standalone@7.26.4/babel.min.js"><\/script>
<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"><\/script>
<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"><\/script>
<style>
  html,body{margin:0;padding:0;background:#fff;color:#111;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
  #root{min-height:100vh}
</style>
</head>
<body>
<div id="root"></div>
<script type="text/babel" data-presets="react">
var React = window.React; var ReactDOM = window.ReactDOM;
${src}
<\/script>
<script>
try {
  var __C = window.App || window.MyApp || window.Component;
  var __root = document.getElementById('root');
  if (__C) ReactDOM.createRoot(__root).render(React.createElement(__C));
  else if (!__root.childNodes.length) __root.innerHTML = '<div style="padding:20px;font-family:system-ui,sans-serif;color:#888">Tidak ada komponen (App/MyApp/Component) untuk di-preview.</div>';
} catch (e) {
  document.getElementById('root').innerHTML = '<pre style="margin:0;padding:16px;font-size:12px;color:#dc2626;white-space:pre-wrap;font-family:monospace">Preview error: ' + e.message + '</pre>';
}
<\/script>
</body>
</html>`
}

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false)
  const [preview, setPreview] = useState(false)
  const timer = useRef(null)

  const previewable = canPreview(lang)
  const previewDoc = useMemo(() => {
    if (!previewable) return null
    const l = lang.toLowerCase().trim()
    return l === 'jsx' ? buildJsxDoc(code) : buildHtmlDoc(code)
  }, [previewable, lang, code])

  useEffect(() => {
    if (!preview) return
    const onKey = (e) => { if (e.key === 'Escape') setPreview(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  const onCopy = () => {
    const done = () => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(() => { if (fallbackCopy(code)) done() })
    } else if (fallbackCopy(code)) {
      done()
    }
  }

  return (
    <div className="codebox">
      <div className="codebox-hd">
        <span className="codebox-lang">{lang || 'Kode'}</span>
        <span className="codebox-acts">
          {previewable && (
            <button
              type="button"
              className={`codebox-prev ${preview ? 'active' : ''}`}
              onClick={() => setPreview(p => !p)}
              title="Preview kode"
              aria-label="Preview kode"
              aria-pressed={preview}
            >
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              <span>Preview</span>
            </button>
          )}
          <button
            type="button"
            className={`codebox-copy ${copied ? 'done' : ''}`}
            onClick={onCopy}
            title="Salin kode"
            aria-label="Salin kode"
            aria-pressed={copied}
          >
            {copied ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
            )}
            <span>{copied ? 'Tersalin' : 'Salin'}</span>
          </button>
        </span>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
      {preview && previewDoc && createPortal(
        <div
          className="code-preview-overlay"
          onClick={() => setPreview(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Preview kode"
        >
          <div className="code-preview-panel" onClick={(e) => e.stopPropagation()}>
            <div className="code-preview-hd">
              <span className="code-preview-title">Preview {lang}</span>
              <button
                type="button"
                className="code-preview-close"
                onClick={() => setPreview(false)}
                title="Tutup preview"
                aria-label="Tutup preview"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <iframe
              title={`Preview ${lang}`}
              className="code-preview-frame"
              sandbox="allow-scripts"
              srcDoc={previewDoc}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

/* ===== DETEKSI KODE TANPA FENCE (fallback) ===== */
function looksLikeCode(line) {
  return (
    /^ {3,}\S/.test(line) ||                 // indentasi 3+ spasi
    /<[!\/]?[a-zA-Z][^>]*>/.test(line) ||    // tag/doctype HTML
    /^\s*(?:function|const|let|var|def|class|import|export|return|from|print|if|for|while|switch|catch|async|await)\b/.test(line) ||
    /[{};]\s*$/.test(line)                   // baris kode berakhiran { } ;
  )
}

function detectLang(line) {
  if (/<[!\/]?[a-zA-Z][^>]*>/.test(line)) return 'HTML'
  if (/^\s*[.#]?[a-zA-Z-]+\s*\{/.test(line)) return 'CSS'
  if (/^ {3,}[a-zA-Z-]+\s*:\s*[^;]+;/.test(line)) return 'CSS'
  if (/^\s*(?:def|class|import|from|print)\b/.test(line) || /\bdef\s+\w+\s*\(/.test(line)) return 'Python'
  if (/^\s*(?:function|const|let|var|async|await)\b/.test(line) || /=>/.test(line)) return 'JavaScript'
  return 'Kode'
}

function parseBlocks(text) {
  // Pisahkan code blocks dari teks biasa
  const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g)
  const out = []
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      if (parts[i]) out.push(...parseInlineBlocks(parts[i]))
    } else if (i % 3 === 1) {
      const lang = parts[i]
      const code = parts[i + 1]
      out.push(
        <CodeBlock key={i} lang={lang} code={code} />
      )
      i++ // skip code content
    }
  }
  return out
}

function parseInlineBlocks(text) {
  const lines = text.split('\n')
  const out = []
  let list = null
  let listType = null
  let codeBuf = null

  for (const line of lines) {
    const trimmed = line.trim()

    // Kode tanpa fence (fallback): indentasi, tag HTML, pola JS/CSS/Python
    if (looksLikeCode(trimmed)) {
      flushList()
      if (!codeBuf) codeBuf = { lang: detectLang(trimmed), lines: [] }
      codeBuf.lines.push(line)
      continue
    }

    // Heading
    const h = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      flushList(); flushCode()
      const level = h[1].length
      const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
      out.push(<Tag key={out.length}>{parseInline(h[2])}</Tag>)
      continue
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushList(); flushCode()
      out.push(<blockquote key={out.length}>{parseInline(trimmed.slice(2))}</blockquote>)
      continue
    }

    // List
    const ul = trimmed.match(/^[-*•]\s+(.+)$/)
    const ol = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (ul || ol) {
      flushList(); flushCode()
      const type = ul ? 'ul' : 'ol'
      if (!list || listType !== type) {
        list = []
        listType = type
        out.push(<List key={`list-${out.length}`} type={type} items={list} />)
      }
      list.push(parseInline((ul || ol)[1]))
      continue
    }

    // Paragraf kosong = pemisah (baris kosong di dalam kode tetap bagian kode)
    if (trimmed === '') {
      flushList()
      if (codeBuf) { codeBuf.lines.push(''); continue }
      continue
    }

    // Paragraf biasa
    flushList(); flushCode()
    out.push(<p key={out.length}>{parseInline(trimmed)}</p>)
  }

  flushList()
  flushCode()
  return out

  function flushList() {
    if (list) { list = null; listType = null }
  }
  function flushCode() {
    if (codeBuf) {
      out.push(<CodeBlock key={`cb-${out.length}`} lang={codeBuf.lang} code={codeBuf.lines.join('\n')} />)
      codeBuf = null
    }
  }
}

function List({ type, items }) {
  const Tag = type
  return (
    <Tag>
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </Tag>
  )
}

function parseInline(text) {
  const nodes = []
  let i = 0

  const patterns = [
    { re: /\*\*([^*]+)\*\*/g, render: (m) => <strong key={i}>{m[1]}</strong> },
    { re: /__([^_]+)__/g, render: (m) => <strong key={i}>{m[1]}</strong> },
    { re: /\*([^*]+)\*/g, render: (m) => <em key={i}>{m[1]}</em> },
    { re: /_([^_]+)_/g, render: (m) => <em key={i}>{m[1]}</em> },
    { re: /`([^`]+)`/g, render: (m) => <code key={i}>{m[1]}</code> },
    { re: /\[([^\]]+)\]\(([^)\s]+)\)/g, render: (m) => <SourceChip key={i} href={m[2]} label={m[1]} /> },
    { re: /(?:https?:\/\/|www\.)[^\s<>()[\]]+/g, render: (m) => <SourceChip key={i} href={m[0]} label={m[0]} /> },
  ]

  // Cari token pertama yang match
  let cursor = 0
  const tokens = []

  for (const { re, render } of patterns) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, render: render(m) })
    }
  }

  tokens.sort((a, b) => a.start - b.start)

  // Handle overlap sederhana
  let lastEnd = 0
  for (const t of tokens) {
    if (t.start < lastEnd) continue
    if (t.start > cursor) {
      nodes.push(text.slice(cursor, t.start))
    }
    nodes.push(t.render)
    cursor = t.end
    lastEnd = t.end
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))

  return nodes.length === 0 ? text : nodes
}
