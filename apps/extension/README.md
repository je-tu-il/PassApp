# PassApp - Extension Navigateur (Autofill & 2FA) 🛡️

Extension de remplissage automatique et d'authentification 2FA universelle (Manifest V3) pour **Google Chrome**, **Microsoft Edge**, **Brave**, **Opera** et **Mozilla Firefox**.

---

## Fonctionnalités

1. ⚡ **Remplissage automatique discret (Autofill)** :
   - Détection intelligente des formulaires de connexion (compatible avec les applications dynamiques React, Vue, Angular).
   - Bouton bouclier PassApp discret intégré dans les champs mot de passe.
   - Menu déroulant contextuel affichant les comptes enregistrés pour le domaine en cours.
   - **Raccourci clavier universel** : `Ctrl+Shift+L` (ou `Cmd+Shift+L` sur Mac) pour remplir instantanément le premier compte correspondant sans toucher à la souris.
2. 🔑 **Générateur 2FA TOTP en direct** :
   - Codes à usage unique RFC 6238 calculés localement avec Web Crypto.
   - Compte à rebours de 30 secondes en temps réel.
   - Copie en 1 clic.
3. 🎲 **Générateur de mots de passe aléatoires forts** :
   - Longueur paramétrable (8 à 40 caractères) avec symboles, chiffres et lettres.
4. 🔄 **Synchronisation & Importation souveraine** :
   - Importation directe du fichier JSON de sauvegarde exporté depuis l'application PassApp Desktop.
   - Vos clés et mots de passe sont stockés localement dans le stockage sécurisé de votre navigateur sans aucun tracking.

---

## Instructions d'installation sur Windows / Mac / Linux

### 1. Sur Google Chrome, Brave ou Opera :
1. Ouvrez `chrome://extensions/` dans votre navigateur.
2. Activez le bouton bascule **Mode développeur** (en haut à droite).
3. Cliquez sur le bouton **Charger l'extension non empaquetée** (en haut à gauche).
4. Sélectionnez le dossier `apps/extension` du dépôt PassApp.
5. L'icône PassApp apparaît dans la barre d'outils de votre navigateur ! Épinglez-la pour un accès rapide.

### 2. Sur Microsoft Edge :
1. Ouvrez `edge://extensions/` dans votre navigateur.
2. Activez **Mode développeur** dans la barre latérale gauche.
3. Cliquez sur **Charger les fichiers décompressés**.
4. Sélectionnez le dossier `apps/extension`.

### 3. Sur Mozilla Firefox :
1. Ouvrez `about:debugging#/runtime/this-firefox` dans Firefox.
2. Cliquez sur **Charger un module temporaire...**.
3. Sélectionnez le fichier `apps/extension/manifest.json`.

---

## Utilisation

- Rendez-vous sur n'importe quel site (ex: `github.com`, `google.com`, etc.).
- Cliquez sur l'icône PassApp dans la barre d'extension ou directement sur le bouclier situé dans le champ mot de passe.
- Vous pouvez également appuyer sur `Ctrl+Shift+L` à tout moment pour remplir automatiquement !
