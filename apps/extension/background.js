/**
 * PassApp - Background Service Worker (Manifest V3)
 * Gère le raccourci global Ctrl+Shift+L et la communication inter-scripts.
 */

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'autofill') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'passapp_autofill' }).catch(() => {
        // Le content script peut ne pas être injecté sur les pages spéciales (ex: chrome://)
      })
    }
  }
})

// Communication avec content scripts et popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_matching_entries') {
    chrome.storage.local.get(['passapp_vault_entries'], (result) => {
      const allEntries = result.passapp_vault_entries || []
      const url = request.url || ''
      let domain = ''
      try {
        domain = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        domain = url
      }

      const matches = allEntries.filter((entry) => {
        if (!entry.url && !entry.title) return false
        const entryDomain = (entry.url || '').toLowerCase()
        const entryTitle = (entry.title || '').toLowerCase()
        const targetDomain = domain.toLowerCase()
        return (
          (entryDomain && targetDomain && (entryDomain.includes(targetDomain) || targetDomain.includes(entryDomain))) ||
          (entryTitle && targetDomain && targetDomain.includes(entryTitle))
        )
      })

      sendResponse({ matches, domain })
    })
    return true // Réponse asynchrone
  }
})
