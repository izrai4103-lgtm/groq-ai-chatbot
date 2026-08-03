// Package engine — mesin utama chatbot (padanan Go dari lib/engine/engine.ts + sandbox).
// Fitur: registri model Groq, pembangun request, sanitasi input, content filter,
// normalisasi anti-obfuscation, scan heuristic jailbreak lintas bahasa,
// dan rate limiter 150 req/menit per IP.
package engine

import (
	"encoding/json"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

// ===== Konstanta =====
const (
	MaxInputLength = 8000
	MaxMessages    = 20
	DefaultMaxTokens = 2048
	DefaultRateLimit = 150
	DefaultRateWindow = time.Minute
)

// ===== Model =====
type ModelKind string

const (
	KindChat     ModelKind = "chat"
	KindThinking ModelKind = "thinking"
	KindResearch ModelKind = "research"
	KindCreative ModelKind = "creative"
	KindUpload   ModelKind = "upload"
)

// ModelSpec adalah konfigurasi satu model Groq (max token default 2048, selaras production TS).
type ModelSpec struct {
	EnvKey    string
	Model     string
	MaxTokens int
	Name      string
}

var Models = map[ModelKind]ModelSpec{
	KindChat:     {EnvKey: "GROQ_API_KEY", Model: "openai/gpt-oss-120b", MaxTokens: DefaultMaxTokens, Name: "Chat"},
	KindThinking: {EnvKey: "GROQ_API_KEY_2", Model: "openai/gpt-oss-120b", MaxTokens: DefaultMaxTokens, Name: "Thinking"},
	KindResearch: {EnvKey: "GROQ_API_KEY_3", Model: "openai/gpt-oss-120b", MaxTokens: DefaultMaxTokens, Name: "Research"},
	KindCreative: {EnvKey: "GROQ_API_KEY_4", Model: "openai/gpt-oss-120b", MaxTokens: DefaultMaxTokens, Name: "Creative"},
	KindUpload:   {EnvKey: "GROQ_API_KEY_5", Model: "openai/gpt-oss-120b", MaxTokens: DefaultMaxTokens, Name: "Upload"},
}

// ChatMessage adalah satu pesan dalam percakapan.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// GroqRequest adalah payload request ke api.groq.com.
type GroqRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
}

// BuildGroqRequest menyusun payload request sesuai spec model.
func BuildGroqRequest(spec ModelSpec, systemPrompt string, messages []ChatMessage, temperature float64) GroqRequest {
	all := make([]ChatMessage, 0, len(messages)+1)
	if systemPrompt != "" {
		all = append(all, ChatMessage{Role: "system", Content: systemPrompt})
	}
	all = append(all, messages...)
	maxTok := spec.MaxTokens
	if maxTok <= 0 {
		maxTok = DefaultMaxTokens
	}
	return GroqRequest{
		Model:       spec.Model,
		Messages:    all,
		Temperature: temperature,
		MaxTokens:   maxTok,
	}
}

// ===== Sanitasi input =====

// SanitizeInput membuang karakter kontrol berbahaya dan membatasi panjang.
func SanitizeInput(text string) string {
	if text == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(text))
	for _, r := range text {
		// Izinkan newline (\n), tab (\t), carriage return (\r)
		if r == '\n' || r == '\t' || r == '\r' {
			b.WriteRune(r)
			continue
		}
		if r < 0x20 || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	out := strings.TrimSpace(b.String())
	if len(out) > MaxInputLength {
		out = out[:MaxInputLength]
	}
	return out
}

// ValidationResult hasil validasi pesan.
type ValidationResult struct {
	Valid bool
	Error string
}

// ValidateMessages memeriksa struktur, role, dan panjang pesan.
func ValidateMessages(messages []ChatMessage) ValidationResult {
	if messages == nil {
		return ValidationResult{Valid: false, Error: "Messages harus berupa array"}
	}
	if len(messages) == 0 {
		return ValidationResult{Valid: false, Error: "Messages tidak boleh kosong"}
	}
	if len(messages) > MaxMessages {
		return ValidationResult{Valid: false, Error: "Maksimal 20 pesan"}
	}
	for _, msg := range messages {
		switch msg.Role {
		case "user", "assistant", "system":
		default:
			return ValidationResult{Valid: false, Error: "Role \"" + msg.Role + "\" tidak dikenal"}
		}
		if len(msg.Content) > MaxInputLength {
			return ValidationResult{Valid: false, Error: "Pesan terlalu panjang (max 8000 karakter)"}
		}
	}
	return ValidationResult{Valid: true}
}

// ===== Content filter =====
var blockedPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)https?://[^\s]*\.(exe|dll|bat|cmd|msi|sh|scr|pif|vbs|ps1)(\?|\s|$)`),
}

// FilterContent mendeteksi tautan executable berbahaya.
func FilterContent(text string) (blocked bool, reason string) {
	for _, p := range blockedPatterns {
		if p.MatchString(text) {
			return true, "Konten mencurigakan terdeteksi"
		}
	}
	return false, ""
}

// ===== Normalisasi teks (anti-obfuscation) =====
var zeroWidth = []rune{'\u200b', '\u200c', '\u200d', '\ufeff', '\u2060', '\u180e', '\u00ad'}

func isZeroWidth(r rune) bool {
	for _, z := range zeroWidth {
		if r == z {
			return true
		}
	}
	return false
}

// NormalizeText membuang karakter tak terlihat lalu menurunkan huruf.
func NormalizeText(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if isZeroWidth(r) {
			continue
		}
		if unicode.IsSpace(r) {
			b.WriteRune(' ')
			continue
		}
		b.WriteRune(unicode.ToLower(r))
	}
	// Runtuhkan spasi beruntun
	return strings.Join(strings.Fields(b.String()), " ")
}

// ===== Heuristic jailbreak scan =====
type Verdict string

const (
	VerdictAllow Verdict = "allow"
	VerdictFlag  Verdict = "flag"
	VerdictBlock Verdict = "block"
)

const (
	flagThreshold  = 0.35
	blockThreshold = 0.55
)

type polaItem struct {
	re    *regexp.Regexp
	score float64
	label string
}

// polaHeuristic — pola multi-bahasa (EN/ID/ES/FR/DE/RU/AR/HI/ZH/JA/KO/VI)
var polaHeuristic = []polaItem{
	{regexp.MustCompile(`\b(ignore|disregard|forget|override) (all )?(previous |prior |above )?(instructions?|rules?|prompts?|guidelines?)\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\b(act as|pretend (to be|you are)|roleplay as|you are now) (dan|jailbreak|unrestricted|uncensored|without (any )?restrictions?)\b`), 0.55, "roleplay_jailbreak"},
	{regexp.MustCompile(`\b(jailbreak|dan mode|developer mode|god mode|sudo mode)\b`), 0.5, "jailbreak_mode"},
	{regexp.MustCompile(`\b(no restrictions?|without (any )?limits?|without (any )?restrictions?|bypass (your |the )?(filter|safety|policy|rules?))\b`), 0.55, "bypass_safety"},
	{regexp.MustCompile(`\b(do anything now|dan\b.*jailbreak|jailbroken)\b`), 0.55, "dan_mode"},
	{regexp.MustCompile(`\b(system prompt|reveal (your |the )?(system|hidden|secret) (prompt|instructions?))\b`), 0.4, "prompt_leak"},
	{regexp.MustCompile(`\b(abaikan|lupakan|lewati|abaikan saja) (semua )?(instruksi|aturan|prompt|pedoman)( (sebelumnya|di atas))?\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\b(mode bebas|tanpa batasan|tanpa filter|jailbreak)\b`), 0.5, "jailbreak_mode"},
	{regexp.MustCompile(`\b(ignora|olvida|omite) (todas? )?(las )?(instrucciones|reglas|indicaciones)( anteriores)?\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\b(ignore|oublie|contourne) (toutes? )?(les )?(instructions|règles|consignes)( précédentes)?\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\b(ignoriere|vergiss|umgehe) (alle )?(vorherigen )?(anweisungen|regeln|vorgaben)\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\b(игнорируй|игнорировать) (все )?(предыдущие )?(инструкции|правила|указания)\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\b(تجاهل|تجاهلي) (جميع )?(التعليمات|القواعد|الإرشادات)( السابقة)?\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\b(निर्देश|नियम|आदेश) (अनदेखा कर|भूल जाओ|छोड़ दो|मानो मत)\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`忽略(所有)?(之前的)?(指令|规则|提示|指示)`), 0.6, "instruction_override"},
	{regexp.MustCompile(`(過去の)?(指示|ルール|命令)を無視`), 0.6, "instruction_override"},
	{regexp.MustCompile(`(이전 )?(지침|규칙|명령)을? 무시`), 0.6, "instruction_override"},
	{regexp.MustCompile(`bỏ qua (tất cả )?(các )?(chỉ dẫn|hướng dẫn|quy tắc)( trước đó)?`), 0.6, "instruction_override"},
}

// ScanResult hasil scan heuristic.
type ScanResult struct {
	Score   float64  `json:"score"`
	Reasons []string `json:"reasons"`
	Verdict Verdict  `json:"verdict"`
}

// HeuristicScan memindai teks untuk pola jailbreak; skor 0..1.
func HeuristicScan(text string) ScanResult {
	normalized := NormalizeText(text)
	var total float64
	var reasons []string
	seen := map[string]bool{}

	for _, p := range polaHeuristic {
		if p.re.MatchString(normalized) {
			total += p.score
			if !seen[p.label] {
				reasons = append(reasons, p.label)
				seen[p.label] = true
			}
		}
	}
	if total > 1 {
		total = 1
	}

	verdict := VerdictAllow
	switch {
	case total >= blockThreshold:
		verdict = VerdictBlock
	case total >= flagThreshold:
		verdict = VerdictFlag
	}

	return ScanResult{Score: total, Reasons: reasons, Verdict: verdict}
}

// ===== Pipeline sandbox ringkas =====

// SandboxResult hasil pipeline validasi+sanitasi+filter+scan.
type SandboxResult struct {
	OK       bool
	Messages []ChatMessage
	Error    string
	Code     string
	Scan     *ScanResult
}

// RunSandboxPipeline menjalankan validasi → sanitasi → content filter → jailbreak scan
// pada pesan masuk (padanan jalur utama lib/sandbox.js / runChat di engine.ts).
func RunSandboxPipeline(messages []ChatMessage) SandboxResult {
	v := ValidateMessages(messages)
	if !v.Valid {
		return SandboxResult{OK: false, Code: "INVALID_INPUT", Error: v.Error}
	}

	sanitized := make([]ChatMessage, 0, len(messages))
	for _, m := range messages {
		c := SanitizeInput(m.Content)
		if c == "" {
			continue
		}
		sanitized = append(sanitized, ChatMessage{Role: m.Role, Content: c})
	}
	if len(sanitized) == 0 {
		return SandboxResult{OK: false, Code: "EMPTY_AFTER_SANITIZE", Error: "Pesan kosong setelah filter"}
	}

	for _, m := range sanitized {
		if blocked, reason := FilterContent(m.Content); blocked {
			return SandboxResult{OK: false, Code: "CONTENT_BLOCKED", Error: reason}
		}
	}

	// Scan pesan user terakhir
	for i := len(sanitized) - 1; i >= 0; i-- {
		if sanitized[i].Role == "user" {
			scan := HeuristicScan(sanitized[i].Content)
			if scan.Verdict == VerdictBlock {
				return SandboxResult{
					OK: false, Code: "JAILBREAK_BLOCKED",
					Error: "Permintaan diblokir oleh filter keamanan",
					Scan:  &scan, Messages: sanitized,
				}
			}
			return SandboxResult{OK: true, Messages: sanitized, Scan: &scan}
		}
	}

	return SandboxResult{OK: true, Messages: sanitized}
}

// ===== Rate limiter (150 req/menit) =====
type record struct {
	count   int
	resetAt time.Time
}

// RateLimiter adalah sliding-window limiter per key (IP).
type RateLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	store  map[string]*record
}

// NewRateLimiter membuat limiter baru (default: 150 req / 1 menit).
func NewRateLimiter(max int, window time.Duration) *RateLimiter {
	if max <= 0 {
		max = DefaultRateLimit
	}
	if window <= 0 {
		window = DefaultRateWindow
	}
	return &RateLimiter{max: max, window: window, store: make(map[string]*record)}
}

// Allow mencatat 1 request dan mengembalikan keputusan + sisa kuota.
func (r *RateLimiter) Allow(key string) (allowed bool, remaining int, resetAt time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	rec, ok := r.store[key]
	if !ok || now.After(rec.resetAt) {
		rec = &record{count: 0, resetAt: now.Add(r.window)}
		r.store[key] = rec
	}

	rec.count++
	remaining = r.max - rec.count
	if remaining < 0 {
		remaining = 0
	}

	// Bersihkan entri kedaluwarsa agar memori stabil
	if len(r.store) > 1000 {
		for k, v := range r.store {
			if now.After(v.resetAt) {
				delete(r.store, k)
			}
		}
	}

	return rec.count <= r.max, remaining, rec.resetAt
}

// Size mengembalikan jumlah key aktif di store (untuk monitoring).
func (r *RateLimiter) Size() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.store)
}

// ToJSON adalah utilitas serialisasi payload.
func ToJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}
