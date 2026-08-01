// Package engine — mesin utama chatbot (padanan Go dari lib/engine/engine.ts).
// Berisi: registri model Groq, pembangun request, normalisasi teks,
// scan heuristic jailbreak, dan rate limiter 150 req/menit.
package engine

import (
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
)

// ===== Model =====
type ModelKind string

const (
	KindChat     ModelKind = "chat"
	KindThinking ModelKind = "thinking"
	KindResearch ModelKind = "research"
	KindCreative ModelKind = "creative"
)

// ModelSpec adalah konfigurasi satu model Groq (max token default 160).
type ModelSpec struct {
	EnvKey    string
	Model     string
	MaxTokens int
	Name      string
}

var Models = map[ModelKind]ModelSpec{
	KindChat:     {EnvKey: "GROQ_API_KEY", Model: "llama-3.1-8b-instant", MaxTokens: 160, Name: "Chat"},
	KindThinking: {EnvKey: "GROQ_API_KEY_2", Model: "llama-3.1-8b-instant", MaxTokens: 160, Name: "Thinking"},
	KindResearch: {EnvKey: "GROQ_API_KEY_3", Model: "llama-3.1-8b-instant", MaxTokens: 160, Name: "Research"},
	KindCreative: {EnvKey: "GROQ_API_KEY_4", Model: "llama-3.1-8b-instant", MaxTokens: 160, Name: "Creative"},
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
	all = append(all, ChatMessage{Role: "system", Content: systemPrompt})
	all = append(all, messages...)
	return GroqRequest{
		Model:       spec.Model,
		Messages:    all,
		Temperature: temperature,
		MaxTokens:   spec.MaxTokens,
	}
}

// ===== Normalisasi teks (anti-obfuscation) =====
var zeroWidth = []rune{'\u200b', '\u200c', '\u200d', '\ufeff', '\u2060'}

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
	for _, r := range s {
		if isZeroWidth(r) {
			continue
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return strings.TrimSpace(b.String())
}

// ===== Verdict =====
type Verdict string

const (
	VerdictAllow Verdict = "allow"
	VerdictFlag  Verdict = "flag"
	VerdictBlock Verdict = "block"
)

const (
	blockThreshold = 0.6
	flagThreshold  = 0.3
)

// ScanResult adalah hasil scan heuristic.
type ScanResult struct {
	Score   float64
	Reasons []string
	Verdict Verdict
}

type pattern struct {
	re    *regexp.Regexp
	score float64
	label string
}

// polaHeuristic: daftar taktik jailbreak lintas bahasa (EN + ID + lainnya).
var polaHeuristic = []pattern{
	{regexp.MustCompile(`\bignore (all|any|the)? ?(previous|prior|above)? ?(instructions?|rules?|guidelines?)\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\bdisregard (your|the|all)? ?(rules?|guidelines?|instructions?)\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\bforget (everything|all)( you (were|have been) told)?\b`), 0.5, "instruction_override"},
	{regexp.MustCompile(`\babaikan (semua |seluruh )?(instruksi|aturan|perintah)( sebelumnya)?\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\bact as (if )?.*(no|without) (restrictions?|filters?|guidelines?|limits?)\b`), 0.6, "persona_hijack"},
	{regexp.MustCompile(`\byou are now (dan|stan|aim|jailbroken?)\b`), 0.7, "persona_hijack"},
	{regexp.MustCompile(`\b(developer|debug|admin|god|unrestricted|unfiltered) mode\b`), 0.5, "persona_hijack"},
	{regexp.MustCompile(`\bpretend (you are|to be) an ai (with(out)?|that has)( no| any)? (rules?|restrictions?|filters?)\b`), 0.6, "persona_hijack"},
	{regexp.MustCompile(`\bpura.pura (jadi|menjadi) ai\b`), 0.5, "persona_hijack"},
	{regexp.MustCompile(`\b(jadilah|berperanlah sebagai) (dan|ai tanpa aturan)\b`), 0.5, "persona_hijack"},
	{regexp.MustCompile(`\bignore (toutes )?(les )?(instructions|règles|directives)( précédentes)?\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\bignoriere (alle )?(früheren )?(anweisungen|regeln|richtlinien)\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\bignora (todas )?(las )?(instrucciones|reglas|directrices)( anteriores)?\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\bignore (todas )?(as )?(instruções|regras|diretrizes)( anteriores)?\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\b(игнорируй|игнорировать) (все )?(предыдущие )?(инструкции|правила|указания)\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\b(تجاهل|تجاهلي) (جميع )?(التعليمات|القواعد|الإرشادات)( السابقة)?\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`\b(निर्देश|नियम|आदेश) (अनदेखा कर|भूल जाओ|छोड़ दो|मानो मत)\b`), 0.6, "instruction_override"},
	{regexp.MustCompile(`忽略(所有)?(之前的)?(指令|规则|提示|指示)`), 0.6, "instruction_override"},
	{regexp.MustCompile(`(過去の)?(指示|ルール|命令)を無視`), 0.6, "instruction_override"},
	{regexp.MustCompile(`(이전 )?(지침|규칙|명령)을? 무시`), 0.6, "instruction_override"},
	{regexp.MustCompile(`bỏ qua (tất cả )?(các )?(chỉ dẫn|hướng dẫn|quy tắc)( trước đó)?`), 0.6, "instruction_override"},
}

// HeuristicScan memindai teks untuk pola jailbreak; skor 0..1.
func HeuristicScan(text string) ScanResult {
	normalized := NormalizeText(text)
	var total float64
	var reasons []string

	for _, p := range polaHeuristic {
		if p.re.MatchString(normalized) {
			total += p.score
			reasons = append(reasons, p.label)
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

	if len(r.store) > 1000 {
		for k, v := range r.store {
			if now.After(v.resetAt) {
				delete(r.store, k)
			}
		}
	}

	return rec.count <= r.max, remaining, rec.resetAt
}

// ToJSON adalah utilitas kecil untuk serialisasi payload.
func ToJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}
