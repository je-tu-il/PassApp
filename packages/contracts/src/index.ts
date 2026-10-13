/**
 * Contrats de données partagés entre les modules PassApp (Desktop, Core, iOS, Web).
 */

export const CURRENT_SCHEMA_VERSION = 1

export type EntryCategory = 'Personnel' | 'Travail' | 'Finance' | 'Autre'

export type ItemType = 'login' | 'note' | 'file'

export interface VaultAttachment {
  id: string
  name: string
  size: number
  mime_type: string
  data: string // Contenu encodé en base64
  updated_at?: number
}

export interface VaultEntry {
  id: string
  title: string
  username: string
  password?: string
  url?: string
  notes?: string
  totp_secret?: string
  category: EntryCategory
  favorite: boolean
  updated_at: number
  folder?: string | null
  item_type?: ItemType | null
  attachments?: VaultAttachment[]
}

export interface VaultDocument {
  schema_version: number
  updated_at: number
  entries: VaultEntry[]
  custom_folders?: string[]
}

export interface KdfParameters {
  memory_kib: number
  iterations: number
  parallelism: number
}

export interface EncryptedPayload {
  format_version: number
  kdf: KdfParameters
  salt: number[]
  nonce: number[]
  ciphertext: number[]
}

export interface AppStatus {
  vault_locked: boolean
  storage: string
  vault_path: string | null
}
