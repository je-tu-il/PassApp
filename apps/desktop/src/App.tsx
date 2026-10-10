import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { demoEntries, type VaultEntry } from './contracts'
import './App.css'

type AppStatus = {
  vault_locked: boolean
  storage: string
  vault_path: string | null
}

type BackendVaultEntry = {
  id: string
  title: string
  username: string
  password?: string | null
  url?: string | null
  notes?: string | null
  category: string
  favorite: boolean
  updated_at: number
}

type OpenVaultResult = {
  vault_locked: boolean
  entries: BackendVaultEntry[]
  vault_path?: string | null
}

type SortOption = 'title-asc' | 'title-desc' | 'category' | 'recent'
type ActiveFilter = 'all' | 'favorites' | 'Personnel' | 'Travail' | 'Finance'

type GeneratorConfig = {
  length: number
  includeUpper: boolean
  includeLower: boolean
  includeDigits: boolean
  includeSymbols: boolean
  excludeAmbiguous: boolean
}

type PasswordStrength = {
  score: number // 0 à 4
  entropyBits: number
  label: string
  color: string
  tips: string[]
}

const browserStatus: AppStatus = {
  vault_locked: true,
  storage: 'browser-demo',
  vault_path: 'E:\\Reste\\PROJET_PERSO\\PassApp\\vault.passapp (mode navigateur)',
}

function fromBackendEntry(entry: BackendVaultEntry): VaultEntry {
  let formatted = 'Enregistré localement'
  if (entry.updated_at > 0) {
    const d = new Date(entry.updated_at * 1000)
    formatted = d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return {
    id: entry.id,
    title: entry.title,
    username: entry.username,
    password: entry.password || undefined,
    url: entry.url || undefined,
    notes: entry.notes || undefined,
    category: (entry.category as 'Finance' | 'Travail' | 'Personnel') || 'Personnel',
    favorite: entry.favorite,
    updatedAt: formatted,
  }
}

// Calcul de l'entropie et de la force cryptographique
function evaluatePassword(pwd: string): PasswordStrength {
  if (!pwd) {
    return {
      score: 0,
      entropyBits: 0,
      label: 'Vide',
      color: '#8c9590',
      tips: ['Saisissez un mot de passe pour tester sa robustesse'],
    }
  }

  const hasLower = /[a-z]/.test(pwd)
  const hasUpper = /[A-Z]/.test(pwd)
  const hasDigit = /[0-9]/.test(pwd)
  const hasSpecial = /[^a-zA-Z0-9]/.test(pwd)

  let poolSize = 0
  if (hasLower) poolSize += 26
  if (hasUpper) poolSize += 26
  if (hasDigit) poolSize += 10
  if (hasSpecial) poolSize += 33

  const entropyBits = Math.round(pwd.length * Math.log2(Math.max(poolSize, 2)))
  const tips: string[] = []
  if (!hasLower) tips.push('+ Minuscules')
  if (!hasUpper) tips.push('+ Majuscules')
  if (!hasDigit) tips.push('+ Chiffres')
  if (!hasSpecial) tips.push('+ Symboles')
  if (pwd.length < 12) tips.push('Longueur recommandée ≥ 14 caractères')

  if (entropyBits < 35 || pwd.length < 8) {
    return { score: 1, entropyBits, label: 'Faible', color: '#e05245', tips }
  }
  if (entropyBits < 55 || pwd.length < 11) {
    return { score: 2, entropyBits, label: 'Moyen', color: '#e0a34e', tips }
  }
  if (entropyBits < 75 || pwd.length < 14) {
    return { score: 3, entropyBits, label: 'Fort', color: '#2c7f78', tips }
  }
  return { score: 4, entropyBits, label: 'Excellent', color: '#1f9d55', tips }
}

// Générateur de mot de passe hautement paramétrable
function generatePasswordWithOptions(config: GeneratorConfig): string {
  let upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let lower = 'abcdefghijkmnopqrstuvwxyz'
  let digits = '23456789'
  let symbols = '!@#$%^&*()-_=+[]{}<>~'

  if (!config.excludeAmbiguous) {
    upper += 'IO'
    lower += 'l'
    digits += '01'
    symbols += '|'
  }

  let charset = ''
  if (config.includeUpper) charset += upper
  if (config.includeLower) charset += lower
  if (config.includeDigits) charset += digits
  if (config.includeSymbols) charset += symbols
  if (!charset) charset = lower + digits

  const array = new Uint32Array(config.length)
  crypto.getRandomValues(array)
  return Array.from(array, (x) => charset[x % charset.length]).join('')
}

function App() {
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [isLocked, setIsLocked] = useState(true)
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [storageLabel, setStorageLabel] = useState('browser-demo')
  const [vaultPath, setVaultPath] = useState<string>('')
  const [password, setPassword] = useState('')
  const [openError, setOpenError] = useState('')
  const [isBrowserMode, setIsBrowserMode] = useState(false)

  // Tri & Filtres
  const [sortBy, setSortBy] = useState<SortOption>('title-asc')
  const [showSortMenu, setShowSortMenu] = useState(false)

  // Visualisation & Copie
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showEntryMenu, setShowEntryMenu] = useState(false)

  // Presse-papier auto-nettoyant
  const [clipboardTimer, setClipboardTimer] = useState<{ active: boolean; secondsLeft: number; label: string }>({
    active: false,
    secondsLeft: 0,
    label: '',
  })
  const clipboardIntervalRef = useRef<number | null>(null)

  // Verrouillage auto sur inactivité
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(5)
  const lastActivityRef = useRef<number>(Date.now())

  // Modales
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isAddEntryOpen, setIsAddEntryOpen] = useState(false)
  const [isEditEntryOpen, setIsEditEntryOpen] = useState(false)
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false)

  // Générateur de mot de passe
  const [genConfig, setGenConfig] = useState<GeneratorConfig>({
    length: 18,
    includeUpper: true,
    includeLower: true,
    includeDigits: true,
    includeSymbols: true,
    excludeAmbiguous: false,
  })
  const [generatedPassword, setGeneratedPassword] = useState('')

  // Formulaire d'ajout / édition
  const [formTitle, setFormTitle] = useState('')
  const [formUsername, setFormUsername] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formCategory, setFormCategory] = useState<'Personnel' | 'Travail' | 'Finance'>('Personnel')
  const [formFavorite, setFormFavorite] = useState(false)

  // Formulaire de changement de mot de passe maître
  const [currentMasterPassword, setCurrentMasterPassword] = useState('')
  const [newMasterPassword, setNewMasterPassword] = useState('')
  const [confirmMasterPassword, setConfirmMasterPassword] = useState('')
  const [masterPasswordMsg, setMasterPasswordMsg] = useState<{ text: string; error: boolean } | null>(null)

  // Initialisation & Statut de l'application
  useEffect(() => {
    invoke<AppStatus>('get_app_status')
      .then(async (status) => {
        setIsLocked(status.vault_locked)
        setStorageLabel(status.storage)
        if (status.vault_path) setVaultPath(status.vault_path)
        setIsBrowserMode(false)
        if (status.vault_locked) {
          setEntries([])
          setSelectedId('')
          return
        }
        const backendEntries = await invoke<BackendVaultEntry[]>('get_vault_entries')
        if (backendEntries.length > 0) {
          const loaded = backendEntries.map(fromBackendEntry)
          setEntries(loaded)
          setSelectedId(loaded[0].id)
        }
      })
      .catch(() => {
        setIsLocked(browserStatus.vault_locked)
        setStorageLabel(browserStatus.storage)
        setVaultPath(browserStatus.vault_path || '')
        setIsBrowserMode(true)
        setEntries([])
        setSelectedId('')
      })
  }, [])

  // Décompte par catégorie pour la barre latérale
  const categoryCounts = useMemo(() => {
    return {
      all: entries.length,
      favorites: entries.filter((e) => e.favorite).length,
      Personnel: entries.filter((e) => e.category === 'Personnel').length,
      Travail: entries.filter((e) => e.category === 'Travail').length,
      Finance: entries.filter((e) => e.category === 'Finance').length,
    }
  }, [entries])

  // Verrouillage du coffre (Efface la mémoire et réinitialise l'état)
  async function toggleLock() {
    const nextLocked = !isLocked
    const status = await invoke<AppStatus>('set_vault_locked', { locked: nextLocked }).catch(() => ({
      ...browserStatus,
      vault_locked: nextLocked,
    }))
    setIsLocked(status.vault_locked)
    setStorageLabel(status.storage)
    if (status.vault_path) setVaultPath(status.vault_path)

    if (status.vault_locked) {
      setEntries([])
      setSelectedId('')
      setPassword('')
      setOpenError('')
      setShowPassword(false)
      setShowEntryMenu(false)
    }
  }

  // Ouvrir la modale d'ajout
  function openAddModal() {
    setFormTitle('')
    setFormUsername('')
    setFormPassword(generatePasswordWithOptions(genConfig))
    setFormUrl('')
    setFormNotes('')
    setFormCategory('Personnel')
    setFormFavorite(false)
    setIsAddEntryOpen(true)
  }

  const toggleLockRef = useRef(toggleLock)
  toggleLockRef.current = toggleLock
  const openAddModalRef = useRef(openAddModal)
  openAddModalRef.current = openAddModal

  // Suivi de l'inactivité pour le verrouillage automatique
  useEffect(() => {
    function handleUserActivity() {
      lastActivityRef.current = Date.now()
    }

    window.addEventListener('mousemove', handleUserActivity)
    window.addEventListener('keydown', handleUserActivity)
    window.addEventListener('mousedown', handleUserActivity)

    const interval = window.setInterval(() => {
      if (!isLocked && autoLockMinutes > 0) {
        const elapsedMinutes = (Date.now() - lastActivityRef.current) / 1000 / 60
        if (elapsedMinutes >= autoLockMinutes) {
          void toggleLockRef.current()
          clearClipboardImmediately()
        }
      }
    }, 5000)

    return () => {
      window.removeEventListener('mousemove', handleUserActivity)
      window.removeEventListener('keydown', handleUserActivity)
      window.removeEventListener('mousedown', handleUserActivity)
      window.clearInterval(interval)
    }
  }, [autoLockMinutes, isLocked])

  // Raccourcis clavier (Ctrl+L, Ctrl+N, Escape)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        void toggleLockRef.current()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        if (!isLocked) {
          e.preventDefault()
          openAddModalRef.current()
        }
      } else if (e.key === 'Escape') {
        setIsProfileOpen(false)
        setIsAddEntryOpen(false)
        setIsEditEntryOpen(false)
        setIsGeneratorOpen(false)
        setShowSortMenu(false)
        setShowEntryMenu(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isLocked])

  // Filtrage et Tri des entrées
  const visibleEntries = useMemo(() => {
    if (isLocked) return []
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = entries.filter((entry) => {
      let matchesFilter = true
      if (activeFilter === 'favorites') {
        matchesFilter = entry.favorite
      } else if (activeFilter !== 'all') {
        matchesFilter = entry.category === activeFilter
      }

      const matchesQuery =
        !normalizedQuery ||
        `${entry.title} ${entry.username} ${entry.category} ${entry.url || ''} ${entry.notes || ''}`
          .toLowerCase()
          .includes(normalizedQuery)

      return matchesFilter && matchesQuery
    })

    return filtered.sort((a, b) => {
      if (sortBy === 'title-asc') return a.title.localeCompare(b.title)
      if (sortBy === 'title-desc') return b.title.localeCompare(a.title)
      if (sortBy === 'category') {
        const catCompare = a.category.localeCompare(b.category)
        return catCompare !== 0 ? catCompare : a.title.localeCompare(b.title)
      }
      return 0
    })
  }, [activeFilter, entries, isLocked, query, sortBy])

  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? visibleEntries[0]

  // Déverrouillage du coffre
  async function openVault() {
    if (!password) {
      setOpenError('Saisissez votre mot de passe maître.')
      return
    }
    const result = await invoke<OpenVaultResult>('open_vault', { password }).catch((error: unknown) => {
      setOpenError(typeof error === 'string' ? error : "Impossible d'ouvrir le coffre.")
      return undefined
    })
    if (!result) return

    const loaded = result.entries.map(fromBackendEntry)
    setEntries(loaded)
    setSelectedId(loaded[0]?.id ?? '')
    if (result.vault_path) setVaultPath(result.vault_path)
    setIsLocked(false)
    setOpenError('')
    setPassword('')
  }

  function unlockBrowserDemo() {
    setEntries(demoEntries)
    setSelectedId(demoEntries[0].id)
    setIsLocked(false)
    setOpenError('')
  }

  // Copie dans le presse-papier avec compte à rebours de sécurité (30s)
  async function copyToClipboard(text: string, key: string, label: string) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)

      // Démarre le décompte d'effacement automatique
      if (clipboardIntervalRef.current) {
        window.clearInterval(clipboardIntervalRef.current)
      }

      let count = 30
      setClipboardTimer({ active: true, secondsLeft: count, label })

      clipboardIntervalRef.current = window.setInterval(() => {
        count -= 1
        if (count <= 0) {
          clearClipboardImmediately()
        } else {
          setClipboardTimer({ active: true, secondsLeft: count, label })
        }
      }, 1000)
    } catch {
      // ignore
    }
  }

  function clearClipboardImmediately() {
    if (clipboardIntervalRef.current) {
      window.clearInterval(clipboardIntervalRef.current)
      clipboardIntervalRef.current = null
    }
    navigator.clipboard.writeText('').catch(() => {})
    setClipboardTimer({ active: true, secondsLeft: 0, label: 'Presse-papier sécurisé et vidé' })
    setTimeout(() => {
      setClipboardTimer({ active: false, secondsLeft: 0, label: '' })
    }, 2500)
  }

  // Ouvrir le répertoire du coffre dans l'explorateur
  async function openVaultDir() {
    await invoke('open_vault_directory').catch(() => {})
  }

  // Ouvrir le générateur autonome
  function openGeneratorModal() {
    const pwd = generatePasswordWithOptions(genConfig)
    setGeneratedPassword(pwd)
    setIsGeneratorOpen(true)
  }

  // Régénérer avec les paramètres actuels
  function regeneratePassword() {
    const pwd = generatePasswordWithOptions(genConfig)
    setGeneratedPassword(pwd)
  }

  // Enregistrer une nouvelle entrée
  async function handleCreateEntry(e: React.FormEvent) {
    e.preventDefault()
    if (!formTitle.trim()) return

    if (isBrowserMode) {
      const newEntry: VaultEntry = {
        id: `demo-${Date.now()}`,
        title: formTitle.trim(),
        username: formUsername.trim(),
        password: formPassword || undefined,
        url: formUrl.trim() || undefined,
        notes: formNotes.trim() || undefined,
        category: formCategory,
        favorite: formFavorite,
        updatedAt: "À l'instant",
      }
      setEntries([newEntry, ...entries])
      setSelectedId(newEntry.id)
      setIsAddEntryOpen(false)
      return
    }

    const created = await invoke<BackendVaultEntry>('create_vault_entry', {
      entry: {
        title: formTitle.trim(),
        username: formUsername.trim(),
        password: formPassword || null,
        url: formUrl.trim() || null,
        notes: formNotes.trim() || null,
        category: formCategory,
        favorite: formFavorite,
      },
    }).catch((err) => {
      alert(`Erreur lors de la création : ${err}`)
      return null
    })

    if (created) {
      const converted = fromBackendEntry(created)
      setEntries([converted, ...entries])
      setSelectedId(converted.id)
      setIsAddEntryOpen(false)
    }
  }

  // Ouvrir la modale d'édition
  function openEditModal(entry: VaultEntry) {
    setFormTitle(entry.title)
    setFormUsername(entry.username)
    setFormPassword(entry.password || '')
    setFormUrl(entry.url || '')
    setFormNotes(entry.notes || '')
    setFormCategory(entry.category)
    setFormFavorite(entry.favorite)
    setIsEditEntryOpen(true)
    setShowEntryMenu(false)
  }

  // Enregistrer les modifications
  async function handleUpdateEntry(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedEntry) return

    if (isBrowserMode) {
      const updated: VaultEntry = {
        ...selectedEntry,
        title: formTitle.trim(),
        username: formUsername.trim(),
        password: formPassword || undefined,
        url: formUrl.trim() || undefined,
        notes: formNotes.trim() || undefined,
        category: formCategory,
        favorite: formFavorite,
        updatedAt: "À l'instant",
      }
      setEntries(entries.map((item) => (item.id === updated.id ? updated : item)))
      setIsEditEntryOpen(false)
      return
    }

    const updated = await invoke<BackendVaultEntry>('update_vault_entry', {
      entry: {
        id: selectedEntry.id,
        title: formTitle.trim(),
        username: formUsername.trim(),
        password: formPassword || null,
        url: formUrl.trim() || null,
        notes: formNotes.trim() || null,
        category: formCategory,
        favorite: formFavorite,
      },
    }).catch((err) => {
      alert(`Erreur de modification : ${err}`)
      return null
    })

    if (updated) {
      const converted = fromBackendEntry(updated)
      setEntries(entries.map((item) => (item.id === converted.id ? converted : item)))
      setIsEditEntryOpen(false)
    }
  }

  // Basculer favori
  async function toggleFavorite(entry: VaultEntry) {
    const nextFav = !entry.favorite
    if (isBrowserMode) {
      setEntries(entries.map((e) => (e.id === entry.id ? { ...e, favorite: nextFav } : e)))
      return
    }

    const updated = await invoke<BackendVaultEntry>('update_vault_entry', {
      entry: {
        id: entry.id,
        title: entry.title,
        username: entry.username,
        password: entry.password || null,
        url: entry.url || null,
        notes: entry.notes || null,
        category: entry.category,
        favorite: nextFav,
      },
    }).catch(() => null)

    if (updated) {
      const converted = fromBackendEntry(updated)
      setEntries(entries.map((item) => (item.id === converted.id ? converted : item)))
    }
  }

  // Supprimer une entrée
  async function handleDeleteEntry(id: string) {
    if (!window.confirm('Voulez-vous vraiment supprimer cet identifiant ?')) return
    setShowEntryMenu(false)

    if (isBrowserMode) {
      const remaining = entries.filter((item) => item.id !== id)
      setEntries(remaining)
      setSelectedId(remaining[0]?.id ?? '')
      return
    }

    const ok = await invoke('delete_vault_entry', { id })
      .then(() => true)
      .catch((err) => {
        alert(`Erreur de suppression : ${err}`)
        return false
      })

    if (ok) {
      const remaining = entries.filter((item) => item.id !== id)
      setEntries(remaining)
      setSelectedId(remaining[0]?.id ?? '')
    }
  }

  // Changer mot de passe maître
  async function handleChangeMasterPassword(e: React.FormEvent) {
    e.preventDefault()
    setMasterPasswordMsg(null)
    if (!currentMasterPassword || !newMasterPassword) {
      setMasterPasswordMsg({ text: 'Veuillez remplir tous les champs.', error: true })
      return
    }
    if (newMasterPassword !== confirmMasterPassword) {
      setMasterPasswordMsg({ text: 'Les nouveaux mots de passe ne correspondent pas.', error: true })
      return
    }

    if (isBrowserMode) {
      setMasterPasswordMsg({ text: 'Mot de passe maître démo modifié avec succès.', error: false })
      setCurrentMasterPassword('')
      setNewMasterPassword('')
      setConfirmMasterPassword('')
      return
    }

    const res = await invoke('change_master_password', {
      currentPassword: currentMasterPassword,
      newPassword: newMasterPassword,
    })
      .then(() => ({ success: true, error: null }))
      .catch((err: unknown) => ({ success: false, error: typeof err === 'string' ? err : 'Erreur' }))

    if (res.success) {
      setMasterPasswordMsg({ text: 'Mot de passe maître mis à jour avec succès.', error: false })
      setCurrentMasterPassword('')
      setNewMasterPassword('')
      setConfirmMasterPassword('')
    } else {
      setMasterPasswordMsg({ text: res.error || 'Erreur lors du changement.', error: true })
    }
  }

  // Export JSON du coffre déchiffré
  function exportVaultBackup() {
    const exportData = {
      app: 'PassApp',
      version: '0.1.0',
      exported_at: new Date().toISOString(),
      entries_count: entries.length,
      entries: entries.map((e) => ({
        title: e.title,
        username: e.username,
        password: e.password || '',
        url: e.url || '',
        notes: e.notes || '',
        category: e.category,
        favorite: e.favorite,
      })),
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `passapp-backup-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  // Import JSON de sauvegarde
  async function handleImportJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const rawText = await file.text()
      const data = JSON.parse(rawText)
      const list = Array.isArray(data) ? data : data.entries
      if (!Array.isArray(list)) {
        alert('Format de fichier de sauvegarde invalide.')
        return
      }

      let importedCount = 0
      for (const item of list) {
        if (!item.title) continue
        if (isBrowserMode) {
          const entry: VaultEntry = {
            id: `demo-${Date.now()}-${Math.random()}`,
            title: item.title,
            username: item.username || '',
            password: item.password || undefined,
            url: item.url || undefined,
            notes: item.notes || undefined,
            category: item.category || 'Personnel',
            favorite: Boolean(item.favorite),
            updatedAt: "À l'instant",
          }
          setEntries((prev) => [entry, ...prev])
          importedCount++
        } else {
          await invoke('create_vault_entry', {
            entry: {
              title: item.title,
              username: item.username || '',
              password: item.password || null,
              url: item.url || null,
              notes: item.notes || null,
              category: item.category || 'Personnel',
              favorite: Boolean(item.favorite),
            },
          })
          importedCount++
        }
      }

      if (!isBrowserMode) {
        const refreshed = await invoke<BackendVaultEntry[]>('get_vault_entries')
        setEntries(refreshed.map(fromBackendEntry))
      }

      alert(`${importedCount} identifiants importés avec succès !`)
    } catch (err) {
      alert(`Erreur d'importation : ${err}`)
    }
  }

  // Évaluation du mot de passe en direct
  const selectedStrength = useMemo(
    () => evaluatePassword(selectedEntry?.password || ''),
    [selectedEntry?.password],
  )
  const formStrength = useMemo(() => evaluatePassword(formPassword), [formPassword])
  const generatorStrength = useMemo(() => evaluatePassword(generatedPassword), [generatedPassword])

  return (
    <main className="app-shell">
      {/* BARRE LATÉRALE */}
      <aside className="sidebar">
        <div className="brand-mark">
          <span>+</span> PassApp
        </div>

        {/* PROFIL UTILISATEUR & MENU */}
        <div
          className="profile-row clickable"
          onClick={() => setIsProfileOpen(true)}
          role="button"
          tabIndex={0}
          title="Ouvrir les paramètres et l'emplacement du coffre"
        >
          <div className="avatar">AM</div>
          <div>
            <strong>Alexandre Martin</strong>
            <small>Coffre local-first</small>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Ouvrir les paramètres"
            onClick={(e) => {
              e.stopPropagation()
              setIsProfileOpen(true)
            }}
          >
            ⚙️
          </button>
        </div>

        {/* NAVIGATION PAR CATÉGORIE AVEC COMPTEURS */}
        <nav aria-label="Catégories du coffre">
          <button
            className={activeFilter === 'all' ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => setActiveFilter('all')}
          >
            <span>▦</span> Mon coffre <b>{isLocked ? '—' : categoryCounts.all}</b>
          </button>
          <button
            className={activeFilter === 'favorites' ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => setActiveFilter('favorites')}
          >
            <span>★</span> Favoris <b>{isLocked ? '—' : categoryCounts.favorites}</b>
          </button>
          <div className="nav-divider" />
          <button
            className={activeFilter === 'Personnel' ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => setActiveFilter('Personnel')}
          >
            <span>👤</span> Personnel <b>{isLocked ? '—' : categoryCounts.Personnel}</b>
          </button>
          <button
            className={activeFilter === 'Travail' ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => setActiveFilter('Travail')}
          >
            <span>💼</span> Travail <b>{isLocked ? '—' : categoryCounts.Travail}</b>
          </button>
          <button
            className={activeFilter === 'Finance' ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => setActiveFilter('Finance')}
          >
            <span>💳</span> Finance <b>{isLocked ? '—' : categoryCounts.Finance}</b>
          </button>
        </nav>

        {/* PIED DE PAGE AVEC EMPLACEMENT DU COFFRE & STATUT */}
        <div className="sidebar-footer">
          <div className="footer-status">
            <span className={isLocked ? 'sync-dot locked' : 'sync-dot active'} />
            <span>
              {isLocked
                ? 'Coffre verrouillé'
                : storageLabel === 'browser-demo'
                ? 'Mode démo web'
                : 'Stockage chiffré'}
            </span>
          </div>
          {vaultPath && (
            <button
              className="vault-path-badge"
              type="button"
              onClick={openVaultDir}
              title="Cliquez pour révéler le fichier vault.passapp dans l'explorateur"
            >
              📁 Dossier coffre
            </button>
          )}
        </div>
      </aside>

      {/* ESPACE PRINCIPAL */}
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">ESPACE SÉCURISÉ LOCAL</p>
            <h1>
              {activeFilter === 'all'
                ? 'Mon coffre-fort'
                : activeFilter === 'favorites'
                ? 'Mes favoris'
                : activeFilter}
            </h1>
          </div>
          <div className="top-actions">
            {!isLocked && (
              <button
                className="secondary-top-button"
                type="button"
                onClick={openGeneratorModal}
                title="Générateur de mot de passe hautement sécurisé"
              >
                <span>🎲</span> Générateur
              </button>
            )}
            <button
              className={isLocked ? 'lock-button locked' : 'lock-button'}
              type="button"
              onClick={() => (isBrowserMode ? (isLocked ? unlockBrowserDemo() : toggleLock()) : void toggleLock())}
              title={isLocked ? 'Déverrouiller le coffre' : 'Verrouiller le coffre (Ctrl+L)'}
            >
              <span>{isLocked ? '🔒' : '🔓'}</span>
              {isLocked ? 'Déverrouiller' : 'Verrouiller'}
            </button>
            {!isLocked && (
              <button className="primary-button" type="button" onClick={openAddModal} title="Ajouter une entrée (Ctrl+N)">
                <span>+</span> Nouvelle entrée
              </button>
            )}
          </div>
        </header>

        <div className="content-grid">
          {/* PANNEAU DE GAUCHE : LISTE OU ÉCRAN VERROUILLÉ */}
          <section className="entry-panel" aria-label="Liste des entrées">
            {isLocked ? (
              <div className="panel-locked-notice">
                <div className="locked-badge-icon">🔒</div>
                <h3>Coffre verrouillé</h3>
                <p>Vos identifiants sont chiffrés et masqués pour votre sécurité.</p>
                <small>Saisissez votre mot de passe maître pour déchiffrer vos accès.</small>
              </div>
            ) : (
              <>
                <div className="search-box">
                  <span>⌕</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Rechercher (site, identifiant, notes...)"
                  />
                  {query ? (
                    <button className="clear-search-btn" type="button" onClick={() => setQuery('')}>
                      ✕
                    </button>
                  ) : (
                    <kbd>Ctrl F</kbd>
                  )}
                </div>

                {/* TRI & COMPTEUR */}
                <div className="section-label">
                  <span>
                    {visibleEntries.length} élément{visibleEntries.length > 1 ? 's' : ''}
                  </span>
                  <div className="sort-container">
                    <button
                      type="button"
                      className="sort-toggle-button"
                      aria-label="Trier les entrées"
                      onClick={() => setShowSortMenu(!showSortMenu)}
                      title="Changer l'ordre de tri"
                    >
                      <span>↕ Tri : </span>
                      <b>
                        {sortBy === 'title-asc'
                          ? 'A → Z'
                          : sortBy === 'title-desc'
                          ? 'Z → A'
                          : sortBy === 'category'
                          ? 'Catégorie'
                          : 'Récent'}
                      </b>
                    </button>
                    {showSortMenu && (
                      <div className="sort-menu-popup">
                        <button
                          type="button"
                          className={sortBy === 'title-asc' ? 'active' : ''}
                          onClick={() => {
                            setSortBy('title-asc')
                            setShowSortMenu(false)
                          }}
                        >
                          Nom (A → Z)
                        </button>
                        <button
                          type="button"
                          className={sortBy === 'title-desc' ? 'active' : ''}
                          onClick={() => {
                            setSortBy('title-desc')
                            setShowSortMenu(false)
                          }}
                        >
                          Nom (Z → A)
                        </button>
                        <button
                          type="button"
                          className={sortBy === 'category' ? 'active' : ''}
                          onClick={() => {
                            setSortBy('category')
                            setShowSortMenu(false)
                          }}
                        >
                          Catégorie
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* LISTE DES ENTRÉES */}
                <div className="entry-list">
                  {visibleEntries.map((entry) => (
                    <button
                      className={entry.id === selectedEntry?.id ? 'entry-row selected' : 'entry-row'}
                      type="button"
                      key={entry.id}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <span className={`entry-icon ${entry.category.toLowerCase()}`}>
                        {entry.title.charAt(0).toUpperCase()}
                      </span>
                      <span className="entry-copy">
                        <strong>{entry.title}</strong>
                        <small>{entry.username}</small>
                      </span>
                      <span
                        className="entry-star"
                        onClick={(e) => {
                          e.stopPropagation()
                          void toggleFavorite(entry)
                        }}
                        title={entry.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                      >
                        {entry.favorite ? '★' : '☆'}
                      </span>
                    </button>
                  ))}
                  {!visibleEntries.length && (
                    <p className="empty-state">
                      {query ? 'Aucun résultat correspondant.' : 'Aucun identifiant dans cette catégorie.'}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>

          {/* PANNEAU DE DROITE : DÉTAILS DE L'ENTRÉE OU FORMULAIRE DE DÉVERROUILLAGE */}
          <section className="detail-panel" aria-label="Détails de l'entrée sélectionnée">
            {isLocked ? (
              <div className="locked-state">
                <div className="lock-symbol">🔒</div>
                <h2>Coffre verrouillé</h2>
                <p>
                  {isBrowserMode
                    ? 'Mode navigateur démo : déverrouillez pour explorer les données locales.'
                    : 'Saisissez votre mot de passe maître pour déchiffrer votre coffre.'}
                </p>
                {isBrowserMode ? (
                  <button className="primary-button" type="button" onClick={unlockBrowserDemo}>
                    Déverrouiller la démo
                  </button>
                ) : (
                  <div className="unlock-form">
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void openVault()
                      }}
                      placeholder="Mot de passe maître"
                      autoFocus
                    />
                    <button className="primary-button" type="button" onClick={() => void openVault()}>
                      Ouvrir le coffre
                    </button>
                    {openError && <p className="form-error">{openError}</p>}
                  </div>
                )}
              </div>
            ) : selectedEntry ? (
              <>
                <div className="detail-heading">
                  <div className={`large-entry-icon ${selectedEntry.category.toLowerCase()}`}>
                    {selectedEntry.title.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="eyebrow">{selectedEntry.category.toUpperCase()}</p>
                    <h2>{selectedEntry.title}</h2>
                    <p>Dernière modification : {selectedEntry.updatedAt}</p>
                  </div>

                  {/* BOUTON ACTIONS D'ENTRÉE "..." */}
                  <div className="entry-actions-container">
                    <button
                      className="icon-button menu-trigger"
                      type="button"
                      aria-label="Plus d'options"
                      onClick={() => setShowEntryMenu(!showEntryMenu)}
                      title="Options de l'entrée"
                    >
                      ...
                    </button>
                    {showEntryMenu && (
                      <div className="dropdown-menu">
                        <button type="button" onClick={() => openEditModal(selectedEntry)}>
                          ✏️ Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void toggleFavorite(selectedEntry)
                            setShowEntryMenu(false)
                          }}
                        >
                          {selectedEntry.favorite ? '☆ Retirer des favoris' : '★ Ajouter aux favoris'}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void handleDeleteEntry(selectedEntry.id)}
                        >
                          🗑️ Supprimer
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* CHAMP IDENTIFIANT */}
                <div className="field-group">
                  <label>Identifiant / Nom d'utilisateur</label>
                  <div className="secret-field">
                    <span>{selectedEntry.username}</span>
                    <button
                      type="button"
                      aria-label="Copier l'identifiant"
                      onClick={() => void copyToClipboard(selectedEntry.username, 'username', 'Identifiant')}
                      title="Copier"
                    >
                      {copiedKey === 'username' ? '✓ Copié !' : '📋 Copier'}
                    </button>
                  </div>
                </div>

                {/* CHAMP MOT DE PASSE AVEC ANALYSE DE FORCE */}
                <div className="field-group">
                  <label>Mot de passe</label>
                  <div className="secret-field">
                    <span className="password-display">
                      {selectedEntry.password
                        ? showPassword
                          ? selectedEntry.password
                          : '••••••••••••••••'
                        : '••••••••••••'}
                    </span>
                    <div className="field-actions">
                      {selectedEntry.password && (
                        <button
                          type="button"
                          className="reveal-button"
                          onClick={() => setShowPassword(!showPassword)}
                          title={showPassword ? 'Masquer' : 'Afficher'}
                        >
                          {showPassword ? '🙈' : '👁️'}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Copier le mot de passe"
                        onClick={() =>
                          void copyToClipboard(selectedEntry.password || '', 'password', 'Mot de passe')
                        }
                        title="Copier le mot de passe avec effacement auto dans 30s"
                      >
                        {copiedKey === 'password' ? '✓ Copié !' : '📋 Copier'}
                      </button>
                    </div>
                  </div>

                  {/* INDICATEUR DE FORCE DU MOT DE PASSE */}
                  {selectedEntry.password && (
                    <div className="strength-container">
                      <div className="strength-bars">
                        {[1, 2, 3, 4].map((step) => (
                          <div
                            key={step}
                            className={`strength-bar-step ${
                              step <= selectedStrength.score ? 'active' : ''
                            }`}
                            style={{
                              backgroundColor:
                                step <= selectedStrength.score ? selectedStrength.color : undefined,
                            }}
                          />
                        ))}
                      </div>
                      <div className="strength-meta">
                        <span style={{ color: selectedStrength.color, fontWeight: 600 }}>
                          Robustesse : {selectedStrength.label}
                        </span>
                        <span className="entropy-tag">{selectedStrength.entropyBits} bits d'entropie</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* CHAMP URL */}
                {selectedEntry.url && (
                  <div className="field-group">
                    <label>Adresse du site / URL</label>
                    <div className="secret-field">
                      <a href={selectedEntry.url} target="_blank" rel="noreferrer" className="site-link">
                        {selectedEntry.url} ↗
                      </a>
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(selectedEntry.url || '', 'url', 'URL')}
                        title="Copier l'URL"
                      >
                        {copiedKey === 'url' ? '✓ Copié !' : '📋 Copier'}
                      </button>
                    </div>
                  </div>
                )}

                {/* CHAMP NOTES */}
                {selectedEntry.notes && (
                  <div className="field-group">
                    <label>Notes confidentielles</label>
                    <div className="secret-field notes-field">
                      <p>{selectedEntry.notes}</p>
                    </div>
                  </div>
                )}

                <div className="detail-note">
                  <span>🛡️</span>
                  <div>
                    <strong>Chiffrement de bout en bout & Sécurité maximale</strong>
                    <p>
                      Vos identifiants sont chiffrés avec <b>Argon2id</b> et <b>AES-256-GCM</b>. Le presse-papier
                      est vidé automatiquement après chaque copie pour prévenir les fuites de données.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="empty-state">Sélectionnez une entrée ou créez-en une nouvelle.</p>
            )}
          </section>
        </div>
      </section>

      {/* TOAST FLOTTANT DU PRESSE-PAPIER AUTO-NETTOYANT */}
      {clipboardTimer.active && (
        <div className="clipboard-toast">
          <div className="toast-content">
            <span className="toast-icon">🔐</span>
            <div>
              <strong>{clipboardTimer.label} copié !</strong>
              <p>
                {clipboardTimer.secondsLeft > 0
                  ? `Effacement automatique dans ${clipboardTimer.secondsLeft} s`
                  : 'Presse-papier sécurisé et vidé.'}
              </p>
            </div>
          </div>
          {clipboardTimer.secondsLeft > 0 && (
            <button
              className="toast-clear-button"
              type="button"
              onClick={clearClipboardImmediately}
              title="Vider le presse-papier immédiatement"
            >
              Vider maintenant
            </button>
          )}
        </div>
      )}

      {/* MODALE DU GÉNÉRATEUR AUTONOME */}
      {isGeneratorOpen && (
        <div className="modal-backdrop" onClick={() => setIsGeneratorOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🎲 Générateur de mot de passe fort</h2>
              <button className="close-button" type="button" onClick={() => setIsGeneratorOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="generator-preview-box">
                <span className="generator-password-text">{generatedPassword}</span>
                <div className="generator-preview-actions">
                  <button
                    type="button"
                    className="icon-action-btn"
                    onClick={regeneratePassword}
                    title="Régénérer"
                  >
                    🔄
                  </button>
                  <button
                    type="button"
                    className="primary-btn-sm"
                    onClick={() => void copyToClipboard(generatedPassword, 'genpwd', 'Mot de passe')}
                  >
                    {copiedKey === 'genpwd' ? '✓ Copié !' : '📋 Copier'}
                  </button>
                </div>
              </div>

              {/* BARRE DE ROBUSTESSE */}
              <div className="strength-container">
                <div className="strength-bars">
                  {[1, 2, 3, 4].map((step) => (
                    <div
                      key={step}
                      className={`strength-bar-step ${step <= generatorStrength.score ? 'active' : ''}`}
                      style={{
                        backgroundColor:
                          step <= generatorStrength.score ? generatorStrength.color : undefined,
                      }}
                    />
                  ))}
                </div>
                <div className="strength-meta">
                  <span style={{ color: generatorStrength.color, fontWeight: 600 }}>
                    Robustesse : {generatorStrength.label}
                  </span>
                  <span className="entropy-tag">{generatorStrength.entropyBits} bits d'entropie</span>
                </div>
              </div>

              {/* OPTIONS DU GÉNÉRATEUR */}
              <div className="generator-options-grid">
                <label className="slider-label">
                  <span>Longueur : <b>{genConfig.length} caractères</b></span>
                  <input
                    type="range"
                    min={8}
                    max={48}
                    value={genConfig.length}
                    onChange={(e) => {
                      const next = { ...genConfig, length: Number(e.target.value) }
                      setGenConfig(next)
                      setGeneratedPassword(generatePasswordWithOptions(next))
                    }}
                  />
                </label>

                <div className="generator-checkboxes">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={genConfig.includeUpper}
                      onChange={(e) => {
                        const next = { ...genConfig, includeUpper: e.target.checked }
                        setGenConfig(next)
                        setGeneratedPassword(generatePasswordWithOptions(next))
                      }}
                    />
                    <span>Majuscules (A-Z)</span>
                  </label>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={genConfig.includeLower}
                      onChange={(e) => {
                        const next = { ...genConfig, includeLower: e.target.checked }
                        setGenConfig(next)
                        setGeneratedPassword(generatePasswordWithOptions(next))
                      }}
                    />
                    <span>Minuscules (a-z)</span>
                  </label>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={genConfig.includeDigits}
                      onChange={(e) => {
                        const next = { ...genConfig, includeDigits: e.target.checked }
                        setGenConfig(next)
                        setGeneratedPassword(generatePasswordWithOptions(next))
                      }}
                    />
                    <span>Chiffres (0-9)</span>
                  </label>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={genConfig.includeSymbols}
                      onChange={(e) => {
                        const next = { ...genConfig, includeSymbols: e.target.checked }
                        setGenConfig(next)
                        setGeneratedPassword(generatePasswordWithOptions(next))
                      }}
                    />
                    <span>Symboles spéciaux (!@#$%)</span>
                  </label>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={genConfig.excludeAmbiguous}
                      onChange={(e) => {
                        const next = { ...genConfig, excludeAmbiguous: e.target.checked }
                        setGenConfig(next)
                        setGeneratedPassword(generatePasswordWithOptions(next))
                      }}
                    />
                    <span>Éviter les caractères ambigus (0, O, 1, l, I)</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="primary-button" type="button" onClick={() => setIsGeneratorOpen(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE DU PROFIL & PARAMÈTRES DU COFFRE */}
      {isProfileOpen && (
        <div className="modal-backdrop" onClick={() => setIsProfileOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Profil & Paramètres du Coffre</h2>
              <button className="close-button" type="button" onClick={() => setIsProfileOpen(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="profile-summary">
                <div className="avatar large">AM</div>
                <div>
                  <h3>Alexandre Martin</h3>
                  <p>Profil propriétaire (Local-First)</p>
                  <span className="badge">{isLocked ? '🔒 Coffre verrouillé' : '🔓 Coffre déverrouillé'}</span>
                </div>
              </div>

              {/* VERROUILLAGE AUTOMATIQUE PAR INACTIVITÉ */}
              <div className="info-section">
                <h4>Verrouillage automatique</h4>
                <p className="info-desc">
                  Pour votre sécurité, le coffre se reverrouille automatiquement en cas d'inactivité.
                </p>
                <label className="select-label">
                  <span>Délai d'inactivité :</span>
                  <select
                    value={autoLockMinutes}
                    onChange={(e) => setAutoLockMinutes(Number(e.target.value))}
                  >
                    <option value={2}>2 minutes</option>
                    <option value={5}>5 minutes (recommandé)</option>
                    <option value={15}>15 minutes</option>
                    <option value={0}>Désactivé (déconseillé)</option>
                  </select>
                </label>
              </div>

              {/* SAUVEGARDE, EXPORT & IMPORT */}
              <div className="info-section">
                <h4>Sauvegardes & Données</h4>
                <p className="info-desc">
                  Exportez une copie de sauvegarde ou importez des identifiants au format JSON.
                </p>
                <div className="backup-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={exportVaultBackup}
                    disabled={isLocked}
                    title={isLocked ? 'Déverrouillez le coffre pour exporter' : 'Exporter la sauvegarde'}
                  >
                    📥 Exporter la sauvegarde (JSON)
                  </button>
                  <label className={`secondary-btn file-input-label ${isLocked ? 'disabled' : ''}`}>
                    📤 Importer une sauvegarde (JSON)
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => void handleImportJson(e)}
                      disabled={isLocked}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>

              {/* EMPLACEMENT DU FICHIER COFFRE */}
              <div className="info-section">
                <h4>Emplacement du coffre-fort</h4>
                <p className="info-desc">
                  Fichier physique chiffré contenant l'ensemble de vos secrets.
                </p>
                <div className="path-box">
                  <code>{vaultPath || 'vault.passapp'}</code>
                  <div className="path-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => void copyToClipboard(vaultPath, 'vaultpath', 'Chemin')}
                    >
                      {copiedKey === 'vaultpath' ? '✓ Chemin copié' : '📋 Copier le chemin'}
                    </button>
                    <button type="button" className="primary-btn-sm" onClick={openVaultDir}>
                      📁 Ouvrir dans l'explorateur
                    </button>
                  </div>
                </div>
              </div>

              {/* SÉCURITÉ CRYPTOGRAPHIQUE */}
              <div className="info-section">
                <h4>Spécifications de sécurité</h4>
                <ul className="security-specs-list">
                  <li>
                    <strong>Dérivation de clé (KDF) :</strong> Argon2id (19 Mo mémoire, 2 itérations, sel 16 octets)
                  </li>
                  <li>
                    <strong>Chiffrement symétrique :</strong> AES-256-GCM avec tag d'intégrité MAC 128 bits
                  </li>
                  <li>
                    <strong>Isolation mémoire :</strong> Écrasement immédiat des clés (Zeroize) dès le verrouillage
                  </li>
                  <li>
                    <strong>Protection presse-papier :</strong> Vidage automatique programmable (30s)
                  </li>
                  <li>
                    <strong>Historique :</strong> Rétention automatique des 3 dernières itérations (<code>.bak1</code>, <code>.bak2</code>, <code>.bak3</code>)
                  </li>
                </ul>
              </div>

              {/* CHANGEMENT DU MOT DE PASSE MAÎTRE */}
              {!isLocked && (
                <div className="info-section">
                  <h4>Changer le mot de passe maître</h4>
                  <form onSubmit={(e) => void handleChangeMasterPassword(e)} className="password-change-form">
                    <input
                      type="password"
                      placeholder="Mot de passe maître actuel"
                      value={currentMasterPassword}
                      onChange={(e) => setCurrentMasterPassword(e.target.value)}
                    />
                    <input
                      type="password"
                      placeholder="Nouveau mot de passe maître"
                      value={newMasterPassword}
                      onChange={(e) => setNewMasterPassword(e.target.value)}
                    />
                    <input
                      type="password"
                      placeholder="Confirmer le nouveau mot de passe"
                      value={confirmMasterPassword}
                      onChange={(e) => setConfirmMasterPassword(e.target.value)}
                    />
                    <button type="submit" className="primary-btn-sm">
                      Mettre à jour le mot de passe maître
                    </button>
                    {masterPasswordMsg && (
                      <p className={masterPasswordMsg.error ? 'form-error' : 'form-success'}>
                        {masterPasswordMsg.text}
                      </p>
                    )}
                  </form>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="primary-button" type="button" onClick={() => setIsProfileOpen(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE D'AJOUT D'ENTRÉE */}
      {isAddEntryOpen && (
        <div className="modal-backdrop" onClick={() => setIsAddEntryOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nouvelle entrée</h2>
              <button className="close-button" type="button" onClick={() => setIsAddEntryOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={(e) => void handleCreateEntry(e)}>
              <div className="modal-body form-grid">
                <label>
                  Titre du site ou service *
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="ex: GitHub, Google, Banque..."
                    autoFocus
                  />
                </label>

                <label>
                  Identifiant / Email / Pseudo
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    placeholder="ex: alexandre@exemple.fr"
                  />
                </label>

                <label>
                  Mot de passe
                  <div className="password-input-row">
                    <input
                      type="text"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="Mot de passe"
                    />
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setFormPassword(generatePasswordWithOptions(genConfig))}
                      title="Générer un mot de passe aléatoire fort"
                    >
                      🎲 Générer
                    </button>
                  </div>
                </label>

                {/* ANALYSE EN DIRECT DE LA FORCE DU MOT DE PASSE */}
                {formPassword && (
                  <div className="strength-container form-strength">
                    <div className="strength-bars">
                      {[1, 2, 3, 4].map((step) => (
                        <div
                          key={step}
                          className={`strength-bar-step ${step <= formStrength.score ? 'active' : ''}`}
                          style={{
                            backgroundColor: step <= formStrength.score ? formStrength.color : undefined,
                          }}
                        />
                      ))}
                    </div>
                    <div className="strength-meta">
                      <span style={{ color: formStrength.color, fontWeight: 600 }}>
                        {formStrength.label} ({formStrength.entropyBits} bits)
                      </span>
                      {formStrength.tips.length > 0 && (
                        <small className="strength-hint">{formStrength.tips[0]}</small>
                      )}
                    </div>
                  </div>
                )}

                <label>
                  Catégorie
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as 'Personnel' | 'Travail' | 'Finance')}
                  >
                    <option value="Personnel">Personnel</option>
                    <option value="Travail">Travail</option>
                    <option value="Finance">Finance</option>
                  </select>
                </label>

                <label>
                  Adresse URL (optionnel)
                  <input
                    type="url"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </label>

                <label>
                  Notes complémentaires (optionnel)
                  <textarea
                    rows={3}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Notes sécurisées..."
                  />
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={formFavorite}
                    onChange={(e) => setFormFavorite(e.target.checked)}
                  />
                  <span>Ajouter immédiatement aux favoris</span>
                </label>
              </div>

              <div className="modal-footer">
                <button type="button" className="lock-button" onClick={() => setIsAddEntryOpen(false)}>
                  Annuler
                </button>
                <button type="submit" className="primary-button">
                  Enregistrer dans le coffre
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE D'ÉDITION D'ENTRÉE */}
      {isEditEntryOpen && (
        <div className="modal-backdrop" onClick={() => setIsEditEntryOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Modifier l'entrée</h2>
              <button className="close-button" type="button" onClick={() => setIsEditEntryOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={(e) => void handleUpdateEntry(e)}>
              <div className="modal-body form-grid">
                <label>
                  Titre du site ou service *
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                  />
                </label>

                <label>
                  Identifiant / Email / Pseudo
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                  />
                </label>

                <label>
                  Mot de passe
                  <div className="password-input-row">
                    <input
                      type="text"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setFormPassword(generatePasswordWithOptions(genConfig))}
                      title="Générer un mot de passe fort"
                    >
                      🎲 Générer
                    </button>
                  </div>
                </label>

                {/* ANALYSE EN DIRECT DE LA FORCE DU MOT DE PASSE */}
                {formPassword && (
                  <div className="strength-container form-strength">
                    <div className="strength-bars">
                      {[1, 2, 3, 4].map((step) => (
                        <div
                          key={step}
                          className={`strength-bar-step ${step <= formStrength.score ? 'active' : ''}`}
                          style={{
                            backgroundColor: step <= formStrength.score ? formStrength.color : undefined,
                          }}
                        />
                      ))}
                    </div>
                    <div className="strength-meta">
                      <span style={{ color: formStrength.color, fontWeight: 600 }}>
                        {formStrength.label} ({formStrength.entropyBits} bits)
                      </span>
                      {formStrength.tips.length > 0 && (
                        <small className="strength-hint">{formStrength.tips[0]}</small>
                      )}
                    </div>
                  </div>
                )}

                <label>
                  Catégorie
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as 'Personnel' | 'Travail' | 'Finance')}
                  >
                    <option value="Personnel">Personnel</option>
                    <option value="Travail">Travail</option>
                    <option value="Finance">Finance</option>
                  </select>
                </label>

                <label>
                  Adresse URL
                  <input
                    type="url"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                  />
                </label>

                <label>
                  Notes complémentaires
                  <textarea
                    rows={3}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                  />
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={formFavorite}
                    onChange={(e) => setFormFavorite(e.target.checked)}
                  />
                  <span>Favori</span>
                </label>
              </div>

              <div className="modal-footer">
                <button type="button" className="lock-button" onClick={() => setIsEditEntryOpen(false)}>
                  Annuler
                </button>
                <button type="submit" className="primary-button">
                  Enregistrer les modifications
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
