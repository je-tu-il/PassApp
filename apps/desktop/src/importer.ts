/**
 * Moteur d'importation universel de mots de passe et données 2FA Authenticator.
 * Prise en charge automatique :
 * - CSV : Chrome, Edge, Firefox, Safari / Apple Passwords, Bitwarden, 1Password, KeePass, LastPass, Dashlane
 * - JSON : Sauvegardes PassApp, Bitwarden JSON, Aegis Authenticator, 2FAS
 * - TXT / URIs : Listes d'URL otpauth:// (Google Authenticator)
 */

import { parseOtpAuthUri } from './totp'

export type ImportedItem = {
  title: string
  username: string
  password?: string
  url?: string
  notes?: string
  totpSecret?: string
  category: 'Personnel' | 'Travail' | 'Finance'
  favorite: boolean
}

export type ParseImportResult = {
  formatDetected: string
  items: ImportedItem[]
  warnings: string[]
}

// Analyseur CSV respectueux des guillemets et sauts de ligne
function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const nextChar = text[i + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"'
        i++ // saute le guillemet échappé
      } else if (char === '"') {
        inQuotes = false
      } else {
        currentField += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === delimiter) {
        currentRow.push(currentField.trim())
        currentField = ''
      } else if (char === '\r') {
        // ignore retour chariot
      } else if (char === '\n') {
        currentRow.push(currentField.trim())
        rows.push(currentRow)
        currentRow = []
        currentField = ''
      } else {
        currentField += char
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    rows.push(currentRow)
  }

  return rows
}

// Détection automatique du délimiteur le plus fréquent dans les premières lignes
function detectDelimiter(text: string): string {
  const sample = text.slice(0, 2000)
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  for (const c of sample) {
    if (c in counts) counts[c]++
  }
  let best = ','
  let max = -1
  for (const [delim, count] of Object.entries(counts)) {
    if (count > max) {
      max = count
      best = delim
    }
  }
  return best
}

// Normalisation du nom de colonne pour correspondances
function normalizeKey(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function parseUniversalImport(rawContent: string, _fileName?: string): ParseImportResult {
  const trimmed = rawContent.trim()
  if (!trimmed) {
    return { formatDetected: 'Inconnu', items: [], warnings: ['Le fichier fourni est vide.'] }
  }

  // 1. TENTATIVE JSON (PassApp, Bitwarden, 2FAS, Aegis)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed)

      // Format PassApp Backup
      if (data.app === 'PassApp' || (data.entries && Array.isArray(data.entries))) {
        const list = Array.isArray(data.entries) ? data.entries : []
        const items: ImportedItem[] = list.map((e: any) => ({
          title: String(e.title || 'Sans titre'),
          username: String(e.username || ''),
          password: e.password ? String(e.password) : undefined,
          url: e.url ? String(e.url) : undefined,
          notes: e.notes ? String(e.notes) : undefined,
          totpSecret: e.totpSecret || e.totp_secret || undefined,
          category: (e.category as any) || 'Personnel',
          favorite: Boolean(e.favorite),
        }))
        return { formatDetected: 'Sauvegarde PassApp (JSON)', items, warnings: [] }
      }

      // Format Bitwarden JSON
      if (data.items && Array.isArray(data.items)) {
        const logins = data.items.filter((item: any) => item.type === 1 || item.login)
        const items: ImportedItem[] = logins.map((item: any) => {
          const login = item.login || {}
          const uris = login.uris && login.uris.length > 0 ? login.uris[0].uri : undefined
          return {
            title: String(item.name || 'Identifiant Bitwarden'),
            username: String(login.username || ''),
            password: login.password ? String(login.password) : undefined,
            url: uris,
            notes: item.notes ? String(item.notes) : undefined,
            totpSecret: login.totp ? String(login.totp) : undefined,
            category: 'Personnel',
            favorite: Boolean(item.favorite),
          }
        })
        return { formatDetected: 'Export Bitwarden (JSON)', items, warnings: [] }
      }

      // Format 2FAS Authenticator JSON
      if (data.services && Array.isArray(data.services)) {
        const items: ImportedItem[] = data.services.map((svc: any) => {
          const secret = svc.secret || svc.token?.secret
          return {
            title: String(svc.name || svc.service || '2FA Token'),
            username: String(svc.account || ''),
            totpSecret: secret ? String(secret) : undefined,
            category: 'Personnel',
            favorite: false,
          }
        })
        return { formatDetected: 'Export 2FAS Authenticator (JSON)', items, warnings: [] }
      }

      // Format Aegis Authenticator JSON
      if (data.db && data.db.vault && Array.isArray(data.db.vault.entries)) {
        const items: ImportedItem[] = data.db.vault.entries.map((entry: any) => {
          const secret = entry.info?.secret
          return {
            title: String(entry.issuer || entry.name || 'Aegis 2FA'),
            username: String(entry.name || ''),
            notes: entry.note ? String(entry.note) : undefined,
            totpSecret: secret ? String(secret) : undefined,
            category: 'Personnel',
            favorite: Boolean(entry.favorite),
          }
        })
        return { formatDetected: 'Export Aegis 2FA (JSON)', items, warnings: [] }
      }
    } catch {
      // Si ce n'est pas un JSON valide, continuer vers CSV / URIs
    }
  }

  // 2. TENTATIVE LISTE D'URIS OTPAUTH:// (Google Authenticator export ou liste TXT)
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const otpAuthLines = lines.filter((l) => l.toLowerCase().startsWith('otpauth://'))
  if (otpAuthLines.length > 0 && otpAuthLines.length >= lines.length / 2) {
    const items: ImportedItem[] = []
    for (const uri of otpAuthLines) {
      const parsed = parseOtpAuthUri(uri)
      if (parsed) {
        items.push({
          title: parsed.issuer || parsed.account || 'Google Authenticator',
          username: parsed.account || '',
          totpSecret: parsed.secret,
          category: 'Personnel',
          favorite: false,
        })
      }
    }
    return {
      formatDetected: 'Export Google Authenticator / 2FA (otpauth://)',
      items,
      warnings: [],
    }
  }

  // 3. TENTATIVE CSV MULTI-FORMATS
  const delimiter = detectDelimiter(trimmed)
  const rows = parseCsvRows(trimmed, delimiter)
  if (rows.length < 2) {
    return {
      formatDetected: 'Format Inconnu',
      items: [],
      warnings: ['Nombre insuffisant de lignes pour détecter un tableau CSV.'],
    }
  }

  const rawHeaders = rows[0]
  const headers = rawHeaders.map(normalizeKey)

  // Dictionnaire de correspondances sémantiques universelles
  const findColIndex = (...aliases: string[]): number => {
    for (const alias of aliases) {
      const norm = normalizeKey(alias)
      const idx = headers.indexOf(norm)
      if (idx !== -1) return idx
    }
    // Recherche partielle si aucune correspondance exacte
    for (let i = 0; i < headers.length; i++) {
      for (const alias of aliases) {
        const norm = normalizeKey(alias)
        if (headers[i].includes(norm)) return i
      }
    }
    return -1
  }

  const colTitle = findColIndex('title', 'name', 'nom', 'site', 'service', 'account', 'compte')
  const colUser = findColIndex('username', 'loginusername', 'login', 'user', 'email', 'identifiant', 'utilisateur')
  const colPass = findColIndex('password', 'loginpassword', 'motdepasse', 'pass', 'mdp', 'code')
  const colUrl = findColIndex('url', 'loginuri', 'website', 'uri', 'adresse', 'lien', 'web', 'host')
  const colTotp = findColIndex('totp', 'logintotp', 'totpsecret', 'otp', '2fa', 'authenticator', 'secret', 'otpauth')
  const colNotes = findColIndex('notes', 'note', 'comments', 'comment', 'remarque', 'extra', 'details')
  const colCategory = findColIndex('category', 'folder', 'group', 'grouping', 'dossier')
  const colFav = findColIndex('favorite', 'fav', 'favori')

  // Détection du gestionnaire d'origine pour l'étiquette utilisateur
  let formatLabel = 'Fichier CSV générique'
  const headerStr = headers.join(',')
  if (headerStr.includes('loginusername') || headerStr.includes('loginpassword') || headerStr.includes('logintotp')) {
    formatLabel = 'Export Bitwarden (CSV)'
  } else if (headerStr.includes('httprealm') || headerStr.includes('formactionorigin')) {
    formatLabel = 'Export Mozilla Firefox (CSV)'
  } else if (headerStr.includes('otpauth') && headerStr.includes('notes')) {
    formatLabel = 'Export Apple Passwords / Safari (CSV)'
  } else if (headerStr.includes('group') && headerStr.includes('title')) {
    formatLabel = 'Export KeePass (CSV)'
  } else if (rawHeaders.some((h) => h.toLowerCase() === 'name') && rawHeaders.some((h) => h.toLowerCase() === 'url') && rawHeaders.some((h) => h.toLowerCase() === 'username')) {
    formatLabel = 'Export Google Chrome / Edge (CSV)'
  } else if (headerStr.includes('grouping') || headerStr.includes('fav')) {
    formatLabel = 'Export LastPass (CSV)'
  }

  const items: ImportedItem[] = []
  const dataRows = rows.slice(1)

  for (const row of dataRows) {
    if (row.length === 0 || row.every((c) => c.trim() === '')) continue

    const title = (colTitle !== -1 ? row[colTitle] : '') || (colUrl !== -1 ? row[colUrl] : '') || 'Sans titre'
    const username = (colUser !== -1 ? row[colUser] : '') || ''
    const password = colPass !== -1 && row[colPass] ? row[colPass] : undefined
    const url = colUrl !== -1 && row[colUrl] ? row[colUrl] : undefined
    const notes = colNotes !== -1 && row[colNotes] ? row[colNotes] : undefined
    const totpVal = colTotp !== -1 && row[colTotp] ? row[colTotp] : undefined
    const rawCat = colCategory !== -1 && row[colCategory] ? row[colCategory] : 'Personnel'
    const favVal = colFav !== -1 && row[colFav] ? row[colFav] : '0'

    // Catégorie sécurisée
    let category: 'Personnel' | 'Travail' | 'Finance' = 'Personnel'
    const catLower = rawCat.toLowerCase()
    if (catLower.includes('travail') || catLower.includes('work') || catLower.includes('job') || catLower.includes('pro')) {
      category = 'Travail'
    } else if (catLower.includes('finance') || catLower.includes('banque') || catLower.includes('bank') || catLower.includes('crypto')) {
      category = 'Finance'
    }

    const favorite = favVal === '1' || favVal.toLowerCase() === 'true' || favVal.toLowerCase() === 'oui'

    // Nettoyage de l'éventuelle clé TOTP
    let totpSecret: string | undefined = undefined
    if (totpVal) {
      if (totpVal.toLowerCase().startsWith('otpauth://')) {
        const parsed = parseOtpAuthUri(totpVal)
        totpSecret = parsed?.secret || totpVal
      } else {
        totpSecret = totpVal.trim()
      }
    }

    items.push({
      title: title.trim(),
      username: username.trim(),
      password,
      url,
      notes,
      totpSecret,
      category,
      favorite,
    })
  }

  return {
    formatDetected: formatLabel,
    items,
    warnings: [],
  }
}
