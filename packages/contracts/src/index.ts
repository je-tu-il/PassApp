/**
 * Contrats de données partagés entre les modules PassApp (Desktop, Core, iOS, Web).
 */

export const CURRENT_SCHEMA_VERSION = 1

export type EntryCategory = 'Personnel' | 'Travail' | 'Finance' | 'Autre'

export interface VaultEntry {
  id: string
  title: string
  username: string
  password?: string
  url?: string
  notes?: string
  category: EntryCategory
  favorite: boolean
  updated_at: number
}

export interface VaultDocument {
  schema_version: number
  updated_at: number
  entries: VaultEntry[]
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
