'use client'

import { useEffect, useRef, useState } from 'react'
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

/** Format NIK: 1234.5678.9012.3456 */
function fmtNik(s: string) {
  const digits = (s || '').replace(/\D/g, '').slice(0, 16)
  return digits.replace(/(\d{4})(?=\d)/g, '$1.').toUpperCase()
}

/* ===== Field identitas kartu (edit data diri) ===== */
const IDENTITY_FIELDS: Array<{ key: Exclude<keyof Profile, 'name' | 'avatar'>; label: string; half?: boolean }> = [
  { key: 'nik', label: 'NIK' },
  { key: 'tempatLahir', label: 'Tempat Lahir', half: true },
  { key: 'tanggalLahir', label: 'Tanggal Lahir', half: true },
  { key: 'jenisKelamin', label: 'Jenis Kelamin', half: true },
  { key: 'golonganDarah', label: 'Golongan Darah', half: true },
  { key: 'alamat', label: 'Alamat' },
  { key: 'rt', label: 'RT', half: true },
  { key: 'rw', label: 'RW', half: true },
  { key: 'kelDesa', label: 'Kel/Desa', half: true },
  { key: 'kecamatan', label: 'Kecamatan', half: true },
  { key: 'agama', label: 'Agama', half: true },
  { key: 'statusPerkawinan', label: 'Status Perkawinan', half: true },
  { key: 'pekerjaan', label: 'Pekerjaan' },
  { key: 'kewarganegaraan', label: 'Kewarganegaraan' },
  { key: 'wilayah', label: 'Wilayah', half: true },
]

const WILAYAH_OPTIONS = ['Jawa Timur', 'Jawa Barat', 'Jawa Tengah', 'Kalimantan']

export default function ProfilePanel({ profile, session, onProfileChange, onSessionChange, onClose, onToast }: ProfilePanelProps) {
  const avatarRef = useRef<HTMLInputElement | null>(null)
  const [view, setView] = useState<'profile' | 'login'>(session ? 'profile' : 'login')
  const [guestName, setGuestName] = useState('')

  useEffect(() => {
    setView(session ? 'profile' : 'login')
  }, [session])

  const setField = (key: Exclude<keyof Profile, 'avatar'>, value: string) => {
    onProfileChange({ ...profile, [key]: value })
  }

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { onToast('Pilih file gambar'); return }
    const dataUrl = await makeAvatarDataUrl(file)
    if (!dataUrl) { onToast('Gagal memuat gambar'); return }
    onProfileChange({ ...profile, avatar: dataUrl })
    onToast('Foto diperbarui')
  }

  const handleNameBlur = () => {
    const next = profile.name.trim() || DEFAULT_PROFILE.name
    if (next !== profile.name) onProfileChange({ ...profile, name: next })
  }

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
      onToast('Nama disimpan')
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
          {view === 'login' && session ? (
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
            {/* ===== KARTU KTP ===== */}
            <div className="ktp">
              <div className="ktp-head">
                <div className="ktp-emblem">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 2l2.5 5.5L20 6l-2 5.5L21 15l-5.5 1L12 22l-3.5-6L3 15l3-3.5L4 6l5.5.5z" fill="currentColor" />
                  </svg>
                </div>
                <div className="ktp-head-tx">
                  <div className="ktp-head-kiri">REPUBLIK</div>
                  <div className="ktp-head-main">OF CYBER</div>
                </div>
                <div className="ktp-head-mark">ID</div>
              </div>

              <div className="ktp-band" />

              <div className="ktp-body">
                <div className="ktp-fields">
                  <div className="ktp-f">
                    <span className="k">NIK</span>
                    <span className="v nik">{fmtNik(profile.nik) || '—'}</span>
                  </div>

                  <div className="ktp-f name">
                    <span className="k">Nama</span>
                    <span className="v">{profile.name || '—'}</span>
                  </div>

                  <div className="ktp-f">
                    <span className="k">Tempat / Tgl Lahir</span>
                    <span className="v">{[profile.tempatLahir, profile.tanggalLahir].filter(Boolean).join(', ') || '—'}</span>
                  </div>

                  <div className="ktp-g2">
                    <div className="ktp-f">
                      <span className="k">Jenis Kelamin</span>
                      <span className="v">{profile.jenisKelamin || '—'}</span>
                    </div>
                    <div className="ktp-f">
                      <span className="k">Gol. Darah</span>
                      <span className="v">{profile.golonganDarah || '—'}</span>
                    </div>
                  </div>

                  <div className="ktp-f">
                    <span className="k">Alamat</span>
                    <span className="v">{profile.alamat || '—'}</span>
                  </div>

                  <div className="ktp-g2">
                    <div className="ktp-f">
                      <span className="k">RT/RW</span>
                      <span className="v">{profile.rt ? `${profile.rt}/${profile.rw || ''}` : (profile.rw || '—')}</span>
                    </div>
                    <div className="ktp-f">
                      <span className="k">Kel/Desa</span>
                      <span className="v">{profile.kelDesa || '—'}</span>
                    </div>
                  </div>

                  <div className="ktp-g2">
                    <div className="ktp-f">
                      <span className="k">Kecamatan</span>
                      <span className="v">{profile.kecamatan || '—'}</span>
                    </div>
                    <div className="ktp-f">
                      <span className="k">Agama</span>
                      <span className="v">{profile.agama || '—'}</span>
                    </div>
                  </div>

                  <div className="ktp-g2">
                    <div className="ktp-f">
                      <span className="k">Status Perkawinan</span>
                      <span className="v">{profile.statusPerkawinan || '—'}</span>
                    </div>
                    <div className="ktp-f">
                      <span className="k">Pekerjaan</span>
                      <span className="v">{profile.pekerjaan || '—'}</span>
                    </div>
                  </div>

                  <div className="ktp-g2">
                    <div className="ktp-f">
                      <span className="k">Kewarganegaraan</span>
                      <span className="v">{profile.kewarganegaraan || '—'}</span>
                    </div>
                    <div className="ktp-f">
                      <span className="k">Wilayah</span>
                      <span className="v">{profile.wilayah || '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="ktp-side">
                  <button type="button" className="ktp-photo" onClick={() => avatarRef.current?.click()} title="Ganti foto dari galeri">
                    {profile.avatar
                      ? <img src={profile.avatar} alt="Foto profil" />
                      : <div className="ktp-ph-ph">Foto</div>}
                  </button>
                  <div className="ktp-side-nik">{fmtNik(profile.nik) ? `NIK ${fmtNik(profile.nik).split('.').join('')}` : 'NIK'}</div>
                  <div className="ktp-sign">
                    <div className="ktp-sign-tx">
                      {profile.name ? profile.name.split(' ').slice(0, 2).join(' ') : 'Nama'}
                    </div>
                    <div className="ktp-sign-ln" />
                    <div className="k">Tanda Tangan</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="ktp-cam-hint">Ketuk foto di kartu untuk memilih dari galeri</div>
            <button type="button" className="profile-btn-ghost ktp-photo-btn" onClick={() => avatarRef.current?.click()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
              Ganti Foto
            </button>
            <input ref={avatarRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />

            {/* ===== EDIT DATA DIRI ===== */}
            <div className="profile-edit-hd">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z" /></svg>
              <span>Data Diri / Identitas</span>
            </div>
            <div className="ktp-edit-note">Kamu edit data lama, tersimpan otomatis di perangkat.</div>

            <div className="profile-edit-grid">
              <div className="profile-field">
                <label htmlFor="profile-name">Nama Lengkap</label>
                <input
                  id="profile-name"
                  className="profile-input"
                  value={profile.name}
                  maxLength={40}
                  spellCheck={false}
                  onChange={e => setField('name', e.target.value)}
                  onBlur={handleNameBlur}
                  onKeyDown={handleNameKeyDown}
                />
              </div>

              {IDENTITY_FIELDS.map(f => (
                <div className={`profile-field ${f.half ? 'pcol-half' : ''}`} key={f.key}>
                  <label htmlFor={`field-${f.key}`}>{f.label}</label>
                  {f.key === 'wilayah' ? (
                    <select
                      id={`field-${f.key}`}
                      className="profile-input"
                      value={String(profile[f.key] ?? '')}
                      onChange={e => setField(f.key, e.target.value)}
                    >
                      <option value="">— Pilih Wilayah —</option>
                      {WILAYAH_OPTIONS.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>
                  ) : (
                    <input
                      id={`field-${f.key}`}
                      className="profile-input"
                      value={String(profile[f.key] ?? '')}
                      maxLength={f.key === 'nik' ? 16 : 60}
                      spellCheck={false}
                      onChange={e => setField(f.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* ===== LOGIN ===== */}
            <div className="login-menu ktp-login">
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
            </div>
          </>
        )}
      </div>
    </div>
  )
}
