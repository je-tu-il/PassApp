import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type VaultEntry } from './contracts'
import { generateTotpCode, getTotpRemainingSeconds, parseOtpAuthUri } from './totp'
import { parseUniversalImport, type ImportedItem } from './importer'
import './App.css'

type AppStatus = {
  vault_locked: boolean
  vault_exists: boolean
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
  totp_secret?: string | null
  category: string
  favorite: boolean
  updated_at: number
}

type OpenVaultResult = {
  vault_locked: boolean
  entries: BackendVaultEntry[]
  vault_path?: string | null
}

type CloudSyncPreset = {
  id: string
  name: string
  service: string
  path: string
  exists: boolean
  description: string
}

type SortOption = 'title-asc' | 'title-desc' | 'category' | 'recent'
type ActiveFilter = 'all' | 'favorites' | 'totp' | 'Personnel' | 'Travail' | 'Finance'
type AccentColor = 'emerald' | 'amber' | 'sapphire' | 'amethyst' | 'ruby'
type ThemeMode = 'dark' | 'light'

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

const WORD_POOL = [
  'aurore', 'bastion', 'boussole', 'cristal', 'diamant', 'eclat',
  'etoile', 'flamme', 'horizon', 'miroir', 'navire', 'ombre',
  'oracle', 'refuge', 'sentier', 'silence', 'sommet', 'titan',
  'vallee', 'vigie', 'zodiaque', 'zenith', 'comete', 'faucon',
]

function fromBackendEntry(entry: BackendVaultEntry): VaultEntry {
  let formatted = 'Enregistré'
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
    totpSecret: entry.totp_secret || undefined,
    category: (entry.category as 'Finance' | 'Travail' | 'Personnel') || 'Personnel',
    favorite: entry.favorite,
    updatedAt: formatted,
  }
}

function evaluatePassword(pwd: string): PasswordStrength {
  if (!pwd) {
    return {
      score: 0,
      entropyBits: 0,
      label: 'Vide',
      color: '#8c9590',
      tips: ['Saisissez un mot de passe pour analyser sa force'],
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
  if (pwd.length < 12) tips.push('Longueur recommandée ≥ 14')

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
  // Personnalisation : Thème & Couleur d'accent
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('passapp_theme') as ThemeMode) || 'dark'
  })
  const [accentColor, setAccentColor] = useState<AccentColor>(() => {
    return (localStorage.getItem('passapp_accent') as AccentColor) || 'emerald'
  })

  // Initialisation du coffre & Onboarding
  const [vaultExists, setVaultExists] = useState<boolean>(true)
  const [onboardingStep, setOnboardingStep] = useState<number>(1)
  const [recoveryWords, setRecoveryWords] = useState<string[]>([])
  const [copiedRecovery, setCopiedRecovery] = useState<boolean>(false)
  const [onboardingMasterPassword, setOnboardingMasterPassword] = useState('')
  const [onboardingConfirmPassword, setOnboardingConfirmPassword] = useState('')

  // État du coffre
  const [isLocked, setIsLocked] = useState(true)
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [storageLabel, setStorageLabel] = useState('encrypted-local')
  const [vaultPath, setVaultPath] = useState<string>('')
  const [password, setPassword] = useState('')
  const [openError, setOpenError] = useState('')
  const [isBrowserMode, setIsBrowserMode] = useState(false)

  // Navigation & Filtres
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('title-asc')
  const [showSortMenu, setShowSortMenu] = useState(false)

  // Actions & Presse-papier
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showEntryMenu, setShowEntryMenu] = useState(false)

  // Toast auto-nettoyant
  const [clipboardTimer, setClipboardTimer] = useState<{ active: boolean; secondsLeft: number; label: string }>({
    active: false,
    secondsLeft: 0,
    label: '',
  })
  const clipboardIntervalRef = useRef<number | null>(null)

  // Inactivité
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(5)
  const lastActivityRef = useRef<number>(Date.now())

  // Modales
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isAddEntryOpen, setIsAddEntryOpen] = useState(false)
  const [isEditEntryOpen, setIsEditEntryOpen] = useState(false)
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)

  // TOTP Authenticator en direct
  const [totpCodes, setTotpCodes] = useState<Record<string, string>>({})
  const [totpCountdown, setTotpCountdown] = useState<number>(30)

  // Synchronisation Multi-appareils
  const [syncFilePath, setSyncFilePath] = useState<string>(() => {
    return localStorage.getItem('passapp_sync_file_path') || ''
  })
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(() => {
    return localStorage.getItem('passapp_last_sync_time') || null
  })
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const [cloudPresets, setCloudPresets] = useState<CloudSyncPreset[]>([])
  const [isLoadingPresets, setIsLoadingPresets] = useState(false)

  // Importation universelle
  const [importRawText, setImportRawText] = useState('')
  const [parsedImport, setParsedImport] = useState<{ format: string; items: ImportedItem[] } | null>(null)
  const [isImporting, setIsImporting] = useState(false)

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
  const [formTotpSecret, setFormTotpSecret] = useState('')
  const [formCategory, setFormCategory] = useState<'Personnel' | 'Travail' | 'Finance'>('Personnel')
  const [formFavorite, setFormFavorite] = useState(false)

  // Changement de mot de passe
  const [currentMasterPassword, setCurrentMasterPassword] = useState('')
  const [newMasterPassword, setNewMasterPassword] = useState('')
  const [confirmMasterPassword, setConfirmMasterPassword] = useState('')
  const [masterPasswordMsg, setMasterPasswordMsg] = useState<{ text: string; error: boolean } | null>(null)

  // Application des variables de thème et d'accent
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode)
    document.documentElement.setAttribute('data-accent', accentColor)
    localStorage.setItem('passapp_theme', themeMode)
    localStorage.setItem('passapp_accent', accentColor)
  }, [themeMode, accentColor])

  // Détection du statut du coffre
  useEffect(() => {
    invoke<AppStatus>('get_app_status')
      .then(async (status) => {
        setVaultExists(status.vault_exists)
        setIsLocked(status.vault_locked)
        setStorageLabel(status.storage)
        if (status.vault_path) setVaultPath(status.vault_path)
        setIsBrowserMode(false)

        if (!status.vault_exists) {
          // Premier lancement : préparer la phrase de récupération
          initRecoveryWords()
          return
        }

        if (status.vault_locked) {
          setEntries([])
          setSelectedId('')
          return
        }

        const backendEntries = await invoke<BackendVaultEntry[]>('get_vault_entries')
        const loaded = backendEntries.map(fromBackendEntry)
        setEntries(loaded)
        if (loaded.length > 0) setSelectedId(loaded[0].id)
      })
      .catch(() => {
        // Mode démo navigateur
        setIsBrowserMode(true)
        const initialized = localStorage.getItem('passapp_browser_vault_initialized') === 'true'
        setVaultExists(initialized)
        if (!initialized) {
          initRecoveryWords()
        }
        setIsLocked(true)
        setStorageLabel('browser-demo')
        setVaultPath('vault.passapp (mode navigateur)')
        setEntries([])
        setSelectedId('')
      })
  }, [])

  function initRecoveryWords() {
    const shuffled = [...WORD_POOL].sort(() => 0.5 - Math.random())
    setRecoveryWords(shuffled.slice(0, 12))
  }

  // Décompte par catégorie
  const categoryCounts = useMemo(() => {
    return {
      all: entries.length,
      favorites: entries.filter((e) => e.favorite).length,
      totp: entries.filter((e) => Boolean(e.totpSecret)).length,
      Personnel: entries.filter((e) => e.category === 'Personnel').length,
      Travail: entries.filter((e) => e.category === 'Travail').length,
      Finance: entries.filter((e) => e.category === 'Finance').length,
    }
  }, [entries])

  // Mise à jour continue des codes TOTP 2FA (toutes les secondes)
  useEffect(() => {
    const updateTotp = async () => {
      const remaining = getTotpRemainingSeconds()
      setTotpCountdown(remaining)

      const totpEntries = entries.filter((e) => Boolean(e.totpSecret))
      if (totpEntries.length > 0) {
        const nextCodes: Record<string, string> = {}
        for (const entry of totpEntries) {
          if (entry.totpSecret) {
            nextCodes[entry.id] = await generateTotpCode(entry.totpSecret)
          }
        }
        setTotpCodes(nextCodes)
      }
    }

    void updateTotp()
    const timer = setInterval(() => {
      void updateTotp()
    }, 1000)

    return () => clearInterval(timer)
  }, [entries])

  // Verrouillage du coffre
  async function toggleLock() {
    const nextLocked = !isLocked
    const status = await invoke<AppStatus>('set_vault_locked', { locked: nextLocked }).catch(() => ({
      vault_locked: nextLocked,
      vault_exists: true,
      storage: 'browser-demo',
      vault_path: null,
    }))
    setIsLocked(status.vault_locked)
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

  function openAddModal() {
    setFormTitle('')
    setFormUsername('')
    setFormPassword(generatePasswordWithOptions(genConfig))
    setFormUrl('')
    setFormNotes('')
    setFormTotpSecret('')
    setFormCategory('Personnel')
    setFormFavorite(false)
    setIsAddEntryOpen(true)
  }

  const toggleLockRef = useRef(toggleLock)
  toggleLockRef.current = toggleLock
  const openAddModalRef = useRef(openAddModal)
  openAddModalRef.current = openAddModal

  // Inactivité
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

  // Raccourcis clavier
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

  // Filtrage et Tri
  const visibleEntries = useMemo(() => {
    if (isLocked) return []
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = entries.filter((entry) => {
      let matchesFilter = true
      if (activeFilter === 'favorites') {
        matchesFilter = entry.favorite
      } else if (activeFilter === 'totp') {
        matchesFilter = Boolean(entry.totpSecret)
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

  // Déverrouillage d'un coffre existant
  async function openVault() {
    if (!password) {
      setOpenError('Saisissez votre mot de passe maître.')
      return
    }
    if (isBrowserMode) {
      setIsLocked(false)
      setOpenError('')
      setPassword('')
      return
    }

    const result = await invoke<OpenVaultResult>('open_vault', { password }).catch((error: unknown) => {
      setOpenError(typeof error === 'string' ? error : "Mot de passe incorrect ou coffre altéré.")
      return undefined
    })
    if (!result) return

    const loaded = result.entries.map(fromBackendEntry)
    setEntries(loaded)
    if (loaded.length > 0) setSelectedId(loaded[0].id)
    if (result.vault_path) setVaultPath(result.vault_path)
    setIsLocked(false)
    setOpenError('')
    setPassword('')
  }

  // Création initiale du coffre (Onboarding)
  async function completeInitialSetup() {
    if (onboardingMasterPassword.length < 8) {
      alert('Le mot de passe maître doit comporter au moins 8 caractères.')
      return
    }
    if (onboardingMasterPassword !== onboardingConfirmPassword) {
      alert('Les mots de passe ne correspondent pas.')
      return
    }

    if (isBrowserMode) {
      localStorage.setItem('passapp_browser_vault_initialized', 'true')
      // Règle Zero-Knowledge : Ne JAMAIS conserver la phrase de récupération sur le disque
      localStorage.removeItem('passapp_recovery_phrase')
      setRecoveryWords([])
      setVaultExists(true)
      setIsLocked(false)
      setEntries([])
      return
    }

    const result = await invoke<OpenVaultResult>('create_initial_vault', {
      password: onboardingMasterPassword,
    }).catch((err: unknown) => {
      alert(`Erreur d'initialisation : ${err}`)
      return null
    })

    if (result) {
      // Règle Zero-Knowledge : Ne JAMAIS conserver la phrase de récupération sur le disque
      localStorage.removeItem('passapp_recovery_phrase')
      setRecoveryWords([])
      setVaultExists(true)
      setIsLocked(false)
      setEntries([])
      if (result.vault_path) setVaultPath(result.vault_path)
    }
  }

  // Copie dans le presse-papier avec auto-nettoyage (30s)
  async function copyToClipboard(text: string, key: string, label: string) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)

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

  // Ouvrir dossier coffre
  async function openVaultDir() {
    await invoke('open_vault_directory').catch(() => {})
  }

  // Générateur
  function openGeneratorModal() {
    const pwd = generatePasswordWithOptions(genConfig)
    setGeneratedPassword(pwd)
    setIsGeneratorOpen(true)
  }

  function regeneratePassword() {
    const pwd = generatePasswordWithOptions(genConfig)
    setGeneratedPassword(pwd)
  }

  // Création d'entrée
  async function handleCreateEntry(e: React.FormEvent) {
    e.preventDefault()
    if (!formTitle.trim()) return

    if (isBrowserMode) {
      const newEntry: VaultEntry = {
        id: `entry-${Date.now()}`,
        title: formTitle.trim(),
        username: formUsername.trim(),
        password: formPassword || undefined,
        url: formUrl.trim() || undefined,
        notes: formNotes.trim() || undefined,
        totpSecret: formTotpSecret.trim() || undefined,
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
        totp_secret: formTotpSecret.trim() || null,
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

  // Édition d'entrée
  function openEditModal(entry: VaultEntry) {
    setFormTitle(entry.title)
    setFormUsername(entry.username)
    setFormPassword(entry.password || '')
    setFormUrl(entry.url || '')
    setFormNotes(entry.notes || '')
    setFormTotpSecret(entry.totpSecret || '')
    setFormCategory(entry.category)
    setFormFavorite(entry.favorite)
    setIsEditEntryOpen(true)
    setShowEntryMenu(false)
  }

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
        totpSecret: formTotpSecret.trim() || undefined,
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
        totp_secret: formTotpSecret.trim() || null,
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
        totp_secret: entry.totpSecret || null,
        category: entry.category,
        favorite: nextFav,
      },
    }).catch(() => null)

    if (updated) {
      const converted = fromBackendEntry(updated)
      setEntries(entries.map((item) => (item.id === converted.id ? converted : item)))
    }
  }

  // Synchronisation multi-appareils (Local-First CRDT)
  async function handleSyncWithFile() {
    if (!syncFilePath.trim()) {
      setSyncFeedback({ text: 'Veuillez indiquer le chemin du fichier partagé.', error: true })
      return
    }
    setIsSyncing(true)
    setSyncFeedback(null)
    try {
      const res = await invoke<OpenVaultResult>('sync_vault_with_file', {
        syncFilePath: syncFilePath.trim(),
      })
      if (res && res.entries) {
        setEntries(res.entries.map(fromBackendEntry))
        const nowStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        setLastSyncTime(nowStr)
        localStorage.setItem('passapp_last_sync_time', nowStr)
        localStorage.setItem('passapp_sync_file_path', syncFilePath.trim())
        setSyncFeedback({
          text: `Synchronisation réussie ! (${res.entries.length} identifiants à jour)`,
          error: false,
        })
      }
    } catch (err: unknown) {
      setSyncFeedback({
        text: `Erreur de synchronisation : ${typeof err === 'string' ? err : 'Fichier inaccessible'}`,
        error: true,
      })
    } finally {
      setIsSyncing(false)
    }
  }

  // Détection des presets cloud & sélection par explorateur natif
  const loadCloudPresets = async () => {
    setIsLoadingPresets(true)
    try {
      const presets = await invoke<CloudSyncPreset[]>('get_cloud_sync_presets')
      setCloudPresets(presets)
    } catch {
      setCloudPresets([])
    } finally {
      setIsLoadingPresets(false)
    }
  }

  const handleBrowseSyncFile = async () => {
    try {
      const picked = await invoke<string | null>('pick_sync_file')
      if (picked) {
        setSyncFilePath(picked)
        localStorage.setItem('passapp_sync_file_path', picked)
      }
    } catch (err) {
      console.error('Erreur explorateur natif :', err)
    }
  }

  const handleSelectPreset = (preset: CloudSyncPreset) => {
    setSyncFilePath(preset.path)
    localStorage.setItem('passapp_sync_file_path', preset.path)
  }

  function openProfileModal() {
    setIsProfileOpen(true)
    void loadCloudPresets()
  }

  // Exécution de l'importation universelle
  async function executeUniversalImport(itemsToImport: ImportedItem[]) {
    if (itemsToImport.length === 0) return
    setIsImporting(true)
    let count = 0
    try {
      for (const item of itemsToImport) {
        if (!item.title && !item.username) continue
        if (isBrowserMode) {
          const newEntry: VaultEntry = {
            id: `entry-${Date.now()}-${Math.random()}`,
            title: item.title,
            username: item.username,
            password: item.password,
            url: item.url,
            notes: item.notes,
            totpSecret: item.totpSecret,
            category: item.category,
            favorite: item.favorite,
            updatedAt: "À l'instant",
          }
          setEntries((prev) => [newEntry, ...prev])
          count++
        } else {
          await invoke('create_vault_entry', {
            entry: {
              title: item.title,
              username: item.username,
              password: item.password || null,
              url: item.url || null,
              notes: item.notes || null,
              totp_secret: item.totpSecret || null,
              category: item.category,
              favorite: item.favorite,
            },
          })
          count++
        }
      }

      if (!isBrowserMode) {
        const refreshed = await invoke<BackendVaultEntry[]>('get_vault_entries')
        setEntries(refreshed.map(fromBackendEntry))
      }

      setIsImportOpen(false)
      setParsedImport(null)
      setImportRawText('')
      alert(`Importation réussie : ${count} identifiants importés dans votre coffre !`)
    } catch (err) {
      alert(`Erreur lors de l'importation : ${err}`)
    } finally {
      setIsImporting(false)
    }
  }

  // Suppression
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

  // Changement mot de passe maître
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
      setMasterPasswordMsg({ text: 'Mot de passe maître mis à jour avec succès.', error: false })
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

  // Export JSON
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

  // Import JSON
  async function handleImportJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const rawText = await file.text()
      const data = JSON.parse(rawText)
      const list = Array.isArray(data) ? data : data.entries
      if (!Array.isArray(list)) {
        alert('Format de fichier de sauvegarde non reconnu.')
        return
      }

      let importedCount = 0
      for (const item of list) {
        if (!item.title) continue
        if (isBrowserMode) {
          const entry: VaultEntry = {
            id: `entry-${Date.now()}-${Math.random()}`,
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

  // Téléchargement kit d'urgence
  function downloadEmergencyKit() {
    const content = `======================================================
PASSAPP - FICHE DE RÉCUPÉRATION & KIT D'URGENCE
======================================================
Date d'émission : ${new Date().toLocaleDateString('fr-FR')}

PHRASE SECRÈTE DE SECOURS (12 MOTS) :
${recoveryWords.map((w, i) => `${i + 1}. ${w}`).join('   ')}

INSTRUCTIONS DE SÉCURITÉ :
1. Conservez ce document en lieu sûr (imprimé ou sur support chiffré hors-ligne).
2. Ne partagez jamais ces mots avec un tiers.
3. PassApp est conçu avec une architecture Zero-Knowledge : aucune copie
   de votre mot de passe ni de votre phrase secrète n'existe sur des serveurs distants.
======================================================`

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'passapp-kit-urgence.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const selectedStrength = useMemo(
    () => evaluatePassword(selectedEntry?.password || ''),
    [selectedEntry?.password],
  )
  const formStrength = useMemo(() => evaluatePassword(formPassword), [formPassword])
  const onboardingStrength = useMemo(
    () => evaluatePassword(onboardingMasterPassword),
    [onboardingMasterPassword],
  )
  const generatorStrength = useMemo(() => evaluatePassword(generatedPassword), [generatedPassword])

  // -------------------------------------------------------------
  // VUE 1 : ASSISTANT D'INITIALISATION INITIAL (ONBOARDING)
  // -------------------------------------------------------------
  if (!vaultExists) {
    return (
      <main className="onboarding-shell">
        <div className="onboarding-card">
          {/* HEADER ET PROGRESSION */}
          <div className="onboarding-header">
            <div className="onboarding-brand">
              <span className="brand-icon">🛡️</span> PassApp
            </div>
            <div className="step-pills">
              {[1, 2, 3, 4].map((s) => (
                <div key={s} className={`step-pill ${s <= onboardingStep ? 'active' : ''}`} />
              ))}
            </div>
          </div>

          {/* ÉTAPE 1 : BIENVENUE & PRINCIPES */}
          {onboardingStep === 1 && (
            <div className="onboarding-body animate-fade">
              <h2>Bienvenue dans votre coffre-fort numérique</h2>
              <p className="onboarding-intro">
                PassApp sécurise tous vos identifiants sans abonnement, sans tracking, et sous votre contrôle exclusif.
              </p>

              <div className="feature-grid">
                <div className="feature-box">
                  <div className="feature-icon">🔒</div>
                  <div>
                    <strong>Chiffrement Zero-Knowledge</strong>
                    <p>Vos clés sont dérivées via Argon2id et AES-256-GCM. Vous seul détenez le pouvoir de déchiffrement.</p>
                  </div>
                </div>
                <div className="feature-box">
                  <div className="feature-icon">🏠</div>
                  <div>
                    <strong>100% Souverain & Local-First</strong>
                    <p>Vos données sont conservées sur votre appareil. Aucun serveur tiers ne stocke vos secrets.</p>
                  </div>
                </div>
                <div className="feature-box">
                  <div className="feature-icon">⚡</div>
                  <div>
                    <strong>Ultra-rapide & Élégant</strong>
                    <p>Copie instantanée en un clic, recherche fluide et générateur de mot de passe hautement paramétrable.</p>
                  </div>
                </div>
              </div>

              <div className="onboarding-footer">
                <button
                  type="button"
                  className="primary-button large-btn"
                  onClick={() => setOnboardingStep(2)}
                >
                  Créer mon coffre sécurisé →
                </button>
              </div>
            </div>
          )}

          {/* ÉTAPE 2 : MOT DE PASSE MAÎTRE */}
          {onboardingStep === 2 && (
            <div className="onboarding-body animate-fade">
              <h2>Définissez votre mot de passe maître</h2>
              <p className="onboarding-intro">
                Ce mot de passe est la clé maîtresse qui déchiffre l'ensemble de votre coffre. Choisissez un mot de passe mémorable et fort.
              </p>

              <div className="form-grid">
                <label>
                  Mot de passe maître (8 caractères minimum)
                  <input
                    type="password"
                    value={onboardingMasterPassword}
                    onChange={(e) => setOnboardingMasterPassword(e.target.value)}
                    placeholder="Saisissez un mot de passe robuste..."
                    autoFocus
                  />
                </label>

                {onboardingMasterPassword && (
                  <div className="strength-container">
                    <div className="strength-bars">
                      {[1, 2, 3, 4].map((step) => (
                        <div
                          key={step}
                          className={`strength-bar-step ${step <= onboardingStrength.score ? 'active' : ''}`}
                          style={{
                            backgroundColor:
                              step <= onboardingStrength.score ? onboardingStrength.color : undefined,
                          }}
                        />
                      ))}
                    </div>
                    <div className="strength-meta">
                      <span style={{ color: onboardingStrength.color, fontWeight: 600 }}>
                        {onboardingStrength.label} ({onboardingStrength.entropyBits} bits)
                      </span>
                      {onboardingStrength.tips.length > 0 && (
                        <span className="strength-hint">{onboardingStrength.tips[0]}</span>
                      )}
                    </div>
                  </div>
                )}

                <label>
                  Confirmez le mot de passe maître
                  <input
                    type="password"
                    value={onboardingConfirmPassword}
                    onChange={(e) => setOnboardingConfirmPassword(e.target.value)}
                    placeholder="Confirmez à nouveau..."
                  />
                </label>

                {onboardingConfirmPassword &&
                  onboardingMasterPassword !== onboardingConfirmPassword && (
                    <p className="form-error">Les mots de passe ne correspondent pas.</p>
                  )}
              </div>

              <div className="onboarding-footer flex-between">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setOnboardingStep(1)}
                >
                  ← Retour
                </button>
                <button
                  type="button"
                  className="primary-button large-btn"
                  disabled={
                    onboardingMasterPassword.length < 8 ||
                    onboardingMasterPassword !== onboardingConfirmPassword
                  }
                  onClick={() => setOnboardingStep(3)}
                >
                  Étape suivante : Phrase secrète →
                </button>
              </div>
            </div>
          )}

          {/* ÉTAPE 3 : PHRASE SECRÈTE DE SECOURS (12 MOTS) */}
          {onboardingStep === 3 && (
            <div className="onboarding-body animate-fade">
              <h2>Phrase secrète de secours</h2>
              <p className="onboarding-intro">
                En cas d'oubli de votre mot de passe maître, ces 12 mots constituent votre unique moyen de recouvrement.
              </p>

              {/* GRILLE DES 12 MOTS */}
              <div className="recovery-words-grid">
                {recoveryWords.map((word, idx) => (
                  <div key={idx} className="recovery-word-item">
                    <span className="word-index">{idx + 1}.</span>
                    <span className="word-text">{word}</span>
                  </div>
                ))}
              </div>

              <div className="recovery-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(recoveryWords.join(' '))
                    setCopiedRecovery(true)
                    setTimeout(() => setCopiedRecovery(false), 2000)
                  }}
                >
                  {copiedRecovery ? '✓ Phrase copiée' : '📋 Copier les 12 mots'}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={downloadEmergencyKit}
                >
                  💾 Télécharger la fiche d'urgence (.txt)
                </button>
              </div>

              <div className="detail-note warning-note">
                <span>🛡️</span>
                <div>
                  <strong>SÉCURITÉ ZERO-KNOWLEDGE STRICTE : Non réaffichée par la suite</strong>
                  <p>
                    Pour garantir l'inviolabilité de vos accès, cette phrase secrète ne sera <b>JAMAIS</b> enregistrée sur cet appareil et ne pourra <b>JAMAIS être affichée dans vos paramètres</b>. Aucun tiers ni serveur ne détient vos clés. Notez-la immédiatement sur papier ou conservez-la hors-ligne.
                  </p>
                </div>
              </div>

              <div className="onboarding-footer flex-between">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setOnboardingStep(2)}
                >
                  ← Retour
                </button>
                <button
                  type="button"
                  className="primary-button large-btn"
                  onClick={() => setOnboardingStep(4)}
                >
                  Étape suivante : Personnalisation →
                </button>
              </div>
            </div>
          )}

          {/* ÉTAPE 4 : PERSONNALISATION DU THÈME & FINALISATION */}
          {onboardingStep === 4 && (
            <div className="onboarding-body animate-fade">
              <h2>Personnalisez votre expérience</h2>
              <p className="onboarding-intro">
                Adaptez l'interface selon vos préférences visuelles. Ces réglages restent modifiables à tout moment.
              </p>

              <div className="customization-section">
                <h4>Mode d'affichage</h4>
                <div className="theme-toggle-row">
                  <button
                    type="button"
                    className={`theme-choice-btn ${themeMode === 'dark' ? 'active' : ''}`}
                    onClick={() => setThemeMode('dark')}
                  >
                    🌙 Sombre (Recommandé)
                  </button>
                  <button
                    type="button"
                    className={`theme-choice-btn ${themeMode === 'light' ? 'active' : ''}`}
                    onClick={() => setThemeMode('light')}
                  >
                    ☀️ Clair
                  </button>
                </div>

                <h4>Couleur d'accentuation</h4>
                <div className="accent-pickers">
                  {[
                    { id: 'emerald', name: 'Émeraude', color: '#1f9d55' },
                    { id: 'amber', name: 'Ambre', color: '#e06d45' },
                    { id: 'sapphire', name: 'Saphir', color: '#2563eb' },
                    { id: 'amethyst', name: 'Améthyste', color: '#8b5cf6' },
                    { id: 'ruby', name: 'Rubis', color: '#e11d48' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`accent-dot-btn ${accentColor === item.id ? 'active' : ''}`}
                      onClick={() => setAccentColor(item.id as AccentColor)}
                      title={item.name}
                    >
                      <span className="dot" style={{ backgroundColor: item.color }} />
                      <small>{item.name}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="onboarding-footer flex-between">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setOnboardingStep(3)}
                >
                  ← Retour
                </button>
                <button
                  type="button"
                  className="primary-button large-btn glow"
                  onClick={() => void completeInitialSetup()}
                >
                  ✨ Initialiser et ouvrir mon coffre
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    )
  }

  // -------------------------------------------------------------
  // VUE 2 : APPLICATION PRINCIPALE
  // -------------------------------------------------------------
  return (
    <main className="app-shell">
      {/* BARRE LATÉRALE */}
      <aside className="sidebar">
        <div className="brand-mark">
          <span className="brand-shield">🛡️</span> PassApp
        </div>

        {/* PROFIL UTILISATEUR & RÉGLAGES */}
        <div
          className="profile-row clickable"
          onClick={openProfileModal}
          role="button"
          tabIndex={0}
          title="Ouvrir les paramètres et réglages"
        >
          <div className="avatar">AM</div>
          <div>
            <strong>Alexandre Martin</strong>
            <small>Coffre souverain</small>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Ouvrir les réglages"
            onClick={(e) => {
              e.stopPropagation()
              openProfileModal()
            }}
          >
            ⚙️
          </button>
        </div>

        {/* NAVIGATION PAR CATÉGORIE */}
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
          <button
            className={activeFilter === 'totp' ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => setActiveFilter('totp')}
          >
            <span>🔑</span> Authenticator 2FA <b>{isLocked ? '—' : categoryCounts.totp}</b>
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
          <div className="nav-divider" />
          <button
            className="nav-item import-nav-button"
            type="button"
            disabled={isLocked}
            onClick={() => {
              setIsImportOpen(true)
              setParsedImport(null)
              setImportRawText('')
            }}
            title="Importer des identifiants (Chrome, Bitwarden, 1Password, Google Authenticator...)"
          >
            <span>📥</span> <b>Importer des données</b>
          </button>
        </nav>

        {/* PIED DE PAGE : STATUT & BASULE THÈME */}
        <div className="sidebar-footer">
          <div className="footer-status">
            <span className={isLocked ? 'sync-dot locked' : 'sync-dot active'} />
            <span>
              {isLocked
                ? 'Coffre verrouillé'
                : storageLabel === 'browser-demo'
                ? 'Mode démo web'
                : 'Stockage local chiffré'}
            </span>
          </div>

          <div className="sidebar-quick-actions">
            {!isLocked && (
              <button
                type="button"
                className="theme-quick-btn"
                onClick={() => {
                  setIsImportOpen(true)
                  setParsedImport(null)
                  setImportRawText('')
                }}
                title="Importer des identifiants (Chrome, Bitwarden, 1Password, Google Authenticator...)"
              >
                📥 Importer des données
              </button>
            )}
            <button
              type="button"
              className="theme-quick-btn"
              onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
              title={themeMode === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
            >
              {themeMode === 'dark' ? '☀️ Mode Clair' : '🌙 Mode Sombre'}
            </button>
            {vaultPath && (
              <button
                className="vault-path-badge"
                type="button"
                onClick={openVaultDir}
                title="Révéler le fichier vault.passapp dans l'explorateur"
              >
                📁 Fichier coffre
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ESPACE PRINCIPAL */}
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">COFFRE-FORT SOUVERAIN</p>
            <h1>
              {activeFilter === 'all'
                ? 'Tous les identifiants'
                : activeFilter === 'favorites'
                ? 'Mes favoris'
                : activeFilter === 'totp'
                ? 'Authenticator 2FA (TOTP)'
                : activeFilter}
            </h1>
          </div>
          <div className="top-actions">
            {!isLocked && (
              <>
                <button
                  className="secondary-top-button"
                  type="button"
                  onClick={() => {
                    setIsImportOpen(true)
                    setParsedImport(null)
                    setImportRawText('')
                  }}
                  title="Importer des identifiants (Chrome, Bitwarden, 1Password, Google Authenticator, CSV...)"
                >
                  <span>📥</span> Importer
                </button>
                <button
                  className="secondary-top-button"
                  type="button"
                  onClick={openGeneratorModal}
                  title="Générateur de mot de passe fort"
                >
                  <span>🎲</span> Générateur
                </button>
              </>
            )}
            <button
              className={isLocked ? 'lock-button locked' : 'lock-button'}
              type="button"
              onClick={() => void toggleLock()}
              title={isLocked ? 'Déverrouiller le coffre' : 'Verrouiller le coffre (Ctrl+L)'}
            >
              <span>{isLocked ? '🔒' : '🔓'}</span>
              {isLocked ? 'Déverrouiller' : 'Verrouiller'}
            </button>
            {!isLocked && (
              <button
                className="primary-button"
                type="button"
                onClick={openAddModal}
                title="Ajouter un identifiant (Ctrl+N)"
              >
                <span>+</span> Nouvel accès
              </button>
            )}
          </div>
        </header>

        <div className="content-grid">
          {/* PANNEAU DE GAUCHE : LISTE */}
          <section className="entry-panel" aria-label="Liste des entrées">
            {isLocked ? (
              <div className="panel-locked-notice">
                <div className="locked-badge-icon">🔒</div>
                <h3>Coffre verrouillé</h3>
                <p>Vos accès sont masqués et protégés par chiffrement de bout en bout.</p>
                <small>Saisissez votre mot de passe maître pour afficher vos secrets.</small>
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

                {/* LISTE DES ENTRÉES OU MESSAGE COFFRE VIDE */}
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
                        <small>
                          {entry.username}
                          {entry.totpSecret && <span className="entry-totp-badge"> • 🔑 2FA</span>}
                        </small>
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

                  {visibleEntries.length === 0 && (
                    <div className="empty-panel-notice">
                      <p>
                        {query
                          ? 'Aucun résultat correspondant.'
                          : 'Aucun identifiant dans cette catégorie.'}
                      </p>
                    </div>
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
                <p>Saisissez votre mot de passe maître pour déchiffrer votre coffre.</p>
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
                    Ouvrir mon coffre
                  </button>
                  {openError && <p className="form-error">{openError}</p>}
                </div>
              </div>
            ) : entries.length === 0 ? (
              <div className="empty-vault-card">
                <div className="empty-icon-shield">🛡️</div>
                <h2>Votre coffre est sécurisé & prêt</h2>
                <p>
                  Vous n'avez pas encore d'identifiant enregistré. Créez votre premier accès ou importez une sauvegarde existante.
                </p>
                <div className="empty-card-actions">
                  <button className="primary-button" type="button" onClick={openAddModal}>
                    <span>+</span> Ajouter un premier identifiant
                  </button>
                  <button className="secondary-btn" type="button" onClick={openGeneratorModal}>
                    <span>🎲</span> Générer un mot de passe fort
                  </button>
                </div>
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

                  {/* MENU D'OPTIONS */}
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

                {/* CHAMP MOT DE PASSE AVEC ANALYSE */}
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
                        title="Copier avec effacement auto dans 30s"
                      >
                        {copiedKey === 'password' ? '✓ Copié !' : '📋 Copier'}
                      </button>
                    </div>
                  </div>

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
                          Force : {selectedStrength.label}
                        </span>
                        <span className="entropy-tag">{selectedStrength.entropyBits} bits d'entropie</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* CHAMP AUTHENTICATOR 2FA (RFC 6238) */}
                {selectedEntry.totpSecret ? (
                  <div className="totp-card">
                    <div className="totp-card-header">
                      <label>🔑 Authenticator 2FA (RFC 6238)</label>
                      <span
                        className={`totp-countdown-badge ${
                          totpCountdown <= 5 ? 'danger' : totpCountdown <= 10 ? 'warning' : 'normal'
                        }`}
                      >
                        ⏱️ Expire dans {totpCountdown}s
                      </span>
                    </div>

                    <div className="totp-code-display-row">
                      <div className="totp-digits-large">
                        {totpCodes[selectedEntry.id]
                          ? `${totpCodes[selectedEntry.id].slice(0, 3)} ${totpCodes[selectedEntry.id].slice(3)}`
                          : '------'}
                      </div>
                      <button
                        type="button"
                        className="primary-btn-sm"
                        onClick={() =>
                          void copyToClipboard(
                            totpCodes[selectedEntry.id] || '',
                            `totp-${selectedEntry.id}`,
                            'Code 2FA Authenticator',
                          )
                        }
                        title="Copier le code 2FA à 6 chiffres"
                      >
                        {copiedKey === `totp-${selectedEntry.id}` ? '✓ Code copié !' : '📋 Copier'}
                      </button>
                    </div>

                    <div className="totp-progress-track">
                      <div
                        className={`totp-progress-bar ${
                          totpCountdown <= 5 ? 'danger' : totpCountdown <= 10 ? 'warning' : 'normal'
                        }`}
                        style={{ width: `${(totpCountdown / 30) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="totp-empty-cta">
                    <span>🔑 Aucun code 2FA Authenticator configuré</span>
                    <button
                      type="button"
                      className="secondary-btn-xs"
                      onClick={() => openEditModal(selectedEntry)}
                    >
                      + Ajouter un code 2FA
                    </button>
                  </div>
                )}

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
                    <strong>Chiffrement Argon2id + AES-256-GCM</strong>
                    <p>
                      Vos données sont scellées cryptographiquement sur cet appareil. Le presse-papier
                      est vidé automatiquement après chaque copie pour garantir votre confidentialité.
                    </p>
                  </div>
                </div>
              </>
            ) : entries.length === 0 ? (
              <div className="empty-vault-card">
                <div className="empty-vault-icon">🛡️</div>
                <h2>Votre coffre-fort PassApp est prêt</h2>
                <p className="empty-vault-sub">
                  Aucun mot de passe enregistré pour le moment. Vous pouvez importer instantanément
                  toutes vos données existantes ou créer votre premier identifiant.
                </p>
                <div className="empty-vault-actions">
                  <button
                    type="button"
                    className="primary-button highlight-button"
                    onClick={() => {
                      setIsImportOpen(true)
                      setParsedImport(null)
                      setImportRawText('')
                    }}
                  >
                    <span>📥</span> Importer mes mots de passe (Chrome, Bitwarden, CSV, 2FA...)
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={openAddModal}
                  >
                    <span>➕</span> Créer un premier accès manuellement
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={openProfileModal}
                  >
                    <span>🔄</span> Configurer la synchronisation Cloud (OneDrive, iCloud...)
                  </button>
                </div>
                <div className="empty-vault-features-grid">
                  <div className="empty-feature-item">
                    <span>🌐</span>
                    <strong>Tous formats supportés</strong>
                    <small>Chrome, Edge, Firefox, Bitwarden, 1Password, KeePass, CSV</small>
                  </div>
                  <div className="empty-feature-item">
                    <span>🔑</span>
                    <strong>Double facteur 2FA</strong>
                    <small>Codes temporaires Authenticator RFC 6238 générés en direct</small>
                  </div>
                  <div className="empty-feature-item">
                    <span>🔒</span>
                    <strong>Zero-Knowledge</strong>
                    <small>Chiffrement Argon2id + AES-256-GCM sans trace sur aucun serveur</small>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-selection-card">
                <div className="empty-selection-icon">👈</div>
                <h3>Sélectionnez un accès</h3>
                <p>Choisissez un identifiant dans la colonne de gauche pour afficher ses détails et codes 2FA.</p>
              </div>
            )}
          </section>
        </div>
      </section>

      {/* TOAST FLOTTANT PRESSE-PAPIER */}
      {clipboardTimer.active && (
        <div className="clipboard-toast">
          <div className="toast-content">
            <span className="toast-icon">🔐</span>
            <div>
              <strong>{clipboardTimer.label} copié !</strong>
              <p>
                {clipboardTimer.secondsLeft > 0
                  ? `Effacement auto dans ${clipboardTimer.secondsLeft} s`
                  : 'Presse-papier sécurisé et vidé.'}
              </p>
            </div>
          </div>
          {clipboardTimer.secondsLeft > 0 && (
            <button
              className="toast-clear-button"
              type="button"
              onClick={clearClipboardImmediately}
              title="Vider immédiatement"
            >
              Vider maintenant
            </button>
          )}
        </div>
      )}

      {/* MODALE DU GÉNÉRATEUR */}
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
                    Force : {generatorStrength.label}
                  </span>
                  <span className="entropy-tag">{generatorStrength.entropyBits} bits d'entropie</span>
                </div>
              </div>

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

      {/* MODALE DU PROFIL & RÉGLAGES */}
      {isProfileOpen && (
        <div className="modal-backdrop" onClick={() => setIsProfileOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Réglages & Paramètres du Coffre</h2>
              <button className="close-button" type="button" onClick={() => setIsProfileOpen(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* PERSONNALISATION DU THÈME */}
              <div className="info-section">
                <h4>Personnalisation de l'interface</h4>
                <div className="theme-toggle-row">
                  <button
                    type="button"
                    className={`theme-choice-btn ${themeMode === 'dark' ? 'active' : ''}`}
                    onClick={() => setThemeMode('dark')}
                  >
                    🌙 Sombre
                  </button>
                  <button
                    type="button"
                    className={`theme-choice-btn ${themeMode === 'light' ? 'active' : ''}`}
                    onClick={() => setThemeMode('light')}
                  >
                    ☀️ Clair
                  </button>
                </div>

                <div className="accent-pickers" style={{ marginTop: '10px' }}>
                  {[
                    { id: 'emerald', name: 'Émeraude', color: '#1f9d55' },
                    { id: 'amber', name: 'Ambre', color: '#e06d45' },
                    { id: 'sapphire', name: 'Saphir', color: '#2563eb' },
                    { id: 'amethyst', name: 'Améthyste', color: '#8b5cf6' },
                    { id: 'ruby', name: 'Rubis', color: '#e11d48' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`accent-dot-btn ${accentColor === item.id ? 'active' : ''}`}
                      onClick={() => setAccentColor(item.id as AccentColor)}
                      title={item.name}
                    >
                      <span className="dot" style={{ backgroundColor: item.color }} />
                      <small>{item.name}</small>
                    </button>
                  ))}
                </div>
              </div>

              {/* VERROUILLAGE AUTOMATIQUE */}
              <div className="info-section">
                <h4>Verrouillage automatique</h4>
                <p className="info-desc">
                  Pour votre sécurité, le coffre se referme automatiquement en cas d'inactivité.
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
                    <option value={0}>Désactivé</option>
                  </select>
                </label>
              </div>

              {/* SAUVEGARDE, EXPORT & IMPORT */}
              <div className="info-section">
                <h4>Sauvegardes & Données</h4>
                <div className="backup-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={exportVaultBackup}
                    disabled={isLocked}
                  >
                    📥 Exporter la sauvegarde (JSON)
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      setIsProfileOpen(false)
                      setIsImportOpen(true)
                      setParsedImport(null)
                      setImportRawText('')
                    }}
                    disabled={isLocked}
                  >
                    🌐 Importer (Chrome, Bitwarden, 1Password, 2FA...)
                  </button>
                  <label className={`secondary-btn file-input-label ${isLocked ? 'disabled' : ''}`}>
                    📤 Importer JSON PassApp
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

              {/* SYNCHRONISATION MULTI-APPAREILS */}
              <div className="info-section">
                <h4>Synchronisation multi-appareils (Local-First CRDT)</h4>
                <p className="info-desc">
                  Synchronisez votre coffre avec vos autres appareils (PC, Mac, Linux, iPhone) sans serveur tiers payant grâce au moteur de fusion CRDT chiffré de bout en bout.
                </p>

                <div className="sync-card">
                  <div className="sync-status-row">
                    <span className="sync-status-indicator">
                      {syncFilePath ? '🟢 Emplacement configuré' : '⚪ Aucun emplacement sélectionné'}
                    </span>
                    {lastSyncTime && <small className="last-sync-tag">Dernière synchro : {lastSyncTime}</small>}
                  </div>

                  <div className="sync-presets-section">
                    <span className="sync-section-subtitle">
                      ☁️ 1. Choisissez votre service Cloud ou Réseau :
                    </span>
                    {isLoadingPresets ? (
                      <p className="sync-loading-text">Recherche des dossiers cloud...</p>
                    ) : cloudPresets.length > 0 ? (
                      <div className="cloud-presets-grid">
                        {cloudPresets.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={`cloud-preset-card ${
                              syncFilePath === preset.path ? 'selected' : ''
                            }`}
                            onClick={() => handleSelectPreset(preset)}
                          >
                            <div className="cloud-preset-header">
                              <span className="cloud-preset-title">
                                {preset.service === 'onedrive'
                                  ? '☁️ OneDrive'
                                  : preset.service === 'icloud'
                                  ? '🍎 iCloud Drive'
                                  : preset.service === 'googledrive'
                                  ? '📂 Google Drive'
                                  : preset.service === 'dropbox'
                                  ? '📦 Dropbox'
                                  : '📁 Dossier Local'}
                              </span>
                              <span
                                className={`cloud-preset-status ${
                                  preset.exists ? 'detected' : 'not-detected'
                                }`}
                              >
                                {preset.exists ? '✓ Détecté' : 'Non détecté'}
                              </span>
                            </div>
                            <span className="cloud-preset-desc">{preset.name}</span>
                            <small className="cloud-preset-path">{preset.path}</small>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="cloud-presets-empty">
                        <small>Utilisez le bouton ci-dessous pour choisir votre dossier partagé.</small>
                      </div>
                    )}
                  </div>

                  <div className="sync-browse-row">
                    <span className="sync-section-subtitle">
                      📁 2. Ou sélectionnez un dossier / fichier manuellement :
                    </span>
                    <button
                      type="button"
                      className="sync-browse-btn"
                      onClick={() => void handleBrowseSyncFile()}
                      title="Ouvrir l'explorateur de fichiers pour sélectionner vault.passapp"
                    >
                      📁 Parcourir sur mon ordinateur...
                    </button>
                  </div>

                  <label className="sync-input-label">
                    <span>Chemin actif du fichier partagé :</span>
                    <input
                      type="text"
                      value={syncFilePath}
                      onChange={(e) => {
                        setSyncFilePath(e.target.value)
                        localStorage.setItem('passapp_sync_file_path', e.target.value)
                      }}
                      placeholder="ex: C:\Users\Nom\OneDrive\vault.passapp ou /Users/Nom/..."
                    />
                  </label>

                  <div className="sync-help-box">
                    <small>
                      💡 <b>Local-First CRDT :</b> Placez ce fichier dans un dossier synchronisé par vos outils habituels (OneDrive, iCloud, Google Drive, Dropbox, Synology NAS). PassApp fusionne automatiquement les modifications sans conflit et sans serveur tiers.
                    </small>
                  </div>

                  <div className="sync-actions-row">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={isSyncing || !syncFilePath}
                      onClick={() => void handleSyncWithFile()}
                    >
                      {isSyncing ? 'Synchronisation en cours...' : '🔄 Synchroniser maintenant'}
                    </button>
                  </div>

                  {syncFeedback && (
                    <p className={syncFeedback.error ? 'form-error' : 'form-success'}>
                      {syncFeedback.text}
                    </p>
                  )}
                </div>
              </div>

              {/* SÉCURITÉ & PHRASE SECRÈTE */}
              <div className="info-section">
                <h4>Sécurité & Phrase de secours</h4>
                <div className="sealed-recovery-notice">
                  <div className="sealed-badge-icon">🛡️</div>
                  <div>
                    <strong>Phrase de secours scellée (Zero-Knowledge)</strong>
                    <p>
                      Votre phrase de secours à 12 mots a été générée lors de la configuration initiale. Pour garantir l'inviolabilité absolue de votre coffre face aux attaques et logiciels espions, elle n'est pas conservée en clair et ne peut jamais être réaffichée ici.
                    </p>
                  </div>
                </div>
              </div>

              {/* EMPLACEMENT DU FICHIER */}
              <div className="info-section">
                <h4>Emplacement du coffre physique</h4>
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

              {/* CHANGEMENT DU MOT DE PASSE */}
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
              <h2>Nouvel identifiant</h2>
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
                      title="Générer un mot de passe fort"
                    >
                      🎲 Générer
                    </button>
                  </div>
                </label>

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
                  Clé Secrète TOTP / 2FA Authenticator (optionnel)
                  <input
                    type="text"
                    value={formTotpSecret}
                    onChange={(e) => {
                      const val = e.target.value
                      setFormTotpSecret(val)
                      if (val.trim().toLowerCase().startsWith('otpauth://')) {
                        const parsed = parseOtpAuthUri(val)
                        if (parsed) {
                          if (parsed.secret) setFormTotpSecret(parsed.secret)
                          if (!formTitle && parsed.issuer) setFormTitle(parsed.issuer)
                          if (!formUsername && parsed.account) setFormUsername(parsed.account)
                        }
                      }
                    }}
                    placeholder="ex: JBSWY3DPEHPK3PXP ou collez une URL otpauth://..."
                  />
                  <small className="field-hint">
                    Génère des codes temporaires à 6 chiffres (Google Authenticator, Bitwarden, Aegis).
                  </small>
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
                  <span>Ajouter aux favoris</span>
                </label>
              </div>

              <div className="modal-footer">
                <button type="button" className="lock-button" onClick={() => setIsAddEntryOpen(false)}>
                  Annuler
                </button>
                <button type="submit" className="primary-button">
                  Enregistrer l'accès
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
              <h2>Modifier l'identifiant</h2>
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
                  Clé Secrète TOTP / 2FA Authenticator (optionnel)
                  <input
                    type="text"
                    value={formTotpSecret}
                    onChange={(e) => {
                      const val = e.target.value
                      setFormTotpSecret(val)
                      if (val.trim().toLowerCase().startsWith('otpauth://')) {
                        const parsed = parseOtpAuthUri(val)
                        if (parsed) {
                          if (parsed.secret) setFormTotpSecret(parsed.secret)
                          if (!formTitle && parsed.issuer) setFormTitle(parsed.issuer)
                          if (!formUsername && parsed.account) setFormUsername(parsed.account)
                        }
                      }
                    }}
                    placeholder="ex: JBSWY3DPEHPK3PXP ou collez une URL otpauth://..."
                  />
                  <small className="field-hint">
                    Génère des codes temporaires à 6 chiffres (Google Authenticator, Bitwarden, Aegis).
                  </small>
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

      {/* MODALE D'IMPORTATION UNIVERSELLE */}
      {isImportOpen && (
        <div className="modal-backdrop" onClick={() => setIsImportOpen(false)}>
          <div className="modal-card import-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📥 Importer des identifiants & Authenticator</h2>
              <button className="close-button" type="button" onClick={() => setIsImportOpen(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-intro">
                Importez facilement tous vos mots de passe et codes 2FA depuis vos navigateurs ou anciens gestionnaires sans passer par des serveurs tiers.
              </p>

              <div className="supported-formats-pills">
                <span className="format-pill">🌐 Chrome & Edge</span>
                <span className="format-pill">🦊 Firefox</span>
                <span className="format-pill">🍎 Safari</span>
                <span className="format-pill">🔐 Bitwarden</span>
                <span className="format-pill">🗝️ 1Password</span>
                <span className="format-pill">🛡️ KeePass</span>
                <span className="format-pill">🔑 Google Authenticator</span>
                <span className="format-pill">💾 PassApp JSON</span>
              </div>

              <div className="import-file-dropzone">
                <label className="file-drop-button">
                  📂 Choisir un fichier (CSV, JSON, TXT)
                  <input
                    type="file"
                    accept=".csv,.json,.txt"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const text = await file.text()
                      setImportRawText(text)
                      const res = parseUniversalImport(text, file.name)
                      setParsedImport({ format: res.formatDetected, items: res.items })
                    }}
                    style={{ display: 'none' }}
                  />
                </label>
                <span className="drop-or">ou collez le texte ci-dessous :</span>
              </div>

              <textarea
                className="import-textarea"
                rows={4}
                value={importRawText}
                placeholder="Collez ici le texte CSV, JSON ou vos URLs otpauth://totp/..."
                onChange={(e) => {
                  const val = e.target.value
                  setImportRawText(val)
                  if (val.trim()) {
                    const res = parseUniversalImport(val)
                    setParsedImport({ format: res.formatDetected, items: res.items })
                  } else {
                    setParsedImport(null)
                  }
                }}
              />

              {parsedImport && (
                <div className="import-preview-box">
                  <div className="import-preview-header">
                    <span className="format-detected-badge">✓ {parsedImport.format}</span>
                    <strong>{parsedImport.items.length} identifiant(s) détecté(s)</strong>
                  </div>

                  {parsedImport.items.length > 0 ? (
                    <>
                      <div className="preview-items-list">
                        {parsedImport.items.slice(0, 4).map((item, idx) => (
                          <div key={idx} className="preview-item-row">
                            <span className="preview-title">{item.title}</span>
                            <span className="preview-user">{item.username || '—'}</span>
                            <span className="preview-meta">
                              {item.password ? '🔑 Mot de passe' : ''}
                              {item.totpSecret ? ' • ⏱️ 2FA' : ''}
                            </span>
                          </div>
                        ))}
                        {parsedImport.items.length > 4 && (
                          <small className="more-preview-note">
                            ... et {parsedImport.items.length - 4} autre(s) identifiant(s)
                          </small>
                        )}
                      </div>

                      <button
                        type="button"
                        className="primary-button full-width"
                        disabled={isImporting}
                        onClick={() => void executeUniversalImport(parsedImport.items)}
                      >
                        {isImporting
                          ? 'Importation en cours...'
                          : `Importer ces ${parsedImport.items.length} identifiant(s)`}
                      </button>
                    </>
                  ) : (
                    <p className="no-items-warning">
                      Aucun identifiant valide n'a pu être extrait. Vérifiez le format du fichier ou le texte collé.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="secondary-btn" type="button" onClick={() => setIsImportOpen(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
