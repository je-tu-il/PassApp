# 🔐 PassApp — Gestionnaire de Mots de Passe Local-First & Multiplateforme

[![Release](https://img.shields.io/github/v/release/je-tu-il/PassApp?color=blue&label=Version)](https://github.com/je-tu-il/PassApp/releases/latest)
[![Build & Release](https://github.com/je-tu-il/PassApp/actions/workflows/build.yml/badge.svg)](https://github.com/je-tu-il/PassApp/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Plateformes-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20iOS-orange.svg)](https://github.com/je-tu-il/PassApp/releases/latest)

> **PassApp** est un coffre-fort de mots de passe souverain, rapide et moderne. Vos identifiants restent **100% sur votre appareil**, chiffrés avec les standards les plus stricts de la cryptographie moderne. Aucun compte en ligne obligatoire, aucun abonnement, zéro tracking.

---

## 🚀 Téléchargement Direct & Installation (Pour tous)

Rendez-vous sur la page des [**Dernières Versions (Releases)**](https://github.com/je-tu-il/PassApp/releases/latest) et téléchargez le fichier correspondant à votre appareil :

| Système | Fichier à télécharger | Guide d'installation simple |
| :--- | :--- | :--- |
| 🪟 **Windows** | `PassApp_*_x64-setup.exe` ou `.msi` | Double-cliquez sur l'installateur et laissez-vous guider. L'application apparaîtra dans votre menu Démarrer. |
| 🍏 **macOS** | `PassApp_*_universal.dmg` | Ouvrez le `.dmg` et glissez l'icône **PassApp** dans votre dossier **Applications**. |
| 🐧 **Linux** | `PassApp_*_amd64.AppImage` ou `.deb` | Pour l'AppImage : clic-droit → Propriétés → Autoriser l'exécution, puis double-cliquez. Pour Debian/Ubuntu : `sudo dpkg -i PassApp_*.deb`. |
| 📱 **iOS (iPhone/iPad)** | `PassApp-AltStore.ipa` | Installez via [AltStore](https://altstore.io/), [SideStore](https://sidestore.io/) ou [Sideloadly](https://sideloadly.io/). |

---

## ✨ Fonctionnalités Clés

- 🛡️ **Sécurité Militaire** : Chiffrement authentifié **AES-256-GCM** avec tag MAC 128 bits. Dérivation de clé maîtresse via **Argon2id** (protection matérielle contre les attaques par force brute GPU/ASIC).
- 🎲 **Générateur Haute Entropie** : Créez des mots de passe incassables sur-mesure (longueur 8 à 48 caractères, majuscules, minuscules, chiffres, symboles, exclusion des caractères visuellement ambigus).
- 📊 **Analyseur en Temps Réel** : Évaluation instantanée de la robustesse (entropie en bits) et détection des doublons ou mots de passe faibles.
- ⏱️ **Générateur 2FA / TOTP intégré** : Génération directe de vos codes d'authentification à deux facteurs temporisés sans nécessiter d'autre application.
- 📋 **Presse-Papier Sécurisé** : Nettoyage automatique de la mémoire du presse-papier après 30 secondes pour empêcher toute interception par d'autres applications.
- 🔒 **Verrouillage Automatique** : Verrouillage paramétrable en cas d'inactivité ou à la fermeture de l'écran.
- 💾 **Sauvegarde & Restauration** : Export et import de sauvegardes JSON chiffrées pour sauvegarder ou synchroniser manuellement vos appareils en toute souveraineté.
- 🌐 **Extension Navigateur & iOS Credential Provider** : Remplissage rapide dans vos navigateurs et applications favorites.

---

## 🛠️ Architecture Technique

PassApp repose sur un monorepo modulaire hautement performant :

```text
PassApp/
├── apps/
│   ├── desktop/       # Application Tauri v2 + React / TypeScript / Vite
│   ├── extension/     # Extension de navigateur WebExtensions (Chrome/Firefox)
│   └── ios/           # Application native iOS SwiftUI + Credential Provider
├── crates/
│   ├── crypto-core/   # Noyau cryptographique Rust (AES-GCM, Argon2id, SHA-256)
│   └── sync-core/     # Moteur de synchronisation local et fusion de versions
├── packages/
│   └── contracts/     # Définition des types et schémas TypeScript partagés
└── docs/              # Spécifications détaillées et décisions d'architecture
```

---

## 💻 Développement Local

### Prérequis
- [Node.js](https://nodejs.org/) (v20+)
- [Rust & Cargo](https://rustup.rs/) (stable)
- Sur Linux : `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`

### Démarrage de l'application Desktop
```bash
# Dépendances de l'interface
cd apps/desktop
npm install

# Lancement en mode développement (Tauri + Vite)
npm run tauri dev
```

### Tests des modules Rust
```bash
cargo test --workspace
```

---

## 📄 Licence

Ce projet est sous licence **MIT** — vous êtes libre de l'utiliser, le modifier et le distribuer. Voir le fichier [LICENSE](LICENSE) pour plus de détails.
