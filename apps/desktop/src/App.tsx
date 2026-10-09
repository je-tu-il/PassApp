import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useState } from 'react'
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

type SortOption = 'title-asc' | 'title-desc' | 'updated-desc' | 'category'

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

function generateStrongPassword(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+'
  const array = new Uint32Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (x) => chars[x % chars.length]).join('')
}

function App() {
  const [activeView, setActiveView] = useState<'vault' | 'favorites'>('vault')
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

  // Modales
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isAddEntryOpen, setIsAddEntryOpen] = useState(false)
  const [isEditEntryOpen, setIsEditEntryOpen] = useState(false)

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

  // Filtrage et Tri
  const visibleEntries = useMemo(() => {
    if (isLocked) return []
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = entries.filter((entry) => {
      const matchesView = activeView === 'vault' || entry.favorite
      const matchesQuery =
        !normalizedQuery ||
        `${entry.title} ${entry.username} ${entry.category}`.toLowerCase().includes(normalizedQuery)
      return matchesView && matchesQuery
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
  }, [activeView, entries, isLocked, query, sortBy])

  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? visibleEntries[0]

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

  // Copie dans le presse-papier avec confirmation visuelle
  async function copyToClipboard(text: string, key: string) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      // ignore
    }
  }

  // Ouvrir le répertoire du coffre dans l'explorateur
  async function openVaultDir() {
    await invoke('open_vault_directory').catch(() => {
      // Fallback
    })
  }

  // Ouvrir la modale d'ajout
  function openAddModal() {
    setFormTitle('')
    setFormUsername('')
    setFormPassword(generateStrongPassword())
    setFormUrl('')
    setFormNotes('')
    setFormCategory('Personnel')
    setFormFavorite(false)
    setIsAddEntryOpen(true)
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

  // Basculer favori directement
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
      setMasterPasswordMsg({ text: 'Mot de passe maître simulé modifié avec succès.', error: false })
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
            <small>Coffre local</small>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Ouvrir le menu profil"
            onClick={(e) => {
              e.stopPropagation()
              setIsProfileOpen(true)
            }}
          >
            ...
          </button>
        </div>

        {/* NAVIGATION */}
        <nav aria-label="Navigation principale">
          <button
            className={activeView === 'vault' ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => setActiveView('vault')}
          >
            <span>▦</span> Mon coffre <b>{isLocked ? '—' : entries.length}</b>
          </button>
          <button
            className={activeView === 'favorites' ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => setActiveView('favorites')}
          >
            <span>☆</span> Favoris <b>{isLocked ? '—' : entries.filter((e) => e.favorite).length}</b>
          </button>
        </nav>

        {/* PIED DE PAGE AVEC EMPLACEMENT DU COFFRE */}
        <div className="sidebar-footer">
          <div className="footer-status">
            <span className={isLocked ? 'sync-dot locked' : 'sync-dot active'} />
            <span>{isLocked ? 'Coffre verrouillé' : storageLabel === 'browser-demo' ? 'Mode démo web' : 'Stockage local chiffré'}</span>
          </div>
          {vaultPath && (
            <button
              className="vault-path-badge"
              type="button"
              onClick={openVaultDir}
              title="Cliquez pour révéler le fichier vault.passapp dans l'explorateur"
            >
              📁 Ouvrir dossier coffre
            </button>
          )}
        </div>
      </aside>

      {/* ESPACE PRINCIPAL */}
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">ESPACE SÉCURISÉ</p>
            <h1>{activeView === 'vault' ? 'Mon coffre' : 'Mes favoris'}</h1>
          </div>
          <div className="top-actions">
            <button
              className={isLocked ? 'lock-button locked' : 'lock-button'}
              type="button"
              onClick={() => (isBrowserMode ? (isLocked ? unlockBrowserDemo() : toggleLock()) : void toggleLock())}
            >
              <span>{isLocked ? '🔒' : '🔓'}</span>
              {isLocked ? 'Déverrouiller' : 'Verrouiller'}
            </button>
            {!isLocked && (
              <button className="primary-button" type="button" onClick={openAddModal}>
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
                <small>Déverrouillez le coffre avec votre mot de passe maître pour les afficher.</small>
              </div>
            ) : (
              <>
                <label className="search-box">
                  <span>⌕</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Rechercher dans le coffre"
                  />
                  <kbd>Ctrl K</kbd>
                </label>

                {/* TRI & COMPTEUR */}
                <div className="section-label">
                  <span>
                    {visibleEntries.length} entrée{visibleEntries.length > 1 ? 's' : ''}
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
                      {query ? 'Aucun résultat correspondant.' : 'Aucune entrée dans cette vue.'}
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
                      onClick={() => void copyToClipboard(selectedEntry.username, 'username')}
                      title="Copier"
                    >
                      {copiedKey === 'username' ? '✓ Copié !' : '📋 Copier'}
                    </button>
                  </div>
                </div>

                {/* CHAMP MOT DE PASSE */}
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
                        onClick={() => void copyToClipboard(selectedEntry.password || '', 'password')}
                        title="Copier le mot de passe"
                      >
                        {copiedKey === 'password' ? '✓ Copié !' : '📋 Copier'}
                      </button>
                    </div>
                  </div>
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
                        onClick={() => void copyToClipboard(selectedEntry.url || '', 'url')}
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
                    <label>Notes</label>
                    <div className="secret-field notes-field">
                      <p>{selectedEntry.notes}</p>
                    </div>
                  </div>
                )}

                <div className="detail-note">
                  <span>i</span>
                  <div>
                    <strong>Chiffrement actif & intégrité vérifiée</strong>
                    <p>
                      Vos secrets sont protégés par <b>Argon2id</b> et <b>AES-256-GCM</b> avec sauvegardes automatiques (.bak).
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

              {/* EMPLACEMENT DU FICHIER COFFRE */}
              <div className="info-section">
                <h4>Emplacement du coffre-fort</h4>
                <p className="info-desc">
                  Fichier physique contenant l'ensemble de vos secrets sous forme chiffrée.
                </p>
                <div className="path-box">
                  <code>{vaultPath || 'vault.passapp'}</code>
                  <div className="path-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => void copyToClipboard(vaultPath, 'vaultpath')}
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
                    <strong>Chiffrement symétrique :</strong> AES-256-GCM avec tag MAC d'intégrité
                  </li>
                  <li>
                    <strong>Isolation mémoire :</strong> Écrasement des buffers (Zeroize) dès le verrouillage
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
                      onClick={() => setFormPassword(generateStrongPassword())}
                      title="Générer un mot de passe aléatoire fort"
                    >
                      🎲 Générer
                    </button>
                  </div>
                </label>

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
                      onClick={() => setFormPassword(generateStrongPassword())}
                      title="Générer un mot de passe fort"
                    >
                      🎲 Générer
                    </button>
                  </div>
                </label>

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
