/* ===== PROFIL (TS: tipe, penyimpanan, pemrosesan foto) ===== */

export type Profile = {
  name: string
  avatar: string // dataURL base64 dari foto profil
}

export const DEFAULT_PROFILE: Profile = { name: 'DZarif', avatar: '' }

const PROFILE_KEY = 'zanco_profile_v1'

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Profile> | null
      if (parsed && typeof parsed === 'object') {
        return {
          name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : DEFAULT_PROFILE.name,
          avatar: typeof parsed.avatar === 'string' ? parsed.avatar : '',
        }
      }
    }
  } catch {
    /* abaikan storage rusak / SSR tanpa localStorage */
  }
  return { ...DEFAULT_PROFILE }
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    /* abaikan kuota storage penuh */
  }
}

function readImageBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file)
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('gambar gagal dimuat')) }
    img.src = url
  })
}

export async function makeAvatarDataUrl(file: File): Promise<string> {
  try {
    const bmp = await readImageBitmap(file)
    const MAX = 256
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas tidak didukung')
    ctx.drawImage(bmp as CanvasImageSource, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return ''
  }
}
