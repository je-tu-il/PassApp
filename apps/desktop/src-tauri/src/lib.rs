use passapp_crypto_core::{decrypt, encrypt, EncryptedPayload};
use passapp_sync_core::{VaultDocument, VaultEntry};
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
    storage: String,
    vault_path: Option<String>,
}

#[derive(Deserialize)]
struct NewEntry {
    title: String,
    username: String,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    category: String,
    favorite: bool,
}

#[derive(Deserialize)]
struct UpdateEntry {
    id: String,
    title: String,
    username: String,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    category: String,
    favorite: bool,
}

#[derive(Serialize)]
struct OpenVaultResult {
    vault_locked: bool,
    entries: Vec<VaultEntry>,
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
    let vault_path = state
        .storage_path
        .lock()
        .map_err(|_| "Chemin indisponible".to_owned())?
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());

    Ok(AppStatus {
        vault_locked: *vault_locked,
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

    let vault_path = state
        .storage_path
        .lock()
        .map_err(|_| "Chemin indisponible".to_owned())?
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());

    Ok(AppStatus {
        vault_locked: *vault_locked,
        storage: "encrypted-local".to_owned(),
        vault_path,
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
        category: entry.category,
        favorite: entry.favorite,
        updated_at,
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
    target.category = entry.category;
    target.favorite = entry.favorite;
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
            open_vault,
            get_vault_entries,
            create_vault_entry,
            update_vault_entry,
            delete_vault_entry,
            change_master_password,
            open_vault_directory
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
