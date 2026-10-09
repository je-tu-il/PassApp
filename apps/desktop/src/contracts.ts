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

export const demoEntries: VaultEntry[] = [
  {
    id: 'mail',
    title: 'Courriel personnel',
    username: 'alexandre@exemple.fr',
    password: 'Password123!Secure',
    url: 'https://mail.exemple.fr',
    notes: 'Compte de messagerie personnel',
    category: 'Personnel',
    favorite: true,
    updatedAt: 'Modifié il y a 2 h',
  },
  {
    id: 'bank',
    title: 'Banque principale',
    username: 'Alexandre Martin',
    password: 'BankPass987$Secure',
    url: 'https://banque.exemple.fr',
    notes: 'Accès portail bancaire en ligne',
    category: 'Finance',
    favorite: true,
    updatedAt: 'Modifié hier',
  },
  {
    id: 'work',
    title: 'Espace de travail',
    username: 'alexandre.martin',
    password: 'WorkPass456#Office',
    url: 'https://workspace.entreprise.fr',
    notes: 'Identifiant SSO entreprise',
    category: 'Travail',
    favorite: false,
    updatedAt: 'Modifié lundi',
  },
]