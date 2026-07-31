//! MessageActions — padanan Rust dari tombol aksi pesan di `app/page.js`.
//! Fungsi: like/dislike (rating), copy, dan regenerate (buat ulang jawaban).
//! Logika murni tanpa UI, bisa dipakai dari backend/CLI.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMsg {
    pub id: String,
    pub role: String,
    pub content: String,
    pub streaming: bool,
}

impl ChatMsg {
    pub fn new(id: &str, role: &str, content: &str) -> Self {
        Self {
            id: id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            streaming: false,
        }
    }
}

/// JS: `rate(msg, val)` — toggle rating: up <-> down <-> None.
pub fn toggle_rating(current: Option<&str>, selected: &str) -> Option<String> {
    if current == Some(selected) { None } else { Some(selected.to_string()) }
}

/// JS: `regenerate(msg)` — potong pesan mulai dari jawaban yang di-regenerate.
pub fn regenerate(messages: &[ChatMsg], target_id: &str) -> Vec<ChatMsg> {
    let idx = messages.iter().position(|m| m.id == target_id);
    match idx {
        Some(i) if i > 0 => messages[..i].to_vec(),
        _ => messages.to_vec(),
    }
}

/// JS: cari pesan user terakhir sebelum jawaban yang di-regenerate.
pub fn prev_user_content(messages: &[ChatMsg]) -> Option<&str> {
    messages.iter().rev().find(|m| m.role == "user").map(|m| m.content.as_str())
}

/// JS: label tombol copy saat status berubah.
pub fn copy_label(copied: bool) -> &'static str {
    if copied { "Disalin!" } else { "Salin" }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<ChatMsg> {
        vec![
            ChatMsg::new("u1", "user", "Halo AI"),
            ChatMsg::new("a1", "assistant", "Halo! Ada yang bisa dibantu?"),
            ChatMsg::new("u2", "user", "Jelaskan blockchain"),
            ChatMsg::new("a2", "assistant", "Blockchain adalah buku besar digital..."),
        ]
    }

    #[test]
    fn rating_toggle() {
        assert_eq!(toggle_rating(None, "up"), Some("up".to_string()));
        assert_eq!(toggle_rating(Some("up"), "up"), None);
        assert_eq!(toggle_rating(Some("up"), "down"), Some("down".to_string()));
        assert_eq!(toggle_rating(Some("down"), "down"), None);
    }

    #[test]
    fn regenerate_cuts_after_target() {
        let msgs = fixture();
        let out = regenerate(&msgs, "a2");
        assert_eq!(out.len(), 3);
        assert_eq!(out[2].id, "u2");
        assert_eq!(prev_user_content(&out), Some("Jelaskan blockchain"));
    }

    #[test]
    fn regenerate_keeps_all_when_not_found_or_first() {
        let msgs = fixture();
        assert_eq!(regenerate(&msgs, "tidak-ada"), msgs);
        assert_eq!(regenerate(&msgs, "u1"), msgs);
    }

    #[test]
    fn copy_label_changes() {
        assert_eq!(copy_label(false), "Salin");
        assert_eq!(copy_label(true), "Disalin!");
    }
}
