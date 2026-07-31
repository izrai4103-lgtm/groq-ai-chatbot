'use client'

import { Fragment, useState, useRef } from 'react'

// Parse text menjadi React nodes (aman, tanpa innerHTML)
export default function Markdown({ text }) {
  if (!text) return null
  const nodes = parseBlocks(text)
  return <>{nodes}</>
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

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)

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
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
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

  for (const line of lines) {
    const trimmed = line.trim()

    // Heading
    const h = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      flushList()
      const level = h[1].length
      const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
      out.push(<Tag key={out.length}>{parseInline(h[2])}</Tag>)
      continue
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushList()
      out.push(<blockquote key={out.length}>{parseInline(trimmed.slice(2))}</blockquote>)
      continue
    }

    // List
    const ul = trimmed.match(/^[-*•]\s+(.+)$/)
    const ol = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol'
      if (!list || listType !== type) {
        flushList()
        list = []
        listType = type
        out.push(<List key={`list-${out.length}`} type={type} items={list} />)
      }
      list.push(parseInline((ul || ol)[1]))
      continue
    }

    // Paragraf kosong = pemisah
    if (trimmed === '') {
      flushList()
      continue
    }

    // Paragraf biasa
    flushList()
    out.push(<p key={out.length}>{parseInline(trimmed)}</p>)
  }

  flushList()
  return out

  function flushList() {
    if (list) { list = null; listType = null }
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
    { re: /\[([^\]]+)\]\(([^)\s]+)\)/g, render: (m) => <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a> },
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
