# PassApp

PassApp est un gestionnaire de mots de passe local-first et multiplateforme.

Les cibles sont macOS, Windows et Linux sur desktop, iPhone/iPad sur mobile, puis Android dans une etape future.

Le projet est construit par etapes verifiables. La specification fonctionnelle et technique initiale se trouve dans `Specification.txt`. La documentation de travail est centralisee dans `docs/`.

## Etat actuel

Etape 1 : cadrage technique, structure du depot et documentation initiale.

Le code applicatif n'est pas encore implemente. L'installation de Rust est necessaire avant de lancer le noyau Tauri/Rust et les modules cryptographiques.

## Structure cible

- `apps/desktop` : application Tauri avec interface React/TypeScript.
- `apps/ios` : application SwiftUI et extension Credential Provider.
- `crates/crypto-core` : primitives cryptographiques Rust/WASM.
- `crates/sync-core` : modele de coffre, fusion et historique.
- `packages/contracts` : contrats de donnees partages.
- `docs` : suivi, decisions et documentation interne.

## Documentation

- [Avancement](docs/AVANCEMENT.md)
- [Documentation interne](docs/DOCUMENTATION_INTERNE.md)
- [Decisions d'architecture](docs/DECISIONS_ARCHITECTURE.md)
- [Checklist des tests](docs/TESTS_A_FAIRE.md)
