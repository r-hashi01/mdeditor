// IPC command implementations. Each fn maps 1:1 to a frontend `invoke(...)`
// call and returns a serde_json::Value (or Err-string). Dispatch is
// in main.rs.

use std::fs;
use std::io::Read;
use std::path::Path;

use base64::Engine;
use serde::Serialize;
use serde_json::Value;

use crate::sandbox::{
    app_config_dir, app_data_dir, atomic_write, is_dir_allowed, is_path_allowed, safe_lock,
    validate_path, SharedList, MAX_ALLOWED_PATHS, MAX_FILE_SIZE,
};

pub struct AppState {
    pub allowed_paths: SharedList,
    pub allowed_dirs: SharedList,
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("missing arg: {}", key))
}

pub fn allow_path(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    validate_path(path)?;
    let canonical = fs::canonicalize(path)
        .map_err(|_| "Invalid file path".to_string())?
        .to_string_lossy()
        .to_string();
    let mut paths = safe_lock(&state.allowed_paths);
    if paths.len() >= MAX_ALLOWED_PATHS {
        return Err("Too many allowed paths".to_string());
    }
    if !paths.contains(&canonical) {
        paths.push(canonical);
    }
    Ok(Value::Null)
}

pub fn allow_dir(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    validate_path(path)?;
    let canonical = fs::canonicalize(path)
        .map_err(|_| "Invalid directory path".to_string())?
        .to_string_lossy()
        .to_string();
    let mut dirs = safe_lock(&state.allowed_dirs);
    if dirs.len() >= MAX_ALLOWED_PATHS {
        return Err("Too many allowed directories".to_string());
    }
    if !dirs.contains(&canonical) {
        dirs.push(canonical);
    }
    Ok(Value::Null)
}

pub fn reopen_dir(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    validate_path(path)?;

    let settings_path = app_config_dir()?.join("settings.json");
    if !settings_path.exists() {
        return Err("No saved settings found".to_string());
    }
    let json_str = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Cannot read settings: {}", e))?;
    let settings: Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Cannot parse settings: {}", e))?;
    let in_recent = settings
        .get("recentFolders")
        .and_then(|v| v.as_array())
        .is_some_and(|arr| arr.iter().any(|v| v.as_str() == Some(path)));
    let is_last = settings.get("lastOpenedFolder").and_then(|v| v.as_str()) == Some(path);
    if !in_recent && !is_last {
        return Err("Directory not found in saved settings".to_string());
    }

    let canonical = fs::canonicalize(path)
        .map_err(|_| "Directory does not exist".to_string())?
        .to_string_lossy()
        .to_string();
    let mut dirs = safe_lock(&state.allowed_dirs);
    if dirs.len() >= MAX_ALLOWED_PATHS {
        return Err("Too many allowed directories".to_string());
    }
    if !dirs.contains(&canonical) {
        dirs.push(canonical);
    }
    Ok(Value::Null)
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

pub fn list_directory(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    validate_path(path)?;
    is_dir_allowed(path, &state.allowed_dirs)?;

    let entries = fs::read_dir(path).map_err(|e| format!("Cannot read directory: {}", e))?;
    let mut result: Vec<DirEntry> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Cannot read entry: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("Cannot read metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        result.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
        });
    }
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

pub fn read_file(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    validate_path(path)?;
    let canonical = is_path_allowed(path, &state.allowed_paths, &state.allowed_dirs)?;

    let metadata = fs::metadata(&canonical).map_err(|_| "Cannot read file".to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!("File too large: {} bytes (max {})", metadata.len(), MAX_FILE_SIZE));
    }
    let mut buf = String::with_capacity(metadata.len() as usize);
    fs::File::open(&canonical)
        .map_err(|_| "Cannot read file".to_string())?
        .take(MAX_FILE_SIZE + 1)
        .read_to_string(&mut buf)
        .map_err(|_| "Cannot read file".to_string())?;
    if buf.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("File too large: exceeds {} bytes", MAX_FILE_SIZE));
    }
    Ok(Value::from(buf))
}

pub fn read_file_binary(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    validate_path(path)?;
    let canonical = is_path_allowed(path, &state.allowed_paths, &state.allowed_dirs)?;

    let metadata = fs::metadata(&canonical).map_err(|_| "Cannot read file".to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!("File too large: {} bytes (max {})", metadata.len(), MAX_FILE_SIZE));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(&canonical)
        .map_err(|_| "Cannot read file".to_string())?
        .take(MAX_FILE_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read file".to_string())?;
    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("File too large: exceeds {} bytes", MAX_FILE_SIZE));
    }
    Ok(Value::from(base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

pub fn write_file(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    let content = arg_str(args, "content")?;
    validate_path(path)?;
    let canonical = is_path_allowed(path, &state.allowed_paths, &state.allowed_dirs)?;

    if content.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("Content too large: {} bytes (max {})", content.len(), MAX_FILE_SIZE));
    }
    atomic_write(Path::new(&canonical), content.as_bytes())?;
    Ok(Value::Null)
}

pub fn write_file_binary(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    let data = arg_str(args, "data")?;
    validate_path(path)?;
    let parent = Path::new(path)
        .parent()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();
    let canonical_parent = is_dir_allowed(&parent, &state.allowed_dirs)?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("base64 decode error: {}", e))?;
    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("File too large: {} bytes (max {})", bytes.len(), MAX_FILE_SIZE));
    }
    let filename = Path::new(path).file_name().ok_or("Invalid file name")?;
    let canonical_path = Path::new(&canonical_parent).join(filename);
    atomic_write(&canonical_path, &bytes)?;
    let final_canonical = fs::canonicalize(&canonical_path)
        .map_err(|e| format!("Cannot resolve written file: {}", e))?;
    validate_path(&final_canonical.to_string_lossy())?;
    if !final_canonical.starts_with(Path::new(&canonical_parent)) {
        let _ = fs::remove_file(&canonical_path);
        return Err("Write rejected: symlink escape detected".to_string());
    }
    Ok(Value::Null)
}

pub fn ensure_dir(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    validate_path(path)?;
    let canonical_parent = is_dir_allowed(path, &state.allowed_dirs).or_else(|_| {
        let parent = Path::new(path)
            .parent()
            .ok_or("Invalid path")?
            .to_string_lossy()
            .to_string();
        is_dir_allowed(&parent, &state.allowed_dirs)
    })?;
    let dir_name = Path::new(path).file_name().ok_or("Invalid directory name")?;
    let target = Path::new(&canonical_parent).join(dir_name);
    fs::create_dir_all(&target).map_err(|e| format!("Cannot create directory: {}", e))?;
    let canonical_target = fs::canonicalize(&target)
        .map_err(|e| format!("Cannot resolve created directory: {}", e))?;
    validate_path(&canonical_target.to_string_lossy())?;
    Ok(Value::Null)
}

pub fn get_image_temp_dir(state: &AppState, _args: &Value) -> Result<Value, String> {
    let img_dir = app_data_dir()?.join("temp-images");
    fs::create_dir_all(&img_dir).map_err(|e| format!("Cannot create temp image dir: {}", e))?;
    let img_dir_str = img_dir.to_string_lossy().to_string();
    let mut dirs = safe_lock(&state.allowed_dirs);
    if !dirs.contains(&img_dir_str) {
        dirs.push(img_dir_str.clone());
    }
    Ok(Value::from(img_dir_str))
}

pub fn load_settings(_state: &AppState, _args: &Value) -> Result<Value, String> {
    let settings_path = app_config_dir()?.join("settings.json");
    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Cannot read settings: {}", e))?;
        Ok(Value::from(content))
    } else {
        Ok(Value::from("{}"))
    }
}

pub fn save_settings(_state: &AppState, args: &Value) -> Result<Value, String> {
    let settings = arg_str(args, "settings")?;
    let mut parsed: Value =
        serde_json::from_str(settings).map_err(|e| format!("Invalid settings JSON: {}", e))?;
    if !parsed.is_object() {
        return Err("Settings must be a JSON object".to_string());
    }
    if let Some(obj) = parsed.as_object_mut() {
        if let Some(v) = obj.get_mut("recentFolders") {
            if let Some(arr) = v.as_array_mut() {
                arr.retain(|entry| {
                    entry.as_str().map(|s| validate_path(s).is_ok()).unwrap_or(false)
                });
            }
        }
        let bad_last = obj
            .get("lastOpenedFolder")
            .and_then(|v| v.as_str())
            .map(|s| validate_path(s).is_err())
            .unwrap_or(false);
        if bad_last {
            obj.remove("lastOpenedFolder");
        }
    }
    let sanitised =
        serde_json::to_string(&parsed).map_err(|e| format!("Failed to serialise settings: {}", e))?;
    let config_dir = app_config_dir()?;
    fs::create_dir_all(&config_dir).map_err(|e| format!("Cannot create config dir: {}", e))?;
    atomic_write(&config_dir.join("settings.json"), sanitised.as_bytes())?;
    Ok(Value::Null)
}
