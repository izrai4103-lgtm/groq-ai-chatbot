package com.groqchatbot.archive

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * ArchiveManager — versi Kotlin dari fitur Arsip di chatbot.
 * Fungsi: simpan riwayat chat, arsipkan, pulihkan, dan hapus.
 * Penyimpanan memakai SharedPreferences (setara localStorage di browser/JS).
 */
data class ChatEntry(
    val id: String,
    val title: String,
    val archived: Boolean,
    val updatedAt: Long,
    val messages: List<String>
)

class ArchiveManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_KEY, Context.MODE_PRIVATE)

    /* ===== JS: loadStore() — baca semua chat + status arsip ===== */
    fun load(): List<ChatEntry> {
        val raw = prefs.getString(KEY_CHATS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val obj = arr.getJSONObject(i)
                    add(
                        ChatEntry(
                            id = obj.getString("id"),
                            title = obj.optString("title", "Groq AI Chatbot"),
                            archived = obj.optBoolean("archived", false),
                            updatedAt = obj.optLong("updatedAt", 0L),
                            messages = obj.optJSONArray("messages").toList()
                        )
                    )
                }
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /* ===== JS: saveStore() — tulis seluruh daftar chat ===== */
    fun save(chats: List<ChatEntry>) {
        val arr = JSONArray()
        chats.forEach { c ->
            arr.put(
                JSONObject().apply {
                    put("id", c.id)
                    put("title", c.title)
                    put("archived", c.archived)
                    put("updatedAt", c.updatedAt)
                    put("messages", JSONArray(c.messages))
                }
            )
        }
        prefs.edit().putString(KEY_CHATS, arr.toString()).apply()
    }

    /* ===== JS: archiveChat(id) ===== */
    fun archive(id: String): List<ChatEntry> =
        update(id) { copy(archived = true, updatedAt = System.currentTimeMillis()) }

    /* ===== JS: unarchiveChat(id) ===== */
    fun unarchive(id: String): List<ChatEntry> =
        update(id) { copy(archived = false, updatedAt = System.currentTimeMillis()) }

    /* ===== JS: deleteChat(id) ===== */
    fun delete(id: String): List<ChatEntry> {
        val remaining = load().filterNot { it.id == id }
        save(remaining)
        return remaining
    }

    /* ===== JS: activeChats — hanya chat yang belum diarsipkan ===== */
    fun activeChats(chats: List<ChatEntry>): List<ChatEntry> =
        chats.filter { !it.archived }.sortedByDescending { it.updatedAt }

    /* ===== JS: archivedChats — chat yang sudah diarsipkan ===== */
    fun archivedChats(chats: List<ChatEntry>): List<ChatEntry> =
        chats.filter { it.archived }.sortedByDescending { it.updatedAt }

    /* ===== JS: badges — jumlah arsip untuk badge sidebar ===== */
    fun archiveCount(chats: List<ChatEntry>): Int = archivedChats(chats).size

    /* ===== Helper internal ===== */
    private fun update(id: String, transform: (ChatEntry) -> ChatEntry): List<ChatEntry> {
        val updated = load().map { if (it.id == id) transform(it) else it }
        save(updated)
        return updated
    }

    private fun JSONArray?.toList(): List<String> {
        if (this == null) return emptyList()
        return buildList { for (i in 0 until length()) add(getString(i)) }
    }

    companion object {
        private const val PREFS_KEY = "groq_chats_v1"
        private const val KEY_CHATS = "chats"

        /* ===== JS: truncate() — potong judul panjang ===== */
        fun truncate(title: String, max: Int = 34): String =
            if (title.length > max) title.take(max - 1) + "…" else title
    }
}
