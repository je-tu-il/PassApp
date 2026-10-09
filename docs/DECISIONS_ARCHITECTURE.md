# Decisions d'architecture initiales

## DA-001 - Architecture multi-cible

Statut : acceptee

PassApp est organise autour d'un noyau Rust reutilisable, d'une interface Tauri/React pour le desktop et d'une application SwiftUI pour iOS. Cette separation correspond aux besoins d'acces systeme et evite de placer la cryptographie dans la couche d'interface.

## DA-002 - Local-first sans backend proprietaire

Statut : acceptee

Le coffre est utilisable sans service PassApp distant. La synchronisation s'appuie sur des fournisseurs de fichiers et ne doit jamais necessiter l'envoi de donnees en clair.

## DA-003 - Format arborescent versionne

Statut : a preciser a l'etape 3

Le modele logique utilise des UUID persistants, des horodatages et une fusion deterministe. Le schema binaire, la representation des suppressions et les regles d'egalite temporelle restent a formaliser avant implementation.

## DA-004 - Cryptographie dans Rust/WASM

Statut : acceptee sous reserve de validation

Le chemin de chiffrement/dechiffrement sera implemente dans Rust et expose au desktop via Tauri et, lorsque necessaire, via WASM. L'effacement explicite des buffers sera teste et documente comme une mitigation de gestion memoire.

## DA-005 - Etapes avec criteres de sortie

Statut : acceptee

Aucune etape ne sera consideree terminee sans un livrable et une verification associee. Les validations dependantes d'un appareil physique seront separees des checks executables localement.

## Points a trancher

- version exacte du format de coffre et strategie de migration ;
- bibliotheque Rust retenue pour Argon2id et AES-256-GCM ;
- protocole d'appel Tauri/WASM et politique de copie des donnees ;
- fournisseur iCloud/Syncthing prioritaire pour le premier prototype ;
- methode de signature et de distribution iOS ;
- politique de verrouillage automatique et de nettoyage du presse-papiers.
