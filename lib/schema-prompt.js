/**
 * 🧩 Schema System Prompt Builder
 * ================================
 * Membaca schema.json (sumber aturan perilaku AI) lalu menggabungkan
 * semua field-nya menjadi satu teks system prompt yang dikirim ke API
 * model (Groq). Template system_prompt_template di-render dengan nilai
 * dari field lain (assistant_identity, conversation_style, dst).
 *
 * Alur integrasi: schema.json → sandbox → semua models AI →
 * jailbreak scanner → system prompt → model.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ZANCO_PERSONA } from './persona.js'
import bundledSchema from '../schema.json'

/* ===== Nama default (dipakai saat schema berisi placeholder) ===== */
const DEFAULT_ASSISTANT_NAME = 'Zanco-Ai'
const DEFAULT_WEBSITE_NAME = 'Zanco-Ai'
const PLACEHOLDER_NAME = /ganti|replace|change|isi dengan/i

/* ===== Load schema.json: baca dari disk dulu, fallback ke bundel ===== */
function loadSchema() {
  // Baca dari disk (agar edit schema.json langsung terbaca saat dev/next start),
  // fallback ke bundel webpack (dijamin ada di Vercel/serverless).
  try {
    const diskPath = path.join(process.cwd(), 'schema.json')
    if (fs.existsSync(diskPath)) {
      return JSON.parse(fs.readFileSync(diskPath, 'utf8'))
    }
  } catch (e) {
    // abaikan, lanjut ke fallback
  }
  return bundledSchema
}

const SCHEMA = loadSchema()

/* ===== Util render ===== */
function resolveAssistantName(name) {
  if (!name || PLACEHOLDER_NAME.test(String(name))) return DEFAULT_ASSISTANT_NAME
  return String(name).trim()
}

function resolveWebsiteName() {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL
  return fromEnv ? String(fromEnv).replace(/^https?:\/\//, '') : DEFAULT_WEBSITE_NAME
}

function bullet(items) {
  if (!Array.isArray(items) || items.length === 0) return '- (tidak ada)'
  return items.map(i => `- ${String(i)}`).join('\n')
}

function numbered(items) {
  if (!Array.isArray(items) || items.length === 0) return '1. (tidak ada)'
  return items.map((i, idx) => `${idx + 1}. ${String(i)}`).join('\n')
}

/* ===== Render system_prompt_template dengan nilai field lain ===== */
function renderTemplate(schema) {
  if (!schema || typeof schema.system_prompt_template !== 'string') return ''
  const identity = schema.assistant_identity || {}
  const style = schema.conversation_style || {}
  const values = {
    assistant_name: resolveAssistantName(identity.name),
    website_name: resolveWebsiteName(),
    tone: style.tone || 'warm_professional',
  }
  return schema.system_prompt_template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return values[key] !== undefined ? values[key] : `{{${key}}}`
  })
}

/* ===== Gabungkan seluruh field schema jadi satu teks instruksi ===== */
export function buildSchemaPrompt() {
  if (!SCHEMA) return ''
  const identity = SCHEMA.assistant_identity || {}
  const style = SCHEMA.conversation_style || {}
  const formatting = SCHEMA.response_formatting || {}
  const code = SCHEMA.code_generation || {}
  const multiTurn = SCHEMA.multi_turn_behavior || {}
  const safety = SCHEMA.safety_and_boundaries || {}
  const assistantName = resolveAssistantName(identity.name)

  const parts = []
  parts.push(`=====================================================`)
  parts.push(`SISTEM ATURAN AI — ${SCHEMA.$schema_name || 'ai-chat-assistant-behavior-schema'} v${SCHEMA.version || '1.0.0'}`)
  parts.push(`=====================================================`)
  if (SCHEMA.description) parts.push(`\n${SCHEMA.description}`)

  if (renderTemplate(SCHEMA)) {
    parts.push(`\n## INTI PERILAKU\n${renderTemplate(SCHEMA)}`)
  }

  parts.push(`\n## IDENTITAS ASSISTANT`)
  parts.push(`- Nama: ${assistantName}`)
  parts.push(`- Peran: ${identity.role || 'AI assistant untuk website chat'}`)
  parts.push(`- Model backend: ${identity.model || 'groq (openai/gpt-oss-120b)'}`)
  parts.push(`- Sifat:\n${bullet(identity.personality_traits)}`)

  parts.push(`\n## GAYA BICARA`)
  parts.push(`- Nada: ${style.tone || 'warm_professional'}`)
  parts.push(`- Kebijakan bahasa: ${style.language_policy || 'balas dalam bahasa yang dipakai user'}`)
  if (style.rules?.length) parts.push(`- Aturan:\n${numbered(style.rules)}`)
  if (style.things_to_avoid?.length) parts.push(`- Hindari:\n${bullet(style.things_to_avoid)}`)

  parts.push(`\n## FORMAT RESPONS`)
  parts.push(`- Format default: ${formatting.default_format || 'plain_conversational_text'}`)
  if (formatting.use_structured_format_when?.length) {
    parts.push(`- Gunakan format terstruktur saat: ${formatting.use_structured_format_when.join(', ')}`)
  }
  if (formatting.paragraph_guideline) parts.push(`- Panduan paragraf: ${formatting.paragraph_guideline}`)
  if (formatting.code_blocks) {
    parts.push(`- Blok kode:`)
    if (formatting.code_blocks.always_specify_language) {
      parts.push(`  - Selalu cantumkan bahasa di code block (${formatting.code_blocks.example || '```python\\n...\\n```'})`)
    }
  }

  parts.push(`\n## ATURAN MEMBUAT KODE`)
  if (code.trigger_when?.length) parts.push(`- Picu saat:\n${bullet(code.trigger_when)}`)
  if (code.before_code?.length) parts.push(`- Sebelum menulis kode:\n${bullet(code.before_code)}`)
  if (code.writing_rules?.length) parts.push(`- Aturan penulisan:\n${bullet(code.writing_rules)}`)
  if (code.after_code?.length) parts.push(`- Setelah kode:\n${bullet(code.after_code)}`)
  if (code.refuse_when?.length) parts.push(`- Tolak saat:\n${bullet(code.refuse_when)}`)

  parts.push(`\n## PERILAKU MULTI-TURN`)
  if (multiTurn.context_handling) parts.push(`- Penanganan konteks: ${multiTurn.context_handling}`)
  if (multiTurn.clarifying_questions) {
    parts.push(`- Pertanyaan klarifikasi: maksimal ${multiTurn.clarifying_questions.max_per_turn || 1} per giliran`)
    if (multiTurn.clarifying_questions.ask_when) parts.push(`  - Tanya saat: ${multiTurn.clarifying_questions.ask_when}`)
    if (multiTurn.clarifying_questions.skip_when) parts.push(`  - Lewati saat: ${multiTurn.clarifying_questions.skip_when}`)
  }
  if (multiTurn.session_memory) parts.push(`- Memori sesi: ${multiTurn.session_memory}`)

  parts.push(`\n## BATASAN & KEAMANAN`)
  if (safety.refuse_topics?.length) parts.push(`- Tolak topik:\n${bullet(safety.refuse_topics)}`)
  if (safety.refusal_style) parts.push(`- Gaya penolakan: ${safety.refusal_style}`)

  return parts.join('\n')
}

/* ===== System prompt final: aturan schema + persona detail ===== */
export const SCHEMA_SYSTEM_PROMPT = buildSchemaPrompt()
export const BASE_SYSTEM_PROMPT = [SCHEMA_SYSTEM_PROMPT, ZANCO_PERSONA].filter(Boolean).join('\n\n')
