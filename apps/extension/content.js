/**
 * PassApp - Content Script (Remplissage automatique & Détection de formulaires)
 */

;(function () {
  let activeMenu = null

  // Fonction pour injecter la valeur avec déclenchement des événements réactifs (React, Vue, Angular)
  function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set
    const prototype = Object.getPrototypeOf(element)
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value)
    } else if (valueSetter) {
      valueSetter.call(element, value)
    } else {
      element.value = value
    }

    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new Event('blur', { bubbles: true }))
  }

  // Recherche du champ nom d'utilisateur associé à un champ mot de passe
  function findUsernameInput(passwordInput) {
    const form = passwordInput.form
    if (form) {
      // 1. Recherche par attributs standards
      const explicit = form.querySelector(
        'input[autocomplete="username"], input[autocomplete="email"], input[type="email"]',
      )
      if (explicit) return explicit

      // 2. Recherche par nom usuel
      const byName = form.querySelector(
        'input[name*="user" i], input[name*="login" i], input[name*="email" i], input[name*="identifiant" i]',
      )
      if (byName) return byName

      // 3. Tout champ texte précédant le mot de passe dans le formulaire
      const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])'))
      const pwdIndex = inputs.indexOf(passwordInput)
      if (pwdIndex > 0) {
        return inputs[pwdIndex - 1]
      }
    }

    // Hors formulaire : recherche dans le document avant le mot de passe
    const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"]'))
    return allInputs[allInputs.length - 1] || null
  }

  // Remplissage effectif des identifiants
  function autofillCredentials(entry, passwordInput) {
    if (entry.password) {
      setNativeValue(passwordInput, entry.password)
    }
    const usernameInput = findUsernameInput(passwordInput)
    if (usernameInput && entry.username) {
      setNativeValue(usernameInput, entry.username)
    }

    // Notification toast temporaire
    showToast(`PassApp : Identifiants remplis pour ${entry.title || entry.username}`)
    closeMenu()
  }

  // Affichage d'un toast discret dans la page
  function showToast(message) {
    const existing = document.getElementById('passapp-inline-toast')
    if (existing) existing.remove()

    const toast = document.createElement('div')
    toast.id = 'passapp-inline-toast'
    toast.innerHTML = `<span style="font-size: 16px;">🛡️</span> <span>${message}</span>`
    document.body.appendChild(toast)

    setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transform = 'translateY(10px)'
      setTimeout(() => toast.remove(), 300)
    }, 2500)
  }

  function closeMenu() {
    if (activeMenu) {
      activeMenu.remove()
      activeMenu = null
    }
  }

  // Affichage du menu déroulant PassApp
  function openDropdownMenu(badge, passwordInput, matches) {
    closeMenu()

    const rect = passwordInput.getBoundingClientRect()
    const menu = document.createElement('div')
    menu.className = 'passapp-floating-menu'
    menu.style.top = `${window.scrollY + rect.bottom + 6}px`
    menu.style.left = `${window.scrollX + rect.left}px`
    menu.style.minWidth = `${Math.max(rect.width, 240)}px`

    const header = document.createElement('div')
    header.className = 'passapp-menu-header'
    header.innerHTML = `<span>🛡️ PassApp</span> <small>${matches.length} compte(s) trouvé(s)</small>`
    menu.appendChild(header)

    const list = document.createElement('div')
    list.className = 'passapp-menu-list'

    matches.forEach((entry) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'passapp-menu-item'
      item.innerHTML = `
        <div class="passapp-item-info">
          <strong>${entry.title || 'Identifiant'}</strong>
          <small>${entry.username || 'Sans nom d\'utilisateur'}</small>
        </div>
        ${entry.totpSecret ? '<span class="passapp-totp-tag">🔑 2FA</span>' : ''}
      `
      item.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        autofillCredentials(entry, passwordInput)
      })
      list.appendChild(item)
    })

    menu.appendChild(list)
    document.body.appendChild(menu)
    activeMenu = menu

    // Fermeture si clic à l'extérieur
    const handleOutsideClick = (e) => {
      if (!menu.contains(e.target) && e.target !== badge) {
        closeMenu()
        document.removeEventListener('click', handleOutsideClick)
      }
    }
    setTimeout(() => document.addEventListener('click', handleOutsideClick), 10)
  }

  // Attachement du badge PassApp à un champ mot de passe
  function attachBadgeToInput(input) {
    if (input.dataset.passappAttached) return
    input.dataset.passappAttached = 'true'

    // Création du bouton flottant
    const badge = document.createElement('button')
    badge.type = 'button'
    badge.className = 'passapp-field-badge'
    badge.title = 'Remplir avec PassApp (Ctrl+Shift+L)'
    badge.innerHTML = `🛡️`

    badge.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()

      chrome.runtime.sendMessage(
        { action: 'get_matching_entries', url: window.location.href },
        (response) => {
          const matches = response?.matches || []
          if (matches.length > 0) {
            openDropdownMenu(badge, input, matches)
          } else {
            showToast('Aucun identifiant enregistré pour ce site dans PassApp')
          }
        },
      )
    })

    // Insère le badge dans un conteneur relatif ou à côté du champ
    const parent = input.parentElement
    if (parent && getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative'
    }
    input.insertAdjacentElement('afterend', badge)

    // Positionnement dynamique
    function updatePosition() {
      const rect = input.getBoundingClientRect()
      badge.style.top = `${rect.top + window.scrollY + (rect.height - 24) / 2}px`
      badge.style.left = `${rect.right + window.scrollX - 30}px`
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition)
  }

  // Scan initial et observation des mutations (SPAs)
  function scanInputs() {
    const passwordInputs = document.querySelectorAll('input[type="password"]')
    passwordInputs.forEach(attachBadgeToInput)
  }

  scanInputs()
  const observer = new MutationObserver(() => scanInputs())
  observer.observe(document.body, { childList: true, subtree: true })

  // Écouteur pour le raccourci global (Ctrl+Shift+L)
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'passapp_autofill') {
      const passwordInput = document.querySelector('input[type="password"]')
      if (!passwordInput) return

      chrome.runtime.sendMessage(
        { action: 'get_matching_entries', url: window.location.href },
        (response) => {
          const matches = response?.matches || []
          if (matches.length > 0) {
            autofillCredentials(matches[0], passwordInput)
          } else {
            showToast('Aucun identifiant trouvé pour ce site')
          }
        },
      )
    }
  })
})()
