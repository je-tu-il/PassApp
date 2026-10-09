#[cfg(test)]
mod tests {
    use passapp_crypto_core::{decrypt, encrypt, CryptoError};
    use passapp_sync_core::{VaultDocument, VaultEntry};

    #[test]
    fn test_e2e_vault_lifecycle() {
        let master_password = b"SuperMasterPassword2026!";

        // 1. Création d'un coffre initial avec plusieurs entrées
        let mut document = VaultDocument::empty();
        document.updated_at = 1000;
        document.entries.push(VaultEntry {
            id: "id-github".to_owned(),
            title: "GitHub".to_owned(),
            username: "octocat@github.com".to_owned(),
            password: Some("ghp_secretToken123456".to_owned()),
            url: Some("https://github.com".to_owned()),
            notes: Some("Compte de développement personnel".to_owned()),
            category: "Travail".to_owned(),
            favorite: true,
            updated_at: 1000,
        });

        // 2. Sérialisation et chiffrement
        let serialized = serde_json::to_vec(&document).expect("Sérialisation réussie");
        let encrypted_payload = encrypt(master_password, &serialized).expect("Chiffrement réussi");

        // 3. Vérification du rejet en cas de mot de passe incorrect
        let wrong_password_result = decrypt(b"BadPassword!", &encrypted_payload);
        assert_eq!(wrong_password_result, Err(CryptoError::AuthenticationFailed));

        // 4. Déchiffrement avec le bon mot de passe maître
        let decrypted_bytes = decrypt(master_password, &encrypted_payload).expect("Déchiffrement réussi");
        let restored_doc: VaultDocument =
            serde_json::from_slice(&decrypted_bytes).expect("Désérialisation valide");

        assert_eq!(restored_doc.schema_version, 1);
        assert_eq!(restored_doc.entries.len(), 1);
        assert_eq!(restored_doc.entries[0].title, "GitHub");
        assert_eq!(
            restored_doc.entries[0].password.as_deref(),
            Some("ghp_secretToken123456")
        );

        // 5. Simulation d'un conflit multi-appareils (Local vs Remote)
        let mut local = restored_doc.clone();
        local.updated_at = 2000;
        local.entries[0].title = "GitHub Enterprise".to_owned();
        local.entries[0].updated_at = 2000;

        let mut remote = restored_doc.clone();
        remote.updated_at = 3000;
        remote.entries[0].title = "GitHub Pro".to_owned();
        remote.entries[0].updated_at = 3000; // Plus récent
        remote.entries.push(VaultEntry {
            id: "id-proton".to_owned(),
            title: "ProtonMail".to_owned(),
            username: "user@proton.me".to_owned(),
            password: Some("ProtonSecure987!".to_owned()),
            url: Some("https://mail.proton.me".to_owned()),
            notes: None,
            category: "Personnel".to_owned(),
            favorite: false,
            updated_at: 2500,
        });

        // 6. Fusion déterministe (CRDT-like)
        let merged = local.merge(&remote);
        assert_eq!(merged.entries.len(), 2);
        // L'entrée la plus récente l'emporte ("GitHub Pro" à t=3000 bat "GitHub Enterprise" à t=2000)
        let github_entry = merged.entries.iter().find(|e| e.id == "id-github").unwrap();
        assert_eq!(github_entry.title, "GitHub Pro");
        assert_eq!(github_entry.updated_at, 3000);

        let proton_entry = merged.entries.iter().find(|e| e.id == "id-proton").unwrap();
        assert_eq!(proton_entry.title, "ProtonMail");
    }
}
