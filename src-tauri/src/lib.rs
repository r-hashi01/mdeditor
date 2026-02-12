use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB

/// Tracks paths the user has explicitly selected via native dialogs.
/// Only these paths are allowed for read/write operations.
pub struct AllowedPaths(Mutex<Vec<String>>);

#[tauri::command]
fn allow_path(path: String, state: State<'_, AllowedPaths>) {
    let mut paths = state.0.lock().unwrap();
    if !paths.contains(&path) {
        paths.push(path);
    }
}

fn is_path_allowed(path: &str, state: &State<'_, AllowedPaths>) -> Result<String, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|_| "Invalid file path".to_string())?
        .to_string_lossy()
        .to_string();

    let paths = state.0.lock().unwrap();
    if paths.iter().any(|allowed| {
        fs::canonicalize(allowed)
            .map(|p| p.to_string_lossy().to_string())
            .map(|p| p == canonical)
            .unwrap_or(false)
    }) {
        Ok(canonical)
    } else {
        Err("Access denied: file not selected via dialog".to_string())
    }
}

fn validate_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);

    // Block obvious dangerous paths
    let canonical_str = path.to_lowercase();
    let blocked = ["/etc/", "/var/", "/usr/", "/sys/", "/proc/", "/.ssh/"];
    for b in &blocked {
        if canonical_str.contains(b) {
            return Err("Access to system directories is not allowed".to_string());
        }
    }

    // Must be absolute path
    if !p.is_absolute() {
        return Err("Only absolute paths are allowed".to_string());
    }

    Ok(())
}

#[tauri::command]
fn read_file(path: String, state: State<'_, AllowedPaths>) -> Result<String, String> {
    validate_path(&path)?;
    let canonical = is_path_allowed(&path, &state)?;

    let metadata = fs::metadata(&canonical).map_err(|_| "Cannot read file".to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large: {} bytes (max {})",
            metadata.len(),
            MAX_FILE_SIZE
        ));
    }
    fs::read_to_string(&canonical).map_err(|_| "Cannot read file".to_string())
}

#[tauri::command]
fn write_file(path: String, content: String, state: State<'_, AllowedPaths>) -> Result<(), String> {
    validate_path(&path)?;
    let canonical = is_path_allowed(&path, &state)?;

    if content.len() as u64 > MAX_FILE_SIZE {
        return Err(format!(
            "Content too large: {} bytes (max {})",
            content.len(),
            MAX_FILE_SIZE
        ));
    }
    fs::write(&canonical, &content).map_err(|_| "Cannot write file".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AllowedPaths(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![read_file, write_file, allow_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
