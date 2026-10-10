/**
 * Moteur TOTP (Time-based One-Time Password) conforme RFC 6238 / RFC 4226.
 * Utilise l'API native Web Crypto (SubtleCrypto) pour un hachage HMAC-SHA-1 sécurisé sans dépendances externes.
 */

// Décodage Base32 RFC 4648
export function base32Decode(input: string): Uint8Array {
  let cleaned = input.trim().replace(/[\s-]/g, '').toUpperCase()

  // Support des URL standard otpauth://totp/...
  if (cleaned.startsWith('OTPAUTH://') || input.trim().startsWith('otpauth://')) {
    try {
      const url = new URL(input.trim())
      const secret = url.searchParams.get('secret')
      if (secret) {
        cleaned = secret.replace(/[\s-]/g, '').toUpperCase()
      }
    } catch {
      const match = input.match(/[?&]secret=([A-Z2-7=]+)/i)
      if (match && match[1]) {
        cleaned = match[1].replace(/[\s-]/g, '').toUpperCase()
      }
    }
  }

  // Nettoyage du padding '='
  cleaned = cleaned.replace(/=+$/, '')

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const output: number[] = []

  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned.charAt(i))
    if (val === -1) continue // Ignore les caractères non conformes
    value = (value << 5) | val
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return new Uint8Array(output)
}

// Extraction des métadonnées d'une URL otpauth://totp/
export function parseOtpAuthUri(uri: string): {
  secret?: string
  issuer?: string
  account?: string
} | null {
  if (!uri.toLowerCase().startsWith('otpauth://totp/')) return null
  try {
    const url = new URL(uri)
    const secret = url.searchParams.get('secret') || undefined
    let issuer = url.searchParams.get('issuer') || undefined
    let account: string | undefined

    // Le chemin d'accès contient souvent 'issuer:account' ou juste 'account'
    const path = decodeURIComponent(url.pathname.replace(/^\/\/?totp\/?/i, ''))
    if (path.includes(':')) {
      const parts = path.split(':')
      if (!issuer) issuer = parts[0]?.trim()
      account = parts.slice(1).join(':').trim()
    } else {
      account = path.trim()
    }

    return { secret, issuer, account }
  } catch {
    return null
  }
}

// Calcul du code TOTP RFC 6238 à 6 chiffres
export async function generateTotpCode(secret: string, timestampSeconds?: number): Promise<string> {
  if (!secret || secret.trim().length === 0) return '------'
  try {
    const keyBytes = base32Decode(secret)
    if (keyBytes.length === 0) return '------'

    const epoch = timestampSeconds !== undefined ? timestampSeconds : Math.floor(Date.now() / 1000)
    const timeStep = 30
    const counter = Math.floor(epoch / timeStep)

    // Tampon de 8 octets big-endian pour le compteur
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setUint32(0, 0)
    view.setUint32(4, counter)

    const cryptoKey = await window.crypto.subtle.importKey(
      'raw',
      keyBytes as unknown as BufferSource,
      { name: 'HMAC', hash: { name: 'SHA-1' } },
      false,
      ['sign'],
    )

    const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, buffer)
    const hmacResult = new Uint8Array(signature)

    // Dynamic truncation RFC 4226
    const offset = hmacResult[hmacResult.length - 1] & 0x0f
    const binary =
      ((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff)

    const otp = binary % 1000000
    return otp.toString().padStart(6, '0')
  } catch {
    return '------'
  }
}

// Calcul du nombre de secondes restantes dans la fenêtre courante de 30 secondes
export function getTotpRemainingSeconds(): number {
  const currentSeconds = Math.floor(Date.now() / 1000)
  return 30 - (currentSeconds % 30)
}
