#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct VaultAttachment {
    pub id: String,
    pub name: String,
    pub size: u64,
    #[serde(alias = "mimeType")]
    pub mime_type: String,
    pub data: String, // Contenu du fichier encodé en base64
    #[serde(default, alias = "updatedAt")]
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct VaultEntry {
    pub id: String,
    pub title: String,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default, alias = "totpSecret")]
    pub totp_secret: Option<String>,
    pub category: String,
    pub favorite: bool,
    #[serde(alias = "updatedAt")]
    pub updated_at: u64,
    #[serde(default)]
    pub folder: Option<String>, // Ex: "Personnel/Banque" ou "Travail/Projets"
    #[serde(default, alias = "itemType")]
    pub item_type: Option<String>, // "login", "note", "file"
    #[serde(default)]
    pub attachments: Vec<VaultAttachment>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct VaultDocument {
    pub schema_version: u32,
    pub updated_at: u64,
    pub entries: Vec<VaultEntry>,
    #[serde(default, alias = "customFolders")]
    pub custom_folders: Vec<String>, // Liste des dossiers et sous-dossiers créés
}

impl VaultDocument {
    pub fn empty() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            updated_at: 0,
            entries: Vec::new(),
            custom_folders: Vec::new(),
        }
    }

    pub fn merge(&self, remote: &Self) -> Self {
        let mut merged = BTreeMap::new();
        for entry in self.entries.iter().chain(remote.entries.iter()) {
            merged
                .entry(entry.id.clone())
                .and_modify(|current: &mut VaultEntry| {
                    if entry.updated_at > current.updated_at
                        || (entry.updated_at == current.updated_at
                            && tie_break_key(entry) > tie_break_key(current))
                    {
                        *current = entry.clone();
                    }
                })
                .or_insert_with(|| entry.clone());
        }

        let mut folders_set = std::collections::BTreeSet::new();
        folders_set.extend(self.custom_folders.iter().cloned());
        folders_set.extend(remote.custom_folders.iter().cloned());

        Self {
            schema_version: self.schema_version.max(remote.schema_version),
            updated_at: self.updated_at.max(remote.updated_at),
            entries: merged.into_values().collect(),
            custom_folders: folders_set.into_iter().collect(),
        }
    }
}

fn tie_break_key(entry: &VaultEntry) -> (&str, &str, &str, bool) {
    (
        &entry.title,
        &entry.username,
        &entry.category,
        entry.favorite,
    )
}

/// Returns the crate identity used by startup and integration checks.
pub fn crate_identity() -> &'static str {
    "passapp-sync-core"
}

#[cfg(test)]
mod tests {
    use super::{crate_identity, VaultDocument, VaultEntry, CURRENT_SCHEMA_VERSION};

    fn entry(id: &str, title: &str, updated_at: u64) -> VaultEntry {
        VaultEntry {
            id: id.to_owned(),
            title: title.to_owned(),
            username: "user".to_owned(),
            password: Some("secret123".to_owned()),
            url: Some("https://example.com".to_owned()),
            notes: None,
            totp_secret: None,
            category: "Personnel".to_owned(),
            favorite: false,
            updated_at,
            folder: None,
            item_type: Some("login".to_owned()),
            attachments: Vec::new(),
        }
    }

    #[test]
    fn exposes_expected_identity() {
        assert_eq!(crate_identity(), "passapp-sync-core");
    }

    #[test]
    fn creates_current_empty_document() {
        let doc = VaultDocument::empty();
        assert_eq!(doc.schema_version, CURRENT_SCHEMA_VERSION);
        assert!(doc.custom_folders.is_empty());
    }

    #[test]
    fn merge_prefers_newest_entry_and_orders_by_id() {
        let local = VaultDocument {
            schema_version: 1,
            updated_at: 10,
            entries: vec![entry("b", "Ancien", 1), entry("a", "Local", 5)],
            custom_folders: vec!["Personnel/Banque".to_owned()],
        };
        let remote = VaultDocument {
            schema_version: 2,
            updated_at: 12,
            entries: vec![entry("b", "Distant", 4), entry("c", "Nouveau", 2)],
            custom_folders: vec!["Travail/Clients".to_owned(), "Personnel/Banque".to_owned()],
        };

        let merged = local.merge(&remote);
        assert_eq!(merged.schema_version, 2);
        assert_eq!(merged.updated_at, 12);
        assert_eq!(
            merged
                .entries
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b", "c"]
        );
        assert_eq!(merged.entries[1].title, "Distant");
        assert_eq!(
            merged.custom_folders,
            vec!["Personnel/Banque".to_owned(), "Travail/Clients".to_owned()]
        );
    }

    #[test]
    fn merge_is_commutative_for_distinct_timestamps() {
        let local = VaultDocument {
            schema_version: 1,
            updated_at: 1,
            entries: vec![entry("a", "Local", 2)],
            custom_folders: vec!["DossierA".to_owned()],
        };
        let remote = VaultDocument {
            schema_version: 1,
            updated_at: 3,
            entries: vec![entry("a", "Distant", 4)],
            custom_folders: vec!["DossierB".to_owned()],
        };
        assert_eq!(local.merge(&remote), remote.merge(&local));
    }

    #[test]
    fn merge_is_deterministic_for_equal_timestamps() {
        let local = VaultDocument {
            schema_version: 1,
            updated_at: 1,
            entries: vec![entry("a", "Local", 4)],
            custom_folders: vec![],
        };
        let remote = VaultDocument {
            schema_version: 1,
            updated_at: 1,
            entries: vec![entry("a", "Distant", 4)],
            custom_folders: vec![],
        };
        assert_eq!(local.merge(&remote), remote.merge(&local));
        assert_eq!(local.merge(&remote).entries[0].title, "Local");
    }

    #[test]
    fn deserializes_legacy_entry_without_optional_fields() {
        let json = r#"{"id":"1","title":"Test","username":"user","category":"Personnel","favorite":true,"updated_at":100}"#;
        let entry: VaultEntry = serde_json::from_str(json).expect("should parse legacy format");
        assert_eq!(entry.id, "1");
        assert_eq!(entry.password, None);
        assert_eq!(entry.url, None);
        assert_eq!(entry.notes, None);
        assert_eq!(entry.totp_secret, None);
        assert_eq!(entry.folder, None);
        assert_eq!(entry.item_type, None);
        assert!(entry.attachments.is_empty());
    }

    #[test]
    fn serializes_and_deserializes_note_and_file_attachments() {
        let json = r#"{
            "id": "note-1",
            "title": "Codes de secours",
            "username": "",
            "notes": "Code1: 1234\nCode2: 5678",
            "category": "Personnel",
            "favorite": true,
            "updated_at": 200,
            "folder": "Personnel/Securite/2FA",
            "item_type": "note",
            "attachments": [
                {
                    "id": "att-1",
                    "name": "backup.txt",
                    "size": 1024,
                    "mime_type": "text/plain",
                    "data": "Q29kZTE6IDEyMzQK"
                }
            ]
        }"#;
        let entry: VaultEntry =
            serde_json::from_str(json).expect("should parse note with attachments");
        assert_eq!(entry.item_type.as_deref(), Some("note"));
        assert_eq!(entry.folder.as_deref(), Some("Personnel/Securite/2FA"));
        assert_eq!(entry.attachments.len(), 1);
        assert_eq!(entry.attachments[0].name, "backup.txt");
        assert_eq!(entry.attachments[0].size, 1024);
    }
}
