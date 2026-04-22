// Path sandbox + atomic write — mirrors src-tauri/src/lib.rs so the shell
// enforces the same allow-list semantics as the Tauri host it replaces.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

pub const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;
pub const MAX_ALLOWED_PATHS: usize = 10000;

pub type SharedList = Arc<Mutex<Vec<String>>>;

pub fn new_list() -> SharedList {
    Arc::new(Mutex::new(Vec::new()))
}

pub fn safe_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn starts_with_any(path: &Path, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|p| path.starts_with(p))
}

fn has_blocked_component(path: &Path, blocked: &[&str]) -> bool {
    let path_str = path.to_string_lossy();
    for b in blocked {
        if b.contains('/') {
            if path_str.contains(b) {
                return true;
            }
        } else {
            for component in path.components() {
                if let std::path::Component::Normal(name) = component {
                    if name.eq_ignore_ascii_case(b) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

pub fn validate_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("Only absolute paths are allowed".to_string());
    }

    let blocked_dirs: &[&str] = &[
        "/etc", "/var", "/usr", "/sys", "/proc", "/sbin", "/bin", "/boot",
        "/private/etc", "/private/var", "/private/tmp", "/Library",
    ];
    if starts_with_any(p, blocked_dirs) {
        return Err("Access to system directories is not allowed".to_string());
    }

    let blocked_components: &[&str] = &[
        ".ssh", ".gnupg", ".gpg", ".aws", ".kube", ".docker",
        ".config/gcloud", "Keychains", ".git", ".npmrc", ".netrc",
    ];
    if has_blocked_component(p, blocked_components) {
        return Err("Access to sensitive directories is not allowed".to_string());
    }

    if let Ok(canonical) = fs::canonicalize(path) {
        if starts_with_any(&canonical, blocked_dirs) {
            return Err("Access to system directories is not allowed".to_string());
        }
        if has_blocked_component(&canonical, blocked_components) {
            return Err("Access to sensitive directories is not allowed".to_string());
        }
    }

    Ok(())
}

pub fn is_dir_allowed(path: &str, allowed_dirs: &SharedList) -> Result<String, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "Invalid directory path".to_string())?;
    let dirs = safe_lock(allowed_dirs);
    if dirs.iter().any(|allowed| canonical.starts_with(Path::new(allowed))) {
        Ok(canonical.to_string_lossy().to_string())
    } else {
        Err("Access denied: directory not selected via dialog".to_string())
    }
}

pub fn is_path_allowed(
    path: &str,
    allowed_paths: &SharedList,
    allowed_dirs: &SharedList,
) -> Result<String, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "Invalid file path".to_string())?;
    let canonical_str = canonical.to_string_lossy().to_string();

    let paths = safe_lock(allowed_paths);
    if paths.contains(&canonical_str) {
        return Ok(canonical_str);
    }
    drop(paths);

    let dirs = safe_lock(allowed_dirs);
    if dirs.iter().any(|allowed| canonical.starts_with(Path::new(allowed))) {
        return Ok(canonical_str);
    }
    Err("Access denied: file not selected via dialog".to_string())
}

pub fn atomic_write(target: &Path, data: &[u8]) -> Result<(), String> {
    let parent = target.parent().ok_or("Invalid file path")?;
    let base = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let pid = std::process::id();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_name = format!(".{}.{}.{}.tmp", base, pid, ts);
    let tmp_path = parent.join(&tmp_name);
    fs::write(&tmp_path, data).map_err(|e| format!("Cannot write temp file: {}", e))?;
    fs::rename(&tmp_path, target).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Cannot rename temp file: {}", e)
    })
}

pub fn app_config_dir() -> Result<PathBuf, String> {
    // Matches Tauri's app_config_dir on macOS:
    // ~/Library/Application Support/<identifier>
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    Ok(PathBuf::from(home)
        .join("Library/Application Support")
        .join("com.mdeditor.editor"))
}

pub fn app_data_dir() -> Result<PathBuf, String> {
    // Tauri uses the same location for app_data_dir on macOS.
    app_config_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_path() {
        assert!(validate_path("relative/path.md").is_err());
    }

    #[test]
    fn accepts_normal_absolute_path() {
        assert!(validate_path("/tmp/test-file.md").is_ok());
    }

    #[test]
    fn blocks_etc_directory() {
        assert!(validate_path("/etc/passwd").is_err());
    }

    #[test]
    fn blocks_ssh_directory() {
        assert!(validate_path("/Users/alice/.ssh/id_rsa").is_err());
    }

    #[test]
    fn does_not_false_positive_on_etc_in_name() {
        assert!(validate_path("/tmp/etcetera/notes.md").is_ok());
    }

    #[test]
    fn blocks_git_internal_paths() {
        assert!(validate_path("/Users/alice/repo/.git/config").is_err());
    }

    #[test]
    fn ssh_match_is_case_insensitive() {
        assert!(validate_path("/Users/alice/.SSH/id_rsa").is_err());
    }

    #[test]
    fn atomic_write_round_trip() {
        let dir = std::env::temp_dir().join("mdeditor-shell-test-atomic");
        let _ = fs::create_dir_all(&dir);
        let target = dir.join("f.txt");
        let _ = fs::remove_file(&target);
        atomic_write(&target, b"hello").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "hello");
        let _ = fs::remove_file(&target);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn atomic_write_fails_when_parent_missing() {
        let target = std::env::temp_dir()
            .join("mdeditor-shell-nonexistent-xyz")
            .join("f.txt");
        assert!(atomic_write(&target, b"nope").is_err());
    }
}
