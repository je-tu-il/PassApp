use passapp_crypto_core::{decrypt, encrypt, EncryptedPayload};
use passapp_sync_core::{VaultAttachment, VaultDocument, VaultEntry};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use zeroize::Zeroizing;

struct AppState {
    vault_locked: Mutex<bool>,
    document: Mutex<Option<VaultDocument>>,
    password: Mutex<Option<Zeroizing<Vec<u8>>>>,
    storage_path: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
struct AppStatus {
    vault_locked: bool,
    vault_exists: bool,
    storage: String,
    vault_path: Option<String>,
}

#[derive(Deserialize)]
struct NewEntry {
    title: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default, alias = "totpSecret")]
    pub totp_secret: Option<String>,
    category: String,
    favorite: bool,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default, alias = "itemType")]
    pub item_type: Option<String>,
    #[serde(default)]
    pub attachments: Vec<VaultAttachment>,
}

#[derive(Deserialize)]
struct UpdateEntry {
    id: String,
    title: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default, alias = "totpSecret")]
    pub totp_secret: Option<String>,
    category: String,
    favorite: bool,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default, alias = "itemType")]
    pub item_type: Option<String>,
    #[serde(default)]
    pub attachments: Option<Vec<VaultAttachment>>,
}

#[derive(Serialize)]
struct OpenVaultResult {
    vault_locked: bool,
    entries: Vec<VaultEntry>,
    custom_folders: Vec<String>,
    vault_path: Option<String>,
}

fn now_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| "Horloge systeme invalide".to_owned())
}

fn rotate_backups(vault_path: &PathBuf) {
    let bak1 = vault_path.with_extension("passapp.bak1");
    let bak2 = vault_path.with_extension("passapp.bak2");
    let bak3 = vault_path.with_extension("passapp.bak3");
    if bak2.exists() {
        let _ = fs::copy(&bak2, &bak3);
    }
    if bak1.exists() {
        let _ = fs::copy(&bak1, &bak2);
    }
    if vault_path.exists() {
        let _ = fs::copy(vault_path, &bak1);
    }
}

fn persist_document(state: &AppState, document: &VaultDocument) -> Result<(), String> {
    let path = state
        .storage_path
        .lock()
        .map_err(|_| "Chemin du coffre indisponible".to_owned())?
        .clone()
        .ok_or_else(|| "Stockage du coffre non initialise".to_owned())?;
    let password = state
        .password
        .lock()
        .map_err(|_| "Session du coffre indisponible".to_owned())?
        .clone()
        .ok_or_else(|| "Coffre verrouille".to_owned())?;
    let plaintext = serde_json::to_vec(document).map_err(|_| "Coffre invalide".to_owned())?;
    let encrypted = encrypt(&password, &plaintext)
        .map_err(|_| "Chiffrement du coffre impossible".to_owned())?;
    let payload =
        serde_json::to_vec_pretty(&encrypted).map_err(|_| "Payload invalide".to_owned())?;
    let temporary_path = path.with_extension("tmp");
    fs::write(&temporary_path, payload)
        .map_err(|_| "Impossible d'enregistrer le coffre".to_owned())?;
    rotate_backups(&path);
    fs::rename(temporary_path, path).map_err(|_| "Impossible de finaliser le coffre".to_owned())
}

#[tauri::command]
fn get_app_status(state: tauri::State<'_, AppState>) -> Result<AppStatus, String> {
    let vault_locked = state
        .vault_locked
        .lock()
        .map_err(|_| "Etat du coffre indisponible".to_owned())?;
    let storage_guard = state
        .storage_path
        .lock()
        .map_err(|_| "Chemin indisponible".to_owned())?;
    let vault_exists = storage_guard.as_ref().map(|p| p.exists()).unwrap_or(false);
    let vault_path = storage_guard
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());

    Ok(AppStatus {
        vault_locked: *vault_locked,
        vault_exists,
        storage: "encrypted-local".to_owned(),
        vault_path,
    })
}

#[tauri::command]
fn set_vault_locked(state: tauri::State<'_, AppState>, locked: bool) -> Result<AppStatus, String> {
    let mut vault_locked = state
        .vault_locked
        .lock()
        .map_err(|_| "Etat du coffre indisponible".to_owned())?;
    *vault_locked = locked;

    if locked {
        *state
            .document
            .lock()
            .map_err(|_| "Coffre indisponible".to_owned())? = None;
        *state
            .password
            .lock()
            .map_err(|_| "Session du coffre indisponible".to_owned())? = None;
    }

    let storage_guard = state
        .storage_path
        .lock()
        .map_err(|_| "Chemin indisponible".to_owned())?;
    let vault_exists = storage_guard.as_ref().map(|p| p.exists()).unwrap_or(false);
    let vault_path = storage_guard
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());

    Ok(AppStatus {
        vault_locked: *vault_locked,
        vault_exists,
        storage: "encrypted-local".to_owned(),
        vault_path,
    })
}

#[tauri::command]
fn create_initial_vault(
    state: tauri::State<'_, AppState>,
    password: String,
) -> Result<OpenVaultResult, String> {
    if password.trim().is_empty() {
        return Err("Le mot de passe maître ne peut pas être vide".to_owned());
    }
    let path = state
        .storage_path
        .lock()
        .map_err(|_| "Chemin du coffre indisponible".to_owned())?
        .clone()
        .ok_or_else(|| "Stockage du coffre non initialise".to_owned())?;

    let password = Zeroizing::new(password.into_bytes());
    let document = VaultDocument::empty();

    *state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())? = Some(document.clone());
    *state
        .password
        .lock()
        .map_err(|_| "Session du coffre indisponible".to_owned())? = Some(password);
    *state
        .vault_locked
        .lock()
        .map_err(|_| "Etat du coffre indisponible".to_owned())? = false;

    persist_document(&state, &document)?;

    Ok(OpenVaultResult {
        vault_locked: false,
        entries: document.entries,
        custom_folders: document.custom_folders,
        vault_path: Some(path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn open_vault(
    state: tauri::State<'_, AppState>,
    password: String,
) -> Result<OpenVaultResult, String> {
    if password.is_empty() {
        return Err("Mot de passe requis".to_owned());
    }
    let path = state
        .storage_path
        .lock()
        .map_err(|_| "Chemin du coffre indisponible".to_owned())?
        .clone()
        .ok_or_else(|| "Stockage du coffre non initialise".to_owned())?;
    let password = Zeroizing::new(password.into_bytes());
    let document = if path.exists() {
        let payload = fs::read(&path).map_err(|_| "Impossible de lire le coffre".to_owned())?;
        let encrypted: EncryptedPayload =
            serde_json::from_slice(&payload).map_err(|_| "Format du coffre invalide".to_owned())?;
        let plaintext = decrypt(&password, &encrypted)
            .map_err(|_| "Mot de passe incorrect ou coffre altere".to_owned())?;
        serde_json::from_slice(&plaintext).map_err(|_| "Contenu du coffre invalide".to_owned())?
    } else {
        VaultDocument::empty()
    };
    *state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())? = Some(document.clone());
    *state
        .password
        .lock()
        .map_err(|_| "Session du coffre indisponible".to_owned())? = Some(password);
    *state
        .vault_locked
        .lock()
        .map_err(|_| "Etat du coffre indisponible".to_owned())? = false;
    if !path.exists() {
        persist_document(&state, &document)?;
    }
    Ok(OpenVaultResult {
        vault_locked: false,
        entries: document.entries,
        custom_folders: document.custom_folders,
        vault_path: Some(path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn get_vault_entries(state: tauri::State<'_, AppState>) -> Result<Vec<VaultEntry>, String> {
    let document = state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())?;
    Ok(document
        .as_ref()
        .ok_or_else(|| "Coffre verrouille".to_owned())?
        .entries
        .clone())
}

#[tauri::command]
fn create_vault_entry(
    state: tauri::State<'_, AppState>,
    entry: NewEntry,
) -> Result<VaultEntry, String> {
    let updated_at = now_seconds()?;
    let new_entry = VaultEntry {
        id: uuid::Uuid::new_v4().to_string(),
        title: entry.title,
        username: entry.username,
        password: entry.password,
        url: entry.url,
        notes: entry.notes,
        totp_secret: entry.totp_secret,
        category: entry.category,
        favorite: entry.favorite,
        updated_at,
        folder: entry.folder,
        item_type: entry.item_type,
        attachments: entry.attachments,
    };
    let mut document = state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())?;
    let document = document
        .as_mut()
        .ok_or_else(|| "Coffre verrouille".to_owned())?;
    document.updated_at = updated_at;
    document.entries.push(new_entry.clone());
    persist_document(&state, document)?;
    Ok(new_entry)
}

#[tauri::command]
fn update_vault_entry(
    state: tauri::State<'_, AppState>,
    entry: UpdateEntry,
) -> Result<VaultEntry, String> {
    let updated_at = now_seconds()?;
    let mut document = state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())?;
    let document = document
        .as_mut()
        .ok_or_else(|| "Coffre verrouille".to_owned())?;

    let target = document
        .entries
        .iter_mut()
        .find(|e| e.id == entry.id)
        .ok_or_else(|| "Entree introuvable".to_owned())?;

    target.title = entry.title;
    target.username = entry.username;
    target.password = entry.password;
    target.url = entry.url;
    target.notes = entry.notes;
    target.totp_secret = entry.totp_secret;
    target.category = entry.category;
    target.favorite = entry.favorite;
    target.folder = entry.folder;
    target.item_type = entry.item_type;
    if let Some(atts) = entry.attachments {
        target.attachments = atts;
    }
    target.updated_at = updated_at;
    let updated_entry = target.clone();

    document.updated_at = updated_at;
    persist_document(&state, document)?;
    Ok(updated_entry)
}

#[tauri::command]
fn delete_vault_entry(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let updated_at = now_seconds()?;
    let mut document = state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())?;
    let document = document
        .as_mut()
        .ok_or_else(|| "Coffre verrouille".to_owned())?;

    let initial_len = document.entries.len();
    document.entries.retain(|e| e.id != id);
    if document.entries.len() == initial_len {
        return Err("Entree introuvable".to_owned());
    }
    document.updated_at = updated_at;
    persist_document(&state, document)?;
    Ok(())
}

#[tauri::command]
fn get_custom_folders(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let document = state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())?;
    Ok(document
        .as_ref()
        .ok_or_else(|| "Coffre verrouille".to_owned())?
        .custom_folders
        .clone())
}

#[tauri::command]
fn create_custom_folder(
    state: tauri::State<'_, AppState>,
    folder_path: String,
) -> Result<Vec<String>, String> {
    let folder_path = folder_path.trim().replace('\\', "/");
    let trimmed = folder_path.trim_matches('/').to_string();
    if trimmed.is_empty() {
        return Err("Le nom de dossier ne peut pas être vide".to_owned());
    }

    let updated_at = now_seconds()?;
    let mut doc_guard = state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())?;
    let document = doc_guard
        .as_mut()
        .ok_or_else(|| "Coffre verrouille".to_owned())?;

    if !document.custom_folders.contains(&trimmed) {
        document.custom_folders.push(trimmed);
        document.custom_folders.sort();
        document.updated_at = updated_at;
        persist_document(&state, document)?;
    }
    Ok(document.custom_folders.clone())
}

#[tauri::command]
fn rename_custom_folder(
    state: tauri::State<'_, AppState>,
    old_path: String,
    new_path: String,
) -> Result<Vec<String>, String> {
    let old_clean = old_path
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    let new_clean = new_path
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    if old_clean.is_empty() || new_clean.is_empty() {
        return Err("Chemin de dossier invalide".to_owned());
    }

    let updated_at = now_seconds()?;
    let mut doc_guard = state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())?;
    let document = doc_guard
        .as_mut()
        .ok_or_else(|| "Coffre verrouille".to_owned())?;

    let prefix = format!("{old_clean}/");

    // Mettre à jour la liste des dossiers
    for f in &mut document.custom_folders {
        if *f == old_clean {
            *f = new_clean.clone();
        } else if f.starts_with(&prefix) {
            *f = format!("{new_clean}/{}", &f[prefix.len()..]);
        }
    }
    document.custom_folders.sort();
    document.custom_folders.dedup();

    // Mettre à jour les entrées
    for e in &mut document.entries {
        if let Some(ref folder) = e.folder {
            if folder == &old_clean {
                e.folder = Some(new_clean.clone());
            } else if folder.starts_with(&prefix) {
                e.folder = Some(format!("{new_clean}/{}", &folder[prefix.len()..]));
            }
        }
    }

    document.updated_at = updated_at;
    persist_document(&state, document)?;
    Ok(document.custom_folders.clone())
}

#[tauri::command]
fn delete_custom_folder(
    state: tauri::State<'_, AppState>,
    folder_path: String,
) -> Result<Vec<String>, String> {
    let clean = folder_path
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    let prefix = format!("{clean}/");

    let updated_at = now_seconds()?;
    let mut doc_guard = state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())?;
    let document = doc_guard
        .as_mut()
        .ok_or_else(|| "Coffre verrouille".to_owned())?;

    document
        .custom_folders
        .retain(|f| f != &clean && !f.starts_with(&prefix));

    // Dissocier les entrées qui étaient dans ce dossier ou sous-dossier
    for e in &mut document.entries {
        if let Some(ref folder) = e.folder {
            if folder == &clean || folder.starts_with(&prefix) {
                e.folder = None;
            }
        }
    }

    document.updated_at = updated_at;
    persist_document(&state, document)?;
    Ok(document.custom_folders.clone())
}

#[tauri::command]
fn change_master_password(
    state: tauri::State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    if new_password.is_empty() {
        return Err("Le nouveau mot de passe ne peut pas etre vide".to_owned());
    }
    let mut password_guard = state
        .password
        .lock()
        .map_err(|_| "Session indisponible".to_owned())?;
    let active_password = password_guard
        .as_ref()
        .ok_or_else(|| "Coffre verrouille".to_owned())?;
    if active_password.as_slice() != current_password.as_bytes() {
        return Err("Mot de passe actuel incorrect".to_owned());
    }
    let document_guard = state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())?;
    let document = document_guard
        .as_ref()
        .ok_or_else(|| "Coffre verrouille".to_owned())?;

    *password_guard = Some(Zeroizing::new(new_password.into_bytes()));
    persist_document(&state, document)?;
    Ok(())
}

#[tauri::command]
fn open_vault_directory(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let path = state
        .storage_path
        .lock()
        .map_err(|_| "Chemin indisponible".to_owned())?
        .clone()
        .ok_or_else(|| "Chemin du coffre non initialise".to_owned())?;
    let parent = path
        .parent()
        .ok_or_else(|| "Dossier parent introuvable".to_owned())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir l'explorateur: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir le dossier: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir le dossier: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn sync_vault_with_file(
    state: tauri::State<'_, AppState>,
    sync_file_path: String,
) -> Result<OpenVaultResult, String> {
    let sync_path = PathBuf::from(&sync_file_path);
    let password = state
        .password
        .lock()
        .map_err(|_| "Session indisponible".to_owned())?
        .clone()
        .ok_or_else(|| "Coffre verrouille".to_owned())?;

    let mut doc_guard = state
        .document
        .lock()
        .map_err(|_| "Coffre indisponible".to_owned())?;
    let mut local_doc = doc_guard
        .clone()
        .ok_or_else(|| "Coffre non charge".to_owned())?;

    if sync_path.exists() {
        let remote_bytes = fs::read(&sync_path)
            .map_err(|e| format!("Lecture du fichier distant impossible: {e}"))?;
        let encrypted: EncryptedPayload = serde_json::from_slice(&remote_bytes)
            .map_err(|e| format!("Format du fichier distant invalide: {e}"))?;
        let plaintext = decrypt(&password, &encrypted)
            .map_err(|_| "Mot de passe different ou fichier distant altere".to_owned())?;
        let remote_doc: VaultDocument = serde_json::from_slice(&plaintext)
            .map_err(|e| format!("Contenu du coffre distant invalide: {e}"))?;
        local_doc = local_doc.merge(&remote_doc);
    }

    persist_document(&state, &local_doc)?;

    let plaintext =
        serde_json::to_vec(&local_doc).map_err(|e| format!("Erreur de serialisation: {e}"))?;
    let encrypted =
        encrypt(&password, &plaintext).map_err(|e| format!("Erreur de chiffrement: {e:?}"))?;
    let payload =
        serde_json::to_vec_pretty(&encrypted).map_err(|e| format!("Erreur de conversion: {e}"))?;

    if let Some(parent) = sync_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&sync_path, payload)
        .map_err(|e| format!("Ecriture du fichier distant impossible: {e}"))?;

    *doc_guard = Some(local_doc.clone());

    Ok(OpenVaultResult {
        vault_locked: false,
        entries: local_doc.entries,
        custom_folders: local_doc.custom_folders,
        vault_path: state
            .storage_path
            .lock()
            .ok()
            .and_then(|p| p.as_ref().map(|p| p.to_string_lossy().to_string())),
    })
}

#[derive(Serialize)]
struct CloudPreset {
    id: String,
    name: String,
    icon: String,
    path: String,
    folder_exists: bool,
}

#[tauri::command]
fn get_cloud_sync_presets() -> Vec<CloudPreset> {
    let mut presets = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            let base = PathBuf::from(&userprofile);

            let onedrive = base.join("OneDrive");
            presets.push(CloudPreset {
                id: "onedrive".to_owned(),
                name: "Microsoft OneDrive".to_owned(),
                icon: "☁️".to_owned(),
                path: onedrive.join("vault.passapp").to_string_lossy().to_string(),
                folder_exists: onedrive.exists(),
            });

            let icloud = base.join("iCloudDrive");
            presets.push(CloudPreset {
                id: "icloud".to_owned(),
                name: "Apple iCloud Drive".to_owned(),
                icon: "🍏".to_owned(),
                path: icloud.join("vault.passapp").to_string_lossy().to_string(),
                folder_exists: icloud.exists(),
            });

            let gdrive = base.join("Google Drive");
            let gdrive_g = PathBuf::from("G:\\Mon Drive");
            let gdrive_g_alt = PathBuf::from("G:\\My Drive");
            let gdrive_path = if gdrive_g.exists() {
                gdrive_g.join("vault.passapp")
            } else if gdrive_g_alt.exists() {
                gdrive_g_alt.join("vault.passapp")
            } else {
                gdrive.join("vault.passapp")
            };
            presets.push(CloudPreset {
                id: "gdrive".to_owned(),
                name: "Google Drive".to_owned(),
                icon: "📁".to_owned(),
                path: gdrive_path.to_string_lossy().to_string(),
                folder_exists: gdrive.exists() || gdrive_g.exists() || gdrive_g_alt.exists(),
            });

            let dropbox = base.join("Dropbox");
            presets.push(CloudPreset {
                id: "dropbox".to_owned(),
                name: "Dropbox".to_owned(),
                icon: "📦".to_owned(),
                path: dropbox.join("vault.passapp").to_string_lossy().to_string(),
                folder_exists: dropbox.exists(),
            });

            let docs = base.join("Documents").join("PassAppSync");
            presets.push(CloudPreset {
                id: "documents".to_owned(),
                name: "Dossier Documents / Réseau local".to_owned(),
                icon: "💻".to_owned(),
                path: docs.join("vault.passapp").to_string_lossy().to_string(),
                folder_exists: true,
            });
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let base = PathBuf::from(&home);

            let icloud = base.join("Library/Mobile Documents/com~apple~CloudDocs");
            presets.push(CloudPreset {
                id: "icloud".to_owned(),
                name: "iCloud Drive".to_owned(),
                icon: "🍏".to_owned(),
                path: icloud.join("vault.passapp").to_string_lossy().to_string(),
                folder_exists: icloud.exists(),
            });

            let gdrive = base.join("Google Drive");
            presets.push(CloudPreset {
                id: "gdrive".to_owned(),
                name: "Google Drive".to_owned(),
                icon: "📁".to_owned(),
                path: gdrive.join("vault.passapp").to_string_lossy().to_string(),
                folder_exists: gdrive.exists(),
            });

            let onedrive = base.join("OneDrive");
            presets.push(CloudPreset {
                id: "onedrive".to_owned(),
                name: "OneDrive".to_owned(),
                icon: "☁️".to_owned(),
                path: onedrive.join("vault.passapp").to_string_lossy().to_string(),
                folder_exists: onedrive.exists(),
            });

            let dropbox = base.join("Dropbox");
            presets.push(CloudPreset {
                id: "dropbox".to_owned(),
                name: "Dropbox".to_owned(),
                icon: "📦".to_owned(),
                path: dropbox.join("vault.passapp").to_string_lossy().to_string(),
                folder_exists: dropbox.exists(),
            });
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let base = PathBuf::from(&home);
            let nextcloud = base.join("Nextcloud");
            presets.push(CloudPreset {
                id: "nextcloud".to_owned(),
                name: "Nextcloud / ownCloud".to_owned(),
                icon: "☁️".to_owned(),
                path: nextcloud
                    .join("vault.passapp")
                    .to_string_lossy()
                    .to_string(),
                folder_exists: nextcloud.exists(),
            });
            let local_sync = base.join(".passapp-sync");
            presets.push(CloudPreset {
                id: "localsync".to_owned(),
                name: "Dossier partagé local".to_owned(),
                icon: "💻".to_owned(),
                path: local_sync
                    .join("vault.passapp")
                    .to_string_lossy()
                    .to_string(),
                folder_exists: true,
            });
        }
    }

    presets
}

#[tauri::command]
fn pick_sync_file() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
            Add-Type -AssemblyName System.Windows.Forms
            $dialog = New-Object System.Windows.Forms.OpenFileDialog
            $dialog.Filter = "Coffre PassApp (*.passapp)|*.passapp|Tous les fichiers (*.*)|*.*"
            $dialog.Title = "Sélectionner un coffre PassApp distant pour la synchronisation"
            $dialog.CheckFileExists = $false
            if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                Write-Output $dialog.FileName
            }
        "#;
        let output = std::process::Command::new("powershell")
            .args(&["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .map_err(|e| format!("Impossible d'ouvrir le sélecteur: {e}"))?;
        let res = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if res.is_empty() {
            Ok(None)
        } else {
            Ok(Some(res))
        }
    }

    #[cfg(target_os = "macos")]
    {
        let script = r#"
            set theFile to choose file name with prompt "Sélectionner l'emplacement du coffre synchronisé :" default name "vault.passapp"
            return POSIX path of theFile
        "#;
        let output = std::process::Command::new("osascript")
            .args(&["-e", script])
            .output()
            .map_err(|e| format!("Impossible d'ouvrir le sélecteur: {e}"))?;
        let res = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if res.is_empty() {
            Ok(None)
        } else {
            Ok(Some(res))
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("zenity")
            .args(&[
                "--file-selection",
                "--save",
                "--confirm-overwrite",
                "--filename=vault.passapp",
                "--title=Sélectionner l'emplacement du coffre partagé",
            ])
            .output();
        if let Ok(out) = output {
            let res = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if res.is_empty() {
                Ok(None)
            } else {
                Ok(Some(res))
            }
        } else {
            Ok(None)
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            vault_locked: Mutex::new(true),
            document: Mutex::new(None),
            password: Mutex::new(None),
            storage_path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            set_vault_locked,
            create_initial_vault,
            open_vault,
            get_vault_entries,
            create_vault_entry,
            update_vault_entry,
            delete_vault_entry,
            change_master_password,
            open_vault_directory,
            sync_vault_with_file,
            get_cloud_sync_presets,
            pick_sync_file,
            get_custom_folders,
            create_custom_folder,
            rename_custom_folder,
            delete_custom_folder
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let storage_path = data_dir.join("vault.passapp");
            let state = app.state::<AppState>();
            *state
                .storage_path
                .lock()
                .map_err(|_| "Chemin du coffre indisponible")? = Some(storage_path);
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
