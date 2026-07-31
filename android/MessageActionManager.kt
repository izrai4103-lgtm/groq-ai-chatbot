package com.groqchatbot.message

/**
 * MessageActionManager — versi Kotlin dari tombol aksi pesan di chatbot (JS: app/page.js).
 * Fungsi: like/dislike (rating), copy, dan regenerate (buat ulang jawaban).
 * Murni logika tanpa UI, supaya bisa dipakai ulang dari Activity/Compose.
 */
data class ChatMsg(
    val id: String,
    val role: String,
    val content: String,
    val streaming: Boolean = false
)

object MessageActionManager {

    /** JS: rate(msg, val) — toggle rating: up <-> down <-> null */
    fun toggleRating(current: String?, selected: String): String? =
        if (current == selected) null else selected

    /** JS: regenerate(msg) — potong pesan mulai dari jawaban yang di-regenerate */
    fun regenerate(messages: List<ChatMsg>, targetId: String): List<ChatMsg> {
        val idx = messages.indexOfFirst { it.id == targetId }
        if (idx <= 0) return messages
        return messages.subList(0, idx)
    }

    /** JS: cari pesan user terakhir sebelum jawaban yang di-regenerate */
    fun prevUserContent(messages: List<ChatMsg>): String? =
        messages.asReversed().firstOrNull { it.role == "user" }?.content

    /** JS: label tombol copy saat status berubah */
    fun copyLabel(copied: Boolean): String = if (copied) "Disalin!" else "Salin"
}
