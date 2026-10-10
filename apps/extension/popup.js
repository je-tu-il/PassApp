/**
 * PassApp - Popup Logic (Recherche, Remplissage, TOTP 2FA & Générateur)
 */

// Base32 Decode
function base32Decode(input) {
  let cleaned = input.trim().replace(/[\s-]/g, '').toUpperCase()
  if (cleaned.startsWith('OTPAUTH://')) {
    try {
      const url = new URL(input.trim())
      const secret = url.searchParams.get('secret')
      if (secret) cleaned = secret.replace(/[\s-]/g, '').toUpperCase()
    } catch {
      const match = input.match(/[?&]secret=([A-Z2-7=]+)/i)
      if (match && match[1]) cleaned = match[1].replace(/[\s-]/g, '').toUpperCase()
    }
  }
  cleaned = cleaned.replace(/=+$/, '')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const output = []
  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned.charAt(i))
    if (val === -1) continue
    value = (value << 5) | val
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(output)
}

// Calcul TOTP RFC 6238
async function generateTotpCode(secret) {
  if (!secret) return '------'
  try {
    const keyBytes = base32Decode(secret)
    if (keyBytes.length === 0) return '------'
    const epoch = Math.floor(Date.now() / 1000)
    const counter = Math.floor(epoch / 30)

    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setUint32(0, 0)
    view.setUint32(4, counter)

    const cryptoKey = await window.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: { name: 'SHA-1' } },
      false,
      ['sign']
    )
    const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, buffer)
    const hmacResult = new Uint8Array(signature)
    const offset = hmacResult[hmacResult.length - 1] & 0x0f
    const binary =
      ((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff)
    return (binary % 1000000).toString().padStart(6, '0')
  } catch {
    return '------'
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Navigation par onglets
  const tabBtns = document.querySelectorAll('.tab-btn')
  const tabPanes = document.querySelectorAll('.tab-pane')

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'))
      tabPanes.forEach((p) => p.classList.remove('active'))
      btn.classList.add('active')
      const target = document.getElementById(btn.dataset.tab)
      if (target) target.classList.add('active')
    })
  })

  // Récupération de l'onglet actif et du domaine
  let currentDomain = ''
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab && tab.url) {
      currentDomain = new URL(tab.url).hostname.replace(/^www\./, '')
      document.getElementById('current-domain-badge').textContent = currentDomain
    }
  } catch {
    document.getElementById('current-domain-badge').textContent = 'Page locale'
  }

  // Chargement des données du coffre
  let allEntries = []
  function reloadVaultData() {
    chrome.storage.local.get(['passapp_vault_entries'], (res) => {
      allEntries = res.passapp_vault_entries || []
      document.getElementById('sync-count-tag').textContent = `${allEntries.length} identifiant(s) en mémoire`
      renderMatchingEntries()
    })
  }
  reloadVaultData()

  // Rendu des entrées correspondant au domaine
  async function renderMatchingEntries() {
    const matchingList = document.getElementById('matching-list')
    const matchingSection = document.getElementById('matching-section')
    const emptyNotice = document.getElementById('empty-notice')

    matchingList.innerHTML = ''
    if (!currentDomain) {
      emptyNotice.classList.remove('hidden')
      matchingSection.classList.add('hidden')
      return
    }

    const matches = allEntries.filter((e) => {
      const eUrl = (e.url || '').toLowerCase()
      const eTitle = (e.title || '').toLowerCase()
      const target = currentDomain.toLowerCase()
      return (
        (eUrl && (eUrl.includes(target) || target.includes(eUrl))) ||
        (eTitle && target.includes(eTitle))
      )
    })

    if (matches.length === 0) {
      emptyNotice.classList.remove('hidden')
      matchingSection.classList.add('hidden')
    } else {
      emptyNotice.classList.add('hidden')
      matchingSection.classList.remove('hidden')

      for (const entry of matches) {
        const card = await createEntryCard(entry)
        matchingList.appendChild(card)
      }
    }
  }

  // Création du composant visuel d'une entrée
  async function createEntryCard(entry) {
    const card = document.createElement('div')
    card.className = 'entry-card'

    let totpCode = '------'
    const remaining = 30 - (Math.floor(Date.now() / 1000) % 30)
    if (entry.totpSecret) {
      totpCode = await generateTotpCode(entry.totpSecret)
    }

    card.innerHTML = `
      <div class="entry-card-header">
        <strong>${entry.title || 'Sans titre'}</strong>
        <small>${entry.username || 'Identifiant non défini'}</small>
      </div>

      <div class="entry-actions">
        <button class="fill-btn">⚡ Remplir</button>
        <button class="copy-btn copy-user-btn" title="Copier l'identifiant">👤</button>
        <button class="copy-btn copy-pwd-btn" title="Copier le mot de passe">🔑</button>
      </div>

      ${
        entry.totpSecret
          ? `
        <div class="entry-totp-row">
          <div>
            <span class="entry-totp-code">${totpCode.slice(0, 3)} ${totpCode.slice(3)}</span>
            <span class="entry-totp-badge">(${remaining}s)</span>
          </div>
          <button class="copy-btn copy-totp-btn" title="Copier le code 2FA">📋 2FA</button>
        </div>
      `
          : ''
      }
    `

    // Actions des boutons
    card.querySelector('.fill-btn').addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab && tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (user, pass) => {
            function setVal(el, val) {
              const setter = Object.getOwnPropertyDescriptor(el, 'value')?.set
              const proto = Object.getPrototypeOf(el)
              const protoSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
              if (protoSetter && setter !== protoSetter) protoSetter.call(el, val)
              else if (setter) setter.call(el, val)
              else el.value = val
              el.dispatchEvent(new Event('input', { bubbles: true }))
              el.dispatchEvent(new Event('change', { bubbles: true }))
            }
            const pwd = document.querySelector('input[type="password"]')
            if (pwd && pass) setVal(pwd, pass)
            const usr = document.querySelector('input[type="email"], input[type="text"]')
            if (usr && user) setVal(usr, user)
          },
          args: [entry.username || '', entry.password || ''],
        })
      }
    })

    card.querySelector('.copy-user-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(entry.username || '')
    })
    card.querySelector('.copy-pwd-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(entry.password || '')
    })
    const totpBtn = card.querySelector('.copy-totp-btn')
    if (totpBtn) {
      totpBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(totpCode)
      })
    }

    return card
  }

  // Recherche dans tout le coffre
  const searchInput = document.getElementById('vault-search-input')
  const allSection = document.getElementById('all-section')
  const allList = document.getElementById('all-list')
  const matchingSection = document.getElementById('matching-section')

  searchInput.addEventListener('input', async () => {
    const q = searchInput.value.trim().toLowerCase()
    if (!q) {
      allSection.classList.add('hidden')
      matchingSection.classList.remove('hidden')
      return
    }

    matchingSection.classList.add('hidden')
    allSection.classList.remove('hidden')
    allList.innerHTML = ''

    const results = allEntries.filter((e) => {
      return (
        (e.title || '').toLowerCase().includes(q) ||
        (e.username || '').toLowerCase().includes(q) ||
        (e.url || '').toLowerCase().includes(q)
      )
    })

    if (results.length === 0) {
      allList.innerHTML = '<p class="empty-state">Aucun résultat trouvé.</p>'
    } else {
      for (const entry of results) {
        const card = await createEntryCard(entry)
        allList.appendChild(card)
      }
    }
  })

  // Générateur de mot de passe
  const genResult = document.getElementById('gen-result')
  const genLength = document.getElementById('gen-length')
  const genLengthVal = document.getElementById('gen-length-val')
  const genUpper = document.getElementById('gen-upper')
  const genLower = document.getElementById('gen-lower')
  const genDigits = document.getElementById('gen-digits')
  const genSymbols = document.getElementById('gen-symbols')

  function generatePassword() {
    let chars = ''
    if (genUpper.checked) chars += 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    if (genLower.checked) chars += 'abcdefghijkmnopqrstuvwxyz'
    if (genDigits.checked) chars += '23456789'
    if (genSymbols.checked) chars += '!@#$%^&*()-_=+'
    if (!chars) chars = 'abcdefghijkmnopqrstuvwxyz0123456789'

    const len = Number(genLength.value)
    genLengthVal.textContent = len
    const arr = new Uint32Array(len)
    window.crypto.getRandomValues(arr)
    const pwd = Array.from(arr, (x) => chars[x % chars.length]).join('')
    genResult.textContent = pwd
  }

  genLength.addEventListener('input', generatePassword)
  genUpper.addEventListener('change', generatePassword)
  genLower.addEventListener('change', generatePassword)
  genDigits.addEventListener('change', generatePassword)
  genSymbols.addEventListener('change', generatePassword)
  document.getElementById('gen-refresh-btn').addEventListener('click', generatePassword)
  document.getElementById('gen-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(genResult.textContent)
  })
  generatePassword()

  // Importation de fichier
  const importFile = document.getElementById('import-file')
  importFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      let imported = []
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        const data = JSON.parse(text)
        imported = Array.isArray(data) ? data : data.entries || data.items || []
      }
      if (imported.length > 0) {
        chrome.storage.local.set({ passapp_vault_entries: imported }, () => {
          alert(`${imported.length} identifiant(s) synchronisé(s) dans l'extension !`)
          reloadVaultData()
        })
      } else {
        alert('Aucun identifiant trouvé dans le fichier.')
      }
    } catch (err) {
      alert(`Erreur de lecture du fichier : ${err}`)
    }
  })

  // Vider le coffre
  document.getElementById('clear-vault-btn').addEventListener('click', () => {
    if (confirm('Voulez-vous supprimer les identifiants mis en cache dans cette extension ?')) {
      chrome.storage.local.remove(['passapp_vault_entries'], () => {
        reloadVaultData()
      })
    }
  })
})
