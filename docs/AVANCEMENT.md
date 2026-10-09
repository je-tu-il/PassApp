# Avancement PassApp

Derniere mise a jour : 2026-09-08

## Etape 1 - Cadrage et fondations

Statut : terminee

Objectifs :

- transformer la specification initiale en limites de modules explicites ;
- definir une arborescence de depot compatible desktop, iOS et noyau Rust ;
- centraliser les decisions structurantes et les risques connus ;
- preparer une verification reproductible avant toute implementation sensible.

Livrables :

- documentation interne initiale ;
- decisions d'architecture initiales ;
- README de demarrage ;
- dossiers cibles pour les applications, crates, contrats et tests.
- checklist centralisee des tests dans `docs/TESTS_A_FAIRE.md`.

Verification realisee :

- le workspace contenait uniquement `Specification.txt` avant cette etape ;
- Node.js est disponible via `npm.cmd` ;
- la structure documentaire et les liens du README ont ete controles ;
- les plateformes macOS, Windows, Linux, iPhone/iPad et Android futur sont documentees.

## Etape 2 - En cours : outillage et squelette executable

Prerequis :

- installer Rust stable et les composants WASM ;
- choisir et installer la version Node/npm ou un gestionnaire equivalent ;
- figer les versions Tauri, React, TypeScript et des dependances cryptographiques ;
- ajouter les premiers checks automatises.

Progression :

- toolchain Rust stable active : `rustc 1.98.1`, `cargo 1.98.1` ;
- workspace Cargo cree avec `crypto-core` et `sync-core` ;
- tests de demarrage ajoutes dans les deux crates ;
- `cargo test --workspace` passe avec 2 tests reussis.
- frontend Vite React/TypeScript genere dans `apps/desktop` ;
- configuration Tauri 2 generee dans `apps/desktop/src-tauri` ;
- `npm run build` frontend passe ;
- scripts `tauri:dev` et `tauri:build` ajoutes ;
- premier ecran PassApp implemente avec navigation, recherche, selection, verrouillage simule et ajout d'entree ;
- contrat TypeScript initial ajoute dans `apps/desktop/src/contracts.ts` ;
- identifiant Tauri remplace par `com.passapp.desktop`.
- interface connectee aux commandes Tauri `get_app_status` et `set_vault_locked` ;
- fallback navigateur conserve pour les essais Vite hors application native.
- modele `VaultDocument`/`VaultEntry` versionne ajoute dans `crates/sync-core` ;
- fusion deterministe par UUID et `updated_at`, avec regle d'egalite testee ;
- cinq tests `sync-core` passent.
- persistance locale JSON de demonstration ajoutee dans le repertoire applicatif Tauri ;
- commandes `get_vault_entries` et `create_vault_entry` connectees a React.
- noyau `crypto-core` implemente avec Argon2id, AES-256-GCM et zeroisation de cle ;
- payload chiffre versionne avec sel, nonce et parametres KDF ;
- quatre tests crypto passent, dont mauvais mot de passe et detection d'alteration.
- toolchain Rust active : `rustc 1.99.0`, `cargo 1.99.0` (toolchain GNU avec GCC 16.2.0 WinLibs UCRT) ;
- workspace Cargo operationnel avec `crypto-core`, `sync-core` et `app` desktop ;
- `crates/sync-core` etendu avec champs `password`, `url`, `notes` et retrocompatibilite de schema validee ;
- `cargo test --workspace` passe avec 10 tests reussis (4 crypto, 6 sync) ;
- persistance atomique avec rotation securisee des 3 dernieres sauvegardes (`.passapp.bak1`, `.passapp.bak2`, `.passapp.bak3`) ;
- commandes Tauri etendues : CRUD complet (`create_vault_entry`, `update_vault_entry`, `delete_vault_entry`), `change_master_password`, et `open_vault_directory` ;
- chemin physique du coffre (`vault_path`) expose au frontend ;
- interface React securisee : suppression complete des entrees en memoire et masquage lors du verrouillage ;
- tri des entrees fonctionnel (A-Z, Z-A, categorie) ;
- modale Profil & Coffre operationnelle (affichage du chemin du coffre, bouton pour ouvrir l'Explorateur Windows, specs cryptographiques, changement de mot de passe maitre) ;
- menu contextuel `...` par entree (edition, favori, suppression) ;
- affichage/masquage (oeil) du mot de passe des entrees, bouton copie avec feedback et generateur de mot de passe fort ;
- `npm run build` passe sans erreur TypeScript/Vite ;
- `npm run lint` passe sans aucun avertissement.

Verification complementaire :

- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passe ;
- `cargo test --workspace` passe (10 tests reussis) ;
- `cargo fmt --all -- --check` passe ;
- `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml` passe (`target/debug/app.exe` genere).

## Etapes suivantes

1. Synchronisation de fichiers (iCloud Drive / Syncthing / Git SSH).
2. Proxy anonymiseur de favicon (Raspberry Pi 5 / démon Nginx-Squid TLS).
3. Integration iOS native (SwiftUI, Secure Enclave, Credential Provider Autofill).
4. Durcissement memoire (Valgrind / zeroisation pousse) et restrictions de capture d'ecran (`SetWindowDisplayAffinity`).
