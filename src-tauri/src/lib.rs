use std::fs;

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!("File too large: {} bytes (max {})", metadata.len(), MAX_FILE_SIZE));
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, write_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
