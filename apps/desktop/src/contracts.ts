export type VaultEntry = {
  id: string
  title: string
  username: string
  password?: string
  url?: string
  notes?: string
  category: 'Finance' | 'Travail' | 'Personnel'
  favorite: boolean
  updatedAt: string
}

// Coffre initial propre : zéro données de test pré-remplies
export const demoEntries: VaultEntry[] = []