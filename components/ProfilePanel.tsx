'use client'

import { useRef, useState } from 'react'
import { DEFAULT_PROFILE, makeAvatarDataUrl, type Profile } from '../lib/profile'
import { guestLogin, sanitizeGuestName, type GuestSession } from '../lib/auth-sandbox'

type ProfilePanelProps = {
  profile: Profile
  session: GuestSession | null
  onProfileChange: (next: Profile) => void
  onSessionChange: (next: GuestSession | null) => void
  onClose: () => void
  onToast: (msg: string) => void
}

export default function ProfilePanel({ profile, session, onProfileChange, onSessionChange, onClose, onToast }: ProfilePanelProps) {
  const avatarRef = useRef<HTMLInputElement | null>(null)
  const [view, setView] = useState<'profile' | 'login'>('profile')
  const [guestName, setGuestName] = useState('')

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { onToast('Pilih file gambar'); return }
    const dataUrl = await makeAvatarDataUrl(file)
    if (!dataUrl) { onToast('Gagal memuat gambar'); return }
    onProfileChange({ ...profile, avatar: dataUrl })
    onToast('Foto profil diperbarui')
  }

  const handleNameBlur = () => {
    const next = profile.name.trim() || DEFAULT_PROFILE.name
    if (next !== profile.name) onProfileChange({ ...profile, name: next })
  }

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
      onToast('Username disimpan')
    }
  }

  const handleGuestLogin = () => {
    const { session: next, rateLimited } = guestLogin(guestName)
    if (rateLimited) {
      onToast('Terlalu banyak percobaan, tunggu 1 menit')
      return
    }
    if (!next) return
    onSessionChange(next)
    onProfileChange({ ...profile, name: next.name })
    setGuestName('')
    setView('profile')
    onToast(`Berhasil masuk — ID unik: ${next.guestId.slice(0, 8)}…`)
  }

  const handleLogout = () => {
    onSessionChange(null)
    onToast('Berhasil keluar')
  }

  const copyUniqueId = async () => {
    if (!session) return
    const text = session.guestId
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    onToast('ID unik disalin')
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings profile" role="dialog" aria-modal="true" aria-label="Profil" onClick={e => e.stopPropagation()}>
        <div className="settings-hd">
          {view === 'login' ? (
            <button className="profile-back" onClick={() => setView('profile')} aria-label="Kembali ke profil">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
            </button>
          ) : <span />}
          <h3>{view === 'login' ? 'Masuk' : 'Profil'}</h3>
          <button className="settings-close" onClick={onClose} aria-label="Tutup profil">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {view === 'login' ? (
          <div className="login-menu">
            <div className="login-status">
              <span className={`login-dot ${session ? 'on' : ''}`} />
              {session ? 'Sudah masuk sebagai tamu' : 'Belum masuk'}
            </div>

            <label className="login-label" htmlFor="guest-name">Nama tamu (opsional)</label>
            <input
              id="guest-name"
              className="profile-input"
              value={guestName}
              maxLength={24}
              placeholder="cth: Tamu 2026"
              spellCheck={false}
              onChange={e => setGuestName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { handleGuestLogin() }
              }}
            />

            <button type="button" className="profile-btn-login" onClick={handleGuestLogin}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6" /><path d="M22 11h-6" /></svg>
              Masuk sebagai Tamu
            </button>

            {session && (
              <div className="profile-session">
                <div className="profile-session-tt">Sesi aktif</div>
                <div className="profile-session-row">
                  <span className="login-dot on" />
                  <span>Tamu — {session.name}</span>
                </div>
                <div className="profile-id-row">
                  <span className="profile-id" title={session.guestId}>{session.guestId}</span>
                  <button type="button" className="profile-id-copy" onClick={copyUniqueId} title="Salin ID unik">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                  </button>
                </div>
                <button type="button" className="profile-btn-ghost" onClick={handleLogout}>Keluar / Logout</button>
              </div>
            )}

            <div className="login-hint">
              Masuk tamu aman & tersimpan lokal — data login disimpan melalui Auth Sandbox ke penyimpanan browser (localStorage). Setiap pengguna mendapat ID unik yang berbeda-beda.
            </div>
          </div>
        ) : (
          <>
            <div className="profile-avatar-wrap">
              <button type="button" className="profile-avatar" onClick={() => avatarRef.current?.click()} title="Ganti foto dari galeri">
                {profile.avatar
                  ? <img src={profile.avatar} alt="Foto profil" />
                  : <span>{(profile.name || DEFAULT_PROFILE.name).charAt(0).toUpperCase()}</span>}
                <span className="profile-avatar-edit">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
                </span>
              </button>
              <div className="profile-avatar-hint">Ketuk foto untuk memilih dari galeri</div>
              <input ref={avatarRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
            </div>

            <button type="button" className="profile-btn-login" onClick={() => setView('login')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></svg>
              {session ? `Masuk sebagai ${sanitizeGuestName(session.name)}` : 'Masuk / Login'}
            </button>

            {session && (
              <div className="profile-session">
                <div className="profile-session-tt">Status login</div>
                <div className="profile-session-row">
                  <span className="login-dot on" />
                  <span>Tamu — {session.name}</span>
                </div>
                <div className="profile-id-row">
                  <span className="profile-id" title={session.guestId}>{session.guestId}</span>
                  <button type="button" className="profile-id-copy" onClick={copyUniqueId} title="Salin ID unik">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                  </button>
                </div>
                <button type="button" className="profile-btn-ghost" onClick={handleLogout}>Keluar / Logout</button>
              </div>
            )}

            <div className="profile-field">
              <label htmlFor="profile-name">Username</label>
              <input
                id="profile-name"
                className="profile-input"
                value={profile.name}
                maxLength={24}
                spellCheck={false}
                onChange={e => onProfileChange({ ...profile, name: e.target.value })}
                onBlur={handleNameBlur}
                onKeyDown={handleNameKeyDown}
              />
              <div className="profile-field-hint">Boleh diganti sesuka hati</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
