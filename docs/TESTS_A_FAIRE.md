# Tests a faire - PassApp

Checklist de validation du projet. Cocher les tests au fur et a mesure et noter la date, l'environnement et le resultat dans `docs/AVANCEMENT.md`.

## 1. Tests deja automatises

- [x] `cargo test -p passapp-crypto-core`
- [x] Chiffrement puis dechiffrement avec le bon mot de passe
- [x] Refus d'un mauvais mot de passe
- [x] Detection d'un ciphertext modifie
- [x] Refus d'un payload avec format inconnu
- [x] Refus d'un nonce invalide
- [x] `cargo test -p passapp-sync-core`
- [x] Creation d'un document vide a la version courante
- [x] Fusion par UUID et horodatage le plus recent
- [x] Fusion commutative
- [x] Resolution deterministe des horodatages egaux
- [x] `cargo test --workspace`
- [x] `cargo check` du backend Tauri
- [x] `cargo fmt --all -- --check`
- [x] `npm run build`
- [x] `npm run lint`

## 2. Test manuel prioritaire du coffre

Environnement : Windows desktop avec Tauri.

- [X] Lancer l'application Tauri.
- [X] Verifier que le coffre demarre verrouille.
- [X] Saisir un mot de passe maitre et ouvrir un coffre neuf.
Il n'y a qu'un seul coffre
- [X] Verifier qu'un fichier `vault.passapp` est cree dans le repertoire applicatif. (Bouton d'acces direct ajoute dans le pied de page et la modale profil)
- [X] Verifier que le fichier ne contient pas le document en clair. (Chiffre AES-256-GCM / Argon2id)
- [X] Ajouter une entree.
- [X] Fermer puis relancer l'application.
- [X] Rouvrir le coffre avec le bon mot de passe.
- [X] Verifier que l'entree est toujours presente.
- [X] Verrouiller le coffre.
- [X] Verifier que les details et la liste des entrees disparaissent de l'interface au verrouillage.
- [X] Rouvrir avec un mauvais mot de passe et verifier le refus.
- [ ] Modifier le fichier du coffre et verifier le refus d'ouverture (MAC invalide).
- [X] Ouvrir un coffre avec un mot de passe vide et verifier le message d'erreur.

### Corrections et fonctionnalites implementees suite aux retours :
- **Emplacement du coffre** : le chemin physique est desormais affiche dans la modale Profil et un bouton "📁 Ouvrir dossier coffre" permet d'ouvrir directement l'Explorateur Windows sur le dossier du coffre.
- **Masquage au verrouillage** : lors du verrouillage, toutes les entrees sont purgees de la memoire React (`setEntries([])`) et le volet gauche affiche un panneau de securite verrouille.
- **Tri fonctionnel** : menu interactif pour trier par Nom (A→Z), Nom (Z→A) et Categorie.
- **Profil & Menus contextuels "..."** :
  - Clic sur le profil ou "..." du volet lateral : modale complete (infos profil, chemin du coffre, changement du mot de passe maitre, specs securite).
  - Clic sur "..." de l'entree : options Modifier, Basculer favori, Supprimer.
- **Gestion des mots de passe & secrets** : affichage masqué avec bascule œil (👁️/🙈), bouton copier avec notification "Copié !", et générateur de mot de passe fort (16 caractères aléatoires).
- **Sauvegardes automatiques** : retention tournante des 3 dernieres versions (`.passapp.bak1`, `.passapp.bak2`, `.passapp.bak3`).
## 3. Interface desktop

- [ ] Rechercher une entree existante.
- [ ] Rechercher une entree inexistante.
- [ ] Basculer entre `Mon coffre` et `Favoris`.
- [ ] Selectionner chaque entree.
- [ ] Ajouter plusieurs entrees.
- [ ] Verifier l'affichage d'un coffre vide.
- [ ] Verifier le raccourci clavier de recherche.
- [ ] Tester la fenetre redimensionnee.
- [ ] Tester une largeur mobile ou petite fenetre.
- [ ] Verifier l'absence de chevauchement et de texte coupe.
- [ ] Tester le mode navigateur verrouille avec `npm run dev` (demo sans chiffrement reel).
- [ ] Tester le coffre chiffre avec `npm run tauri:dev`.

## 4. Persistance et format

- [ ] Verifier qu'une ecriture interrompue ne detruit pas le fichier valide precedent.
- [ ] Verifier le remplacement atomique via fichier temporaire.
- [ ] Verifier la restauration apres fermeture forcee.
- [ ] Verifier le rejet d'un JSON invalide.
- [ ] Verifier le rejet d'un schema inconnu.
- [ ] Tester la creation des fichiers `.bak`.
- [ ] Tester la retention des trois dernieres versions.
- [ ] Tester une migration de schema.
- [ ] Tester la migration ou le rejet de l'ancien `vault.demo.json`.

## 5. Cryptographie et memoire

- [ ] Executer les vecteurs officiels AES-256-GCM.
- [ ] Verifier les limites minimales et maximales des parametres Argon2id.
- [ ] Tester un payload tronque.
- [ ] Tester un sel tronque.
- [ ] Tester un ciphertext vide.
- [ ] Tester un tres gros payload avec limites d'allocation.
- [ ] Verifier l'effacement des buffers sensibles avec les outils adaptes.
- [ ] Executer les tests sous Valgrind ou outil equivalent sur les cibles compatibles.
- [ ] Verifier qu'aucun secret n'apparait dans les logs.
- [ ] Verifier qu'aucun mot de passe n'est present dans le code ou la configuration.

## 6. Synchronisation et conflits

- [ ] Synchroniser deux clients sans conflit.
- [ ] Modifier le meme champ sur deux clients.
- [ ] Verifier que l'horodatage le plus recent gagne.
- [ ] Verifier le resultat deterministe en cas d'horodatage egal.
- [ ] Tester l'ajout concurrent de deux UUID differents.
- [ ] Tester une suppression concurrente.
- [ ] Tester un fichier distant corrompu.
- [ ] Tester une version distante plus ancienne.
- [ ] Tester iCloud Drive sur macOS/iOS.
- [ ] Tester la surveillance iCloud sous Windows.
- [ ] Tester Syncthing ou Git SSH sous Linux.

## 7. Plateformes

### Windows

- [ ] Build Tauri sur Windows.
- [ ] Test sur Lenovo ThinkPad T480.
- [ ] Test sur Lenovo V14.
- [ ] Verifier le nettoyage du presse-papiers.
- [ ] Verifier la restriction de capture via `SetWindowDisplayAffinity`.

### macOS

- [ ] Build desktop macOS.
- [ ] Acces au repertoire applicatif.
- [ ] Test iCloud Drive.
- [ ] Test Touch ID si disponible.

### iPhone/iPad

- [ ] Build SwiftUI.
- [ ] Authentification Face ID/Touch ID.
- [ ] Secure Enclave/LocalAuthentication.
- [ ] Extension Credential Provider.
- [ ] Autofill depuis Safari et les applications compatibles.
- [ ] Rafraichissement en arriere-plan.
- [ ] Installation et renouvellement via AltStore/SideStore.

### Linux

- [ ] Build desktop Linux.
- [ ] Test Syncthing.
- [ ] Test Git prive en SSH.
- [ ] Test des chemins et permissions du coffre.

### Android, cible future

- [ ] Definir l'integration Android.
- [ ] Reutiliser les contrats du noyau partage.
- [ ] Tester le stockage materiel et la biometrie Android.
- [ ] Tester l'autofill Android.

## 8. Proxy favicon

- [ ] Demarrer le proxy Raspberry Pi 5.
- [ ] Verifier TLS strict.
- [ ] Verifier les destinations autorisees.
- [ ] Verifier qu'aucune cle ou donnee du coffre n'est transmise.
- [ ] Verifier l'IP visible depuis le serveur favicon.
- [ ] Tester proxy indisponible.
- [ ] Tester la desactivation du proxy.
- [ ] Analyser les paquets avec Wireshark.

## 9. Regles de validation

Un test echoue doit etre note avec :

- date et machine ;
- commande ou scenario exact ;
- resultat attendu ;
- resultat obtenu ;
- log utile sans secret ;
- ticket ou correction associee.

Aucun test de production ne doit utiliser un mot de passe reel dans les logs, fixtures, captures ou fichiers de diagnostic.
