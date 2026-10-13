export type ItemType = 'login' | 'note' | 'file'

export type VaultAttachment = {
  id: string
  name: string
  size: number
  mimeType: string
  data: string // base64
  updatedAt?: number
}

export type VaultEntry = {
  id: string
  title: string
  username: string
  password?: string
  url?: string
  notes?: string
  totpSecret?: string
  category: 'Finance' | 'Travail' | 'Personnel'
  favorite: boolean
  updatedAt: string
  folder?: string
  itemType?: ItemType
  attachments?: VaultAttachment[]
}

// Coffre initial propre : zéro données de test pré-remplies
export const demoEntries: VaultEntry[] = []