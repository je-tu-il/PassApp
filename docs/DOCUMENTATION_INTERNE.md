# Documentation interne PassApp

## 1. Mission

PassApp gere des secrets localement, sans backend proprietaire obligatoire. Les donnees du coffre sont chiffrees avant toute synchronisation et restent lisibles uniquement par les clients autorises.

Les objectifs principaux sont :

- souverainete de la cle et des donnees ;
- fonctionnement local-first ;
- synchronisation asynchrone par fichiers ;
- fusion deterministe des modifications concurrentes ;
- integration biometrie et stockage materiel selon la plateforme ;
- verification progressive, reproductible et documentee.

## 2. Limites de responsabilite

### Interface desktop

`apps/desktop` contiendra la presentation React/TypeScript et l'integration Tauri. Elle orchestre les actions utilisateur mais ne doit pas devenir l'emplacement des primitives cryptographiques.

Le premier ecran desktop expose une navigation de coffre, une recherche locale, une selection d'entree, un verrouillage d'interface et la creation d'une entree de demonstration. Le statut de verrouillage est maintenant transmis au backend Tauri par les commandes `get_app_status` et `set_vault_locked`.

Le backend Tauri demarre verrouille. `open_vault` recoit le mot de passe fourni par l'utilisateur, lit `vault.passapp`, dechiffre le payload et place temporairement le document en memoire. En premiere utilisation, il cree un document vide puis l'enregistre chiffre. `get_vault_entries` et `create_vault_entry` refusent l'acces lorsque le coffre est verrouille. `set_vault_locked(true)` efface le document et le mot de passe de session.

`npm run dev` lance uniquement Vite et utilise un mode navigateur de demonstration qui demarre verrouille ; le bouton `Deverrouiller la demo` revele des donnees fictives sans chiffrement. Le test du vrai coffre chiffre doit etre execute avec `npm run tauri:dev`.

Le fichier `vault.passapp` contient un payload JSON chiffre avec Argon2id et AES-256-GCM ; il ne doit jamais contenir le document en clair. L'ancien fichier `vault.demo.json`, s'il existe, n'est pas migre automatiquement et ne doit pas etre utilise pour des secrets.

Le modele `sync-core` definit maintenant `VaultDocument` (version de schema, date de modification et liste d'entrees) et `VaultEntry` (UUID logique, champs affichables, favori et `updated_at`). La fusion combine les UUID, conserve la version la plus recente et applique un tie-breaker stable lorsque deux versions ont le meme horodatage. Le document est trie par identifiant pour produire un resultat reproductible.

Le crate `crypto-core` definit le payload chiffre version 1. Argon2id derive une cle de 32 octets a partir du mot de passe et d'un sel de 16 octets ; AES-256-GCM chiffre avec un nonce de 12 octets et fournit l'authentification integree. Les parametres KDF sont conserves dans le payload. La cle derivee est zeroisee apres chiffrement ou dechiffrement. Aucun mot de passe de demonstration ne doit etre ajoute au code ou au fichier de configuration.

### Noyau Rust

`crates/crypto-core` sera responsable de la derivation de cle, du chiffrement authentifie, du dechiffrement et du nettoyage explicite des buffers. Il sera la source de verite partagee avec la cible WASM.

`crates/sync-core` sera responsable du modele arborescent du coffre, des UUID persistants, des horodatages, de la fusion champ par champ et des sauvegardes locales.

### Application iOS

`apps/ios` contiendra l'application SwiftUI pour iPhone/iPad, l'authentification via LocalAuthentication et l'extension Credential Provider. Les appels au coeur partage devront etre delimites par un contrat stable.

Android est une cible future. Son integration devra reutiliser les contrats et le noyau partage quand les choix d'integration systeme seront arretes ; elle n'est pas incluse dans le premier prototype.

### Contrats

`packages/contracts` documentera les structures et versions echangees entre les couches. Un changement de format devra etre versionne et accompagne d'une migration ou d'un refus explicite.

## 3. Flux de donnees nominal

1. L'utilisateur demande l'ouverture du coffre.
2. La plateforme obtient une autorisation locale, par mot de passe maitre et/ou biometrie.
3. Le coeur derive une cle avec Argon2id selon les parametres de l'en-tete.
4. Le coeur verifie le tag AES-256-GCM avant de fournir un contenu exploitable.
5. L'interface manipule un modele en memoire limite au temps necessaire.
6. A l'enregistrement, le coffre est chiffre avant d'etre remis au fournisseur de fichiers.
7. La synchronisation detecte les versions distantes et demande une fusion deterministe si necessaire.

Aucune implementation ne doit supposer qu'un fichier distant est fiable, recent ou lisible avant verification cryptographique.

## 4. Format logique du coffre

Le format cible est une structure arborescente inspiree de KDBX, mais son schema exact reste a figer lors de l'etape 3. Chaque dossier, entree et champ devra posseder :

- un UUID stable ;
- une valeur versionnee ;
- un horodatage de derniere modification ;
- une information de suppression logique si necessaire ;
- les metadonnees minimales utiles a la fusion.

Les trois dernieres versions locales seront conservees en `.bak`. La politique de retention et la gestion des fichiers temporaires seront testees avant activation de la synchronisation.

## 5. Securite cryptographique

La specification impose Argon2id et AES-256-GCM. Les parametres KDF doivent etre stockes dans l'en-tete et controles par des limites de securite avant allocation. Toute erreur d'authentification doit interrompre la lecture sans exposer de contenu partiel.

Le module Rust/WASM devra effacer explicitement les buffers sensibles quand leur duree de vie se termine. Cette garantie sera documentee comme une mitigation, pas comme une promesse absolue contre toutes les copies effectuees par le runtime ou le systeme d'exploitation.

Les secrets ne doivent pas etre journalises. Les messages d'erreur destines a l'interface doivent etre generiques et les details de diagnostic doivent rester locaux et non sensibles.

## 6. Synchronisation et conflits

Les fournisseurs de fichiers sont des transports, pas des autorites de verite. Les versions recues sont verifiees, decryptees, comparees puis fusionnees par `sync-core`.

La fusion nominale est champ par champ et privilegie le dernier horodatage valide. Les egalites d'horodatage et les suppressions concurrentes devront avoir une regle deterministe testee. Toute fusion non resolvable doit produire un resultat explicite plutot qu'ecraser silencieusement une valeur.

## 7. Proxy favicon

Le proxy Raspberry Pi est limite aux requetes de metadonnees visuelles autorisees. Il ne recoit jamais la cle du coffre. La configuration devra imposer TLS, limiter les destinations et eviter de transmettre des identifiants ou des URLs contenant des secrets.

Cette fonctionnalite sera optionnelle et desactivable. L'application doit rester utilisable sans proxy.

## 8. Strategie de tests

Chaque etape doit avoir un test local peu couteux avant les validations physiques :

- tests unitaires du format et de la fusion ;
- vecteurs officiels pour AES-256-GCM ;
- tests de propriete pour les regles de fusion ;
- tests d'integration du watcher de fichiers ;
- tests de non-regression du nettoyage du presse-papiers ;
- build desktop et iOS sur les environnements reels ;
- verification reseau du proxy avec capture controlee.

Les tests qui exigent du materiel, une signature Apple ou un Raspberry Pi seront marques comme validations externes et ne bloqueront pas les tests unitaires locaux.

## 9. Regles de contribution interne

- Une modification de format ou de protocole doit mettre a jour cette documentation et `docs/AVANCEMENT.md`.
- Toute primitive de securite doit etre accompagnee d'un test negatif, pas seulement d'un cas nominal.
- Les dependances doivent etre versionnees explicitement et leur justification conservee dans les decisions d'architecture.
- Les secrets de developpement ne doivent jamais etre commites.
- Les validations executees et leurs limites doivent etre notees dans l'avancement.
