#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

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
    pub category: String,
    pub favorite: bool,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct VaultDocument {
    pub schema_version: u32,
    pub updated_at: u64,
    pub entries: Vec<VaultEntry>,
}

impl VaultDocument {
    pub fn empty() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            updated_at: 0,
            entries: Vec::new(),
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

        Self {
            schema_version: self.schema_version.max(remote.schema_version),
            updated_at: self.updated_at.max(remote.updated_at),
            entries: merged.into_values().collect(),
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
            category: "Personnel".to_owned(),
            favorite: false,
            updated_at,
        }
    }

    #[test]
    fn exposes_expected_identity() {
        assert_eq!(crate_identity(), "passapp-sync-core");
    }

    #[test]
    fn creates_current_empty_document() {
        assert_eq!(
            VaultDocument::empty().schema_version,
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn merge_prefers_newest_entry_and_orders_by_id() {
        let local = VaultDocument {
            schema_version: 1,
            updated_at: 10,
            entries: vec![entry("b", "Ancien", 1), entry("a", "Local", 5)],
        };
        let remote = VaultDocument {
            schema_version: 2,
            updated_at: 12,
            entries: vec![entry("b", "Distant", 4), entry("c", "Nouveau", 2)],
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
    }

    #[test]
    fn merge_is_commutative_for_distinct_timestamps() {
        let local = VaultDocument {
            schema_version: 1,
            updated_at: 1,
            entries: vec![entry("a", "Local", 2)],
        };
        let remote = VaultDocument {
            schema_version: 1,
            updated_at: 3,
            entries: vec![entry("a", "Distant", 4)],
        };
        assert_eq!(local.merge(&remote), remote.merge(&local));
    }

    #[test]
    fn merge_is_deterministic_for_equal_timestamps() {
        let local = VaultDocument {
            schema_version: 1,
            updated_at: 1,
            entries: vec![entry("a", "Local", 4)],
        };
        let remote = VaultDocument {
            schema_version: 1,
            updated_at: 1,
            entries: vec![entry("a", "Distant", 4)],
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
    }
}
