mod acp;

use acp::AcpProcess;
use base64::Engine;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB
const MAX_ALLOWED_PATHS: usize = 10000;
const MAX_PTY_WRITE: usize = 1024 * 1024; // 1 MiB per write call
const ALLOWED_PTY_TOOLS: &[&str] = &["claude", "codex"];

/// Shared list of whitelisted paths/directories. Re-exported for `acp.rs`
/// so the ACP reader can enforce the same allow-list as Tauri commands.
pub type SharedPathList = Arc<Mutex<Vec<String>>>;

/// Public wrapper around `validate_path` for use by `acp.rs`.
pub fn validate_path_pub(path: &str) -> Result<(), String> {
    validate_path(path)
}

/// Tracks paths the user has explicitly selected via native dialogs.
/// Only these paths are allowed for read/write operations.
pub struct AllowedPaths(pub Arc<Mutex<Vec<String>>>);

/// Tracks directories the user has opened via the folder dialog.
/// Used for file-tree browsing — any descendant path is allowed.
pub struct AllowedDirs(pub Arc<Mutex<Vec<String>>>);

/// Helper to safely lock a mutex, recovering from poison.
fn safe_lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Whitelist a single file path. Only called after a native file dialog selection.
#[tauri::command]
fn allow_path(path: String, state: State<'_, AllowedPaths>) -> Result<(), String> {
    validate_path(&path)?;
    let canonical = fs::canonicalize(&path)
        .map_err(|_| "Invalid file path".to_string())?
        .to_string_lossy()
        .to_string();
    let mut paths = safe_lock(&state.0);
    if paths.len() >= MAX_ALLOWED_PATHS {
        return Err("Too many allowed paths".to_string());
    }
    if !paths.contains(&canonical) {
        paths.push(canonical);
    }
    Ok(())
}

/// Whitelist a directory. Only called after a native folder dialog selection.
#[tauri::command]
fn allow_dir(path: String, state: State<'_, AllowedDirs>) -> Result<(), String> {
    validate_path(&path)?;
    let canonical = fs::canonicalize(&path)
        .map_err(|_| "Invalid directory path".to_string())?
        .to_string_lossy()
        .to_string();
    let mut dirs = safe_lock(&state.0);
    if dirs.len() >= MAX_ALLOWED_PATHS {
        return Err("Too many allowed directories".to_string());
    }
    if !dirs.contains(&canonical) {
        dirs.push(canonical);
    }
    Ok(())
}

/// Re-whitelist a previously opened directory — validates it exists in saved settings.
#[tauri::command]
fn reopen_dir(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AllowedDirs>,
) -> Result<(), String> {
    validate_path(&path)?;
    // Verify this path was previously saved in settings (not arbitrary)
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Cannot resolve config dir: {}", e))?;
    let settings_path = config_dir.join("settings.json");
    if !settings_path.exists() {
        return Err("No saved settings found".to_string());
    }
    let json_str =
        fs::read_to_string(&settings_path).map_err(|e| format!("Cannot read settings: {}", e))?;
    let settings: serde_json::Value =
        serde_json::from_str(&json_str).map_err(|e| format!("Cannot parse settings: {}", e))?;
    // Check recentFolders array and lastOpenedFolder
    let in_recent = settings
        .get("recentFolders")
        .and_then(|v| v.as_array())
        .is_some_and(|arr| arr.iter().any(|v| v.as_str() == Some(&path)));
    let is_last = settings.get("lastOpenedFolder").and_then(|v| v.as_str()) == Some(&path);
    if !in_recent && !is_last {
        return Err("Directory not found in saved settings".to_string());
    }

    let canonical = fs::canonicalize(&path)
        .map_err(|_| "Directory does not exist".to_string())?
        .to_string_lossy()
        .to_string();
    let mut dirs = safe_lock(&state.0);
    if dirs.len() >= MAX_ALLOWED_PATHS {
        return Err("Too many allowed directories".to_string());
    }
    if !dirs.contains(&canonical) {
        dirs.push(canonical);
    }
    Ok(())
}

fn is_dir_allowed(path: &str, state: &State<'_, AllowedDirs>) -> Result<String, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "Invalid directory path".to_string())?;

    let dirs = safe_lock(&state.0);
    if dirs
        .iter()
        .any(|allowed| canonical.starts_with(Path::new(allowed)))
    {
        Ok(canonical.to_string_lossy().to_string())
    } else {
        Err("Access denied: directory not selected via dialog".to_string())
    }
}

/// Default file-extension allow-list for project-wide search and recursive
/// file listing. Keeps `target/`, `node_modules/` binaries, lockfiles etc.
/// out of results without requiring the frontend to filter.
const SEARCHABLE_EXTS: &[&str] = &[
    "md", "markdown", "txt", "log", "csv", "tsv",
    "ts", "tsx", "js", "jsx", "mjs", "cjs",
    "rs", "py", "go", "java", "kt", "swift", "rb", "php", "c", "h", "cpp", "hpp",
    "json", "yaml", "yml", "toml", "xml", "html", "htm", "css", "scss", "sass",
    "sh", "bash", "zsh", "fish",
];

const SKIP_DIR_NAMES: &[&str] = &[
    "node_modules", "target", "dist", "build", ".next", ".turbo",
    ".cache", "out", "vendor", ".venv", "venv", "__pycache__",
];

const MAX_SEARCH_RESULTS: usize = 500;
const MAX_FILE_LIST_RESULTS: usize = 20000;
const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;

fn has_searchable_ext(name: &str) -> bool {
    let dot = match name.rfind('.') {
        Some(d) => d,
        None => return false,
    };
    let ext = &name[dot + 1..].to_ascii_lowercase();
    SEARCHABLE_EXTS.iter().any(|e| *e == ext.as_str())
}

fn should_skip_dir(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    SKIP_DIR_NAMES.iter().any(|s| *s == name)
}

#[derive(serde::Serialize)]
struct ProjectFile {
    name: String,
    path: String,
    /// Path relative to the search root (POSIX-style separators).
    rel: String,
}

/// List every searchable file under an allowed directory (recursively).
/// Used by quick-open (Cmd+P) for fuzzy file matching.
#[tauri::command]
fn list_files_recursive(
    path: String,
    state: State<'_, AllowedDirs>,
) -> Result<Vec<ProjectFile>, String> {
    validate_path(&path)?;
    let canonical = is_dir_allowed(&path, &state)?;
    let root = std::path::PathBuf::from(&canonical);
    let mut out: Vec<ProjectFile> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![root.clone()];

    while let Some(dir) = stack.pop() {
        if out.len() >= MAX_FILE_LIST_RESULTS {
            break;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let entry_path = entry.path();
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                if should_skip_dir(&name) {
                    continue;
                }
                stack.push(entry_path);
            } else if metadata.is_file() {
                if !has_searchable_ext(&name) {
                    continue;
                }
                let path_str = entry_path.to_string_lossy().to_string();
                let rel = entry_path
                    .strip_prefix(&root)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|_| name.clone());
                out.push(ProjectFile {
                    name,
                    path: path_str,
                    rel,
                });
                if out.len() >= MAX_FILE_LIST_RESULTS {
                    break;
                }
            }
        }
    }

    out.sort_by(|a, b| a.rel.to_lowercase().cmp(&b.rel.to_lowercase()));
    Ok(out)
}

#[derive(serde::Serialize)]
struct SearchHit {
    path: String,
    rel: String,
    line: u32,
    /// Line content (trimmed at boundaries for very long lines).
    text: String,
    /// Byte offset of the match within `text`.
    match_start: u32,
    match_end: u32,
}

/// Plain-text (case-insensitive optional) substring search across an allowed directory.
#[tauri::command]
fn search_in_dir(
    path: String,
    query: String,
    case_sensitive: Option<bool>,
    state: State<'_, AllowedDirs>,
) -> Result<Vec<SearchHit>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }
    if query.len() > 256 {
        return Err("Query too long".to_string());
    }
    validate_path(&path)?;
    let canonical = is_dir_allowed(&path, &state)?;
    let root = std::path::PathBuf::from(&canonical);
    let case_sensitive = case_sensitive.unwrap_or(false);
    let needle: String = if case_sensitive {
        query.clone()
    } else {
        query.to_lowercase()
    };

    let mut hits: Vec<SearchHit> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![root.clone()];
    let mut buf = String::with_capacity(8192);

    'outer: while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if hits.len() >= MAX_SEARCH_RESULTS {
                break 'outer;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let entry_path = entry.path();
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                if should_skip_dir(&name) {
                    continue;
                }
                stack.push(entry_path);
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            if metadata.len() > MAX_SEARCH_FILE_BYTES {
                continue;
            }
            if !has_searchable_ext(&name) {
                continue;
            }

            buf.clear();
            if fs::File::open(&entry_path)
                .and_then(|mut f| f.read_to_string(&mut buf))
                .is_err()
            {
                continue;
            }

            let rel = entry_path
                .strip_prefix(&root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());
            let path_str = entry_path.to_string_lossy().to_string();

            for (idx, line) in buf.lines().enumerate() {
                let haystack: std::borrow::Cow<'_, str> = if case_sensitive {
                    std::borrow::Cow::Borrowed(line)
                } else {
                    std::borrow::Cow::Owned(line.to_lowercase())
                };
                let Some(pos) = haystack.find(&needle) else {
                    continue;
                };
                // Trim very long lines to a window around the match for UI sanity.
                let (text, adj) = trim_line_around(line, pos, query.len());
                hits.push(SearchHit {
                    path: path_str.clone(),
                    rel: rel.clone(),
                    line: (idx as u32) + 1,
                    text,
                    match_start: adj as u32,
                    match_end: (adj + query.len()) as u32,
                });
                if hits.len() >= MAX_SEARCH_RESULTS {
                    break 'outer;
                }
            }
        }
    }

    Ok(hits)
}

/// Truncate a line to ~200 chars centered on the match, returning the new
/// (text, adjusted_match_start). Slices on char boundaries.
fn trim_line_around(line: &str, match_byte: usize, match_len: usize) -> (String, usize) {
    const MAX_LEN: usize = 200;
    if line.len() <= MAX_LEN {
        return (line.to_string(), match_byte);
    }
    let context = (MAX_LEN.saturating_sub(match_len)) / 2;
    let mut start = match_byte.saturating_sub(context);
    while start > 0 && !line.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = (match_byte + match_len + context).min(line.len());
    while end < line.len() && !line.is_char_boundary(end) {
        end += 1;
    }
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < line.len() { "…" } else { "" };
    let snippet = format!("{}{}{}", prefix, &line[start..end], suffix);
    let new_match_start = prefix.len() + (match_byte - start);
    (snippet, new_match_start)
}

#[derive(serde::Serialize)]
struct BacklinkHit {
    /// The link target as written, e.g. "notes" or "subdir/notes".
    target: String,
    /// Absolute path of the file containing the link.
    from: String,
    /// Path of the source file relative to the search root (POSIX).
    from_rel: String,
    /// 1-based line number where the link appears.
    line: u32,
    /// Trimmed line excerpt for display.
    snippet: String,
}

/// Walk every markdown file under an allowed directory and emit one hit per
/// `[[wiki link]]` occurrence. The frontend groups by target.
#[tauri::command]
fn build_backlinks_index(
    path: String,
    state: State<'_, AllowedDirs>,
) -> Result<Vec<BacklinkHit>, String> {
    validate_path(&path)?;
    let canonical = is_dir_allowed(&path, &state)?;
    let root = std::path::PathBuf::from(&canonical);
    let mut hits: Vec<BacklinkHit> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![root.clone()];
    let mut buf = String::with_capacity(8192);

    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let entry_path = entry.path();
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                if should_skip_dir(&name) {
                    continue;
                }
                stack.push(entry_path);
                continue;
            }
            if !metadata.is_file() || !is_markdown_name(&name) {
                continue;
            }
            if metadata.len() > MAX_SEARCH_FILE_BYTES {
                continue;
            }
            buf.clear();
            if fs::File::open(&entry_path)
                .and_then(|mut f| f.read_to_string(&mut buf))
                .is_err()
            {
                continue;
            }
            let from = entry_path.to_string_lossy().to_string();
            let from_rel = entry_path
                .strip_prefix(&root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());

            extract_wiki_links(&buf, |target, line_num, line_text| {
                let snippet = trim_snippet(line_text, 200);
                hits.push(BacklinkHit {
                    target: target.to_string(),
                    from: from.clone(),
                    from_rel: from_rel.clone(),
                    line: line_num,
                    snippet,
                });
            });
        }
    }

    Ok(hits)
}

fn is_markdown_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

fn trim_snippet(line: &str, max_chars: usize) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(max_chars).collect();
    format!("{}…", cut)
}

/// Scan source text and call `emit(target, line_num, line_text)` for every
/// `[[target]]` (or `[[target|alias]]`). Skips fenced code blocks and inline
/// code spans. Aliases are stripped before emit.
fn extract_wiki_links(src: &str, mut emit: impl FnMut(&str, u32, &str)) {
    let mut in_fence = false;
    for (idx, line) in src.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        // Strip inline code spans `...` so `[[x]]` inside them is ignored.
        let cleaned = strip_inline_code(line);
        let bytes = cleaned.as_bytes();
        let mut i = 0;
        while i + 1 < bytes.len() {
            if bytes[i] == b'[' && bytes[i + 1] == b'[' {
                if let Some(close) = find_close_brackets(&cleaned[i + 2..]) {
                    let inner = &cleaned[i + 2..i + 2 + close];
                    if !inner.is_empty() && !inner.contains('\n') {
                        let target = match inner.find('|') {
                            Some(p) => &inner[..p],
                            None => inner,
                        };
                        let target = target.trim();
                        if !target.is_empty() {
                            emit(target, (idx as u32) + 1, line);
                        }
                    }
                    i += 2 + close + 2;
                    continue;
                }
            }
            i += 1;
        }
    }
}

fn strip_inline_code(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_code = false;
    for c in s.chars() {
        if c == '`' {
            in_code = !in_code;
            out.push(' ');
        } else if in_code {
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

fn find_close_brackets(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b']' && bytes[i + 1] == b']' {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Create a new empty file under an allowed directory. Used by the
/// "click unresolved wiki link" → create-file flow. Refuses to overwrite.
#[tauri::command]
fn create_text_file(
    path: String,
    state: State<'_, AllowedDirs>,
) -> Result<(), String> {
    validate_path(&path)?;
    let parent = Path::new(&path)
        .parent()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();
    let canonical_parent = is_dir_allowed(&parent, &state)?;
    let filename = Path::new(&path).file_name().ok_or("Invalid file name")?;
    let target = Path::new(&canonical_parent).join(filename);
    if target.exists() {
        return Err("File already exists".to_string());
    }
    atomic_write(&target, b"")
}

#[tauri::command]
fn list_directory(path: String, state: State<'_, AllowedDirs>) -> Result<Vec<DirEntry>, String> {
    validate_path(&path)?;
    is_dir_allowed(&path, &state)?;

    let entries = fs::read_dir(&path).map_err(|e| format!("Cannot read directory: {}", e))?;

    let mut result: Vec<DirEntry> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Cannot read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Cannot read metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/directories
        if name.starts_with('.') {
            continue;
        }

        result.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
        });
    }

    Ok(result)
}

/// Check if a file path is allowed — either explicitly whitelisted,
/// or located inside an allowed directory.
fn is_path_allowed(
    path: &str,
    path_state: &State<'_, AllowedPaths>,
    dir_state: &State<'_, AllowedDirs>,
) -> Result<String, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "Invalid file path".to_string())?;
    let canonical_str = canonical.to_string_lossy().to_string();

    // Check explicit file whitelist
    let paths = safe_lock(&path_state.0);
    if paths.contains(&canonical_str) {
        return Ok(canonical_str);
    }
    drop(paths);

    // Check if file is inside an allowed directory
    let dirs = safe_lock(&dir_state.0);
    if dirs
        .iter()
        .any(|allowed| canonical.starts_with(Path::new(allowed)))
    {
        return Ok(canonical_str);
    }

    Err("Access denied: file not selected via dialog".to_string())
}

/// Write bytes to `target` atomically: write to a sibling temp file then rename.
/// Uses a random suffix to avoid conflicts from concurrent writes.
fn atomic_write(target: &Path, data: &[u8]) -> Result<(), String> {
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
        // Clean up temp file on rename failure
        let _ = fs::remove_file(&tmp_path);
        format!("Cannot rename temp file: {}", e)
    })
}

/// Check whether `path_to_check` starts with (or equals) any of `prefixes`.
/// Comparison is done on `Path::components()` so "/etc" won't match "/etcetera".
fn starts_with_any(path_to_check: &Path, prefixes: &[&str]) -> bool {
    prefixes
        .iter()
        .any(|prefix| path_to_check.starts_with(prefix))
}

/// Return true if `path` contains any of `blocked` as a full path component
/// (or, for entries with `/`, as a substring — used for multi-segment markers
/// like `.config/gcloud`). Component match is case-insensitive.
fn has_blocked_component(path: &Path, blocked: &[&str]) -> bool {
    let path_str = path.to_string_lossy();
    for b in blocked {
        if b.contains('/') {
            // Multi-segment check (e.g. ".config/gcloud")
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

fn validate_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);

    // Must be absolute path
    if !p.is_absolute() {
        return Err("Only absolute paths are allowed".to_string());
    }

    // Block dangerous system directories using proper path-prefix checks
    // (not substring — avoids false positives like "/Users/me/etc-notes")
    let blocked_dirs: &[&str] = &[
        "/etc",
        "/var",
        "/usr",
        "/sys",
        "/proc",
        "/sbin",
        "/bin",
        "/boot",
        // macOS symlinks: /etc → /private/etc, /var → /private/var, /tmp → /private/tmp
        "/private/etc",
        "/private/var",
        "/private/tmp",
        // macOS system Library (per-user ~/Library is handled by component check below)
        "/Library",
    ];

    if starts_with_any(p, blocked_dirs) {
        return Err("Access to system directories is not allowed".to_string());
    }

    // Block sensitive dotfiles/directories anywhere in path components
    let blocked_components: &[&str] = &[
        ".ssh",
        ".gnupg",
        ".gpg",
        ".aws",
        ".kube",
        ".docker",
        ".config/gcloud",
        "Keychains",
        // Credentials often co-located with source trees
        ".git",
        ".npmrc",
        ".netrc",
    ];

    if has_blocked_component(p, blocked_components) {
        return Err("Access to sensitive directories is not allowed".to_string());
    }

    // Also check canonical path if it exists (catches symlink bypasses)
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

#[tauri::command]
fn read_file(
    path: String,
    state: State<'_, AllowedPaths>,
    dir_state: State<'_, AllowedDirs>,
) -> Result<String, String> {
    validate_path(&path)?;
    let canonical = is_path_allowed(&path, &state, &dir_state)?;

    let metadata = fs::metadata(&canonical).map_err(|_| "Cannot read file".to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large: {} bytes (max {})",
            metadata.len(),
            MAX_FILE_SIZE
        ));
    }
    // Bounded read: guards against a TOCTOU where the file grows between the
    // metadata check and the actual read (e.g. tail/log files, /dev/*).
    let mut buf = String::with_capacity(metadata.len() as usize);
    fs::File::open(&canonical)
        .map_err(|_| "Cannot read file".to_string())?
        .take(MAX_FILE_SIZE + 1)
        .read_to_string(&mut buf)
        .map_err(|_| "Cannot read file".to_string())?;
    if buf.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("File too large: exceeds {} bytes", MAX_FILE_SIZE));
    }
    Ok(buf)
}

#[tauri::command]
fn read_file_binary(
    path: String,
    state: State<'_, AllowedPaths>,
    dir_state: State<'_, AllowedDirs>,
) -> Result<String, String> {
    validate_path(&path)?;
    let canonical = is_path_allowed(&path, &state, &dir_state)?;

    let metadata = fs::metadata(&canonical).map_err(|_| "Cannot read file".to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large: {} bytes (max {})",
            metadata.len(),
            MAX_FILE_SIZE
        ));
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
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
fn write_file(
    path: String,
    content: String,
    state: State<'_, AllowedPaths>,
    dir_state: State<'_, AllowedDirs>,
) -> Result<(), String> {
    validate_path(&path)?;
    let canonical = is_path_allowed(&path, &state, &dir_state)?;

    if content.len() as u64 > MAX_FILE_SIZE {
        return Err(format!(
            "Content too large: {} bytes (max {})",
            content.len(),
            MAX_FILE_SIZE
        ));
    }
    atomic_write(Path::new(&canonical), content.as_bytes())
}

#[tauri::command]
fn write_file_binary(
    path: String,
    data: String,
    state: State<'_, AllowedDirs>,
) -> Result<(), String> {
    validate_path(&path)?;
    // The file is written inside an allowed directory (e.g. images/ subfolder)
    let parent = Path::new(&path)
        .parent()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();
    let canonical_parent = is_dir_allowed(&parent, &state)?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("base64 decode error: {}", e))?;

    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err(format!(
            "File too large: {} bytes (max {})",
            bytes.len(),
            MAX_FILE_SIZE
        ));
    }
    // Write to canonical parent + filename to prevent symlink-based TOCTOU
    let filename = Path::new(&path).file_name().ok_or("Invalid file name")?;
    let canonical_path = Path::new(&canonical_parent).join(filename);
    atomic_write(&canonical_path, &bytes)?;
    // Re-validate the final on-disk path: guards against the filename pointing
    // at a pre-existing symlink that escapes the allowed directory.
    let final_canonical = fs::canonicalize(&canonical_path)
        .map_err(|e| format!("Cannot resolve written file: {}", e))?;
    validate_path(&final_canonical.to_string_lossy())?;
    if !final_canonical.starts_with(Path::new(&canonical_parent)) {
        // The file resolved outside of the allowed directory — remove it.
        let _ = fs::remove_file(&canonical_path);
        return Err("Write rejected: symlink escape detected".to_string());
    }
    Ok(())
}

#[tauri::command]
fn ensure_dir(path: String, state: State<'_, AllowedDirs>) -> Result<(), String> {
    validate_path(&path)?;
    let canonical_parent = is_dir_allowed(&path, &state).or_else(|_| {
        // The dir may not exist yet, check if its parent is allowed
        let parent = Path::new(&path)
            .parent()
            .ok_or("Invalid path")?
            .to_string_lossy()
            .to_string();
        is_dir_allowed(&parent, &state)
    })?;
    // Use canonical parent + dirname to prevent symlink escape
    let dir_name = Path::new(&path)
        .file_name()
        .ok_or("Invalid directory name")?;
    let target = Path::new(&canonical_parent).join(dir_name);
    fs::create_dir_all(&target).map_err(|e| format!("Cannot create directory: {}", e))?;
    // Re-validate canonical target after creation to catch symlink-based escapes
    let canonical_target = fs::canonicalize(&target)
        .map_err(|e| format!("Cannot resolve created directory: {}", e))?;
    validate_path(&canonical_target.to_string_lossy())?;
    Ok(())
}

#[tauri::command]
fn get_image_temp_dir(
    app: tauri::AppHandle,
    state: State<'_, AllowedDirs>,
) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    let img_dir = data_dir.join("temp-images");
    fs::create_dir_all(&img_dir).map_err(|e| format!("Cannot create temp image dir: {}", e))?;
    let img_dir_str = img_dir.to_string_lossy().to_string();
    // Auto-register so callers don't need a separate allow_dir call
    let mut dirs = safe_lock(&state.0);
    if !dirs.contains(&img_dir_str) {
        dirs.push(img_dir_str.clone());
    }
    Ok(img_dir_str)
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<String, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Cannot resolve config dir: {}", e))?;
    let settings_path = config_dir.join("settings.json");
    if settings_path.exists() {
        fs::read_to_string(&settings_path).map_err(|e| format!("Cannot read settings: {}", e))
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: String) -> Result<(), String> {
    // Validate the payload is a JSON object. Additionally filter
    // `recentFolders` / `lastOpenedFolder` so a compromised frontend cannot
    // smuggle blocked paths (e.g. /etc, ~/.ssh) through settings and later
    // reopen them via `reopen_dir`.
    let mut parsed: serde_json::Value =
        serde_json::from_str(&settings).map_err(|e| format!("Invalid settings JSON: {}", e))?;
    if !parsed.is_object() {
        return Err("Settings must be a JSON object".to_string());
    }
    if let Some(obj) = parsed.as_object_mut() {
        if let Some(v) = obj.get_mut("recentFolders") {
            if let Some(arr) = v.as_array_mut() {
                arr.retain(|entry| {
                    entry
                        .as_str()
                        .map(|s| validate_path(s).is_ok())
                        .unwrap_or(false)
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
    let sanitised = serde_json::to_string(&parsed)
        .map_err(|e| format!("Failed to serialise settings: {}", e))?;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Cannot resolve config dir: {}", e))?;
    fs::create_dir_all(&config_dir).map_err(|e| format!("Cannot create config dir: {}", e))?;
    let settings_path = config_dir.join("settings.json");
    atomic_write(&settings_path, sanitised.as_bytes())
}

/* ── PTY sessions (Claude Code / Codex CLI panel) ───────────────────
 *
 * We spawn the CLI tool (`claude` or `codex`) inside a pseudo-terminal so
 * its interactive UI (ANSI colors, cursor motion, progress spinners) renders
 * correctly in an xterm.js pane on the frontend.
 *
 * Invariants enforced here:
 *   1. Only binaries in ALLOWED_PTY_TOOLS may be spawned.
 *   2. The working directory must already be whitelisted via the folder
 *      dialog (see AllowedDirs) — you cannot launch a CLI in a directory the
 *      user has not explicitly opened.
 *   3. Output is streamed to the frontend via `pty://data:{id}` events; no
 *      raw bytes are retained in the backend after emit.
 */

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct PtySessions {
    inner: Arc<Mutex<HashMap<u32, PtySession>>>,
    next_id: AtomicU32,
}

impl PtySessions {
    fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU32::new(1),
        }
    }
}

fn validate_pty_tool(tool: &str) -> Result<&'static str, String> {
    ALLOWED_PTY_TOOLS
        .iter()
        .copied()
        .find(|t| *t == tool)
        .ok_or_else(|| format!("Tool not allowed: {}", tool))
}

/// Resolve a PTY tool binary (`claude` / `codex`) to an absolute path, searching
/// only a fixed set of trusted installation directories. This prevents PATH
/// hijacking via an attacker-controlled shell profile: even if the user's
/// `$PATH` was modified to prepend a rogue directory, we will not pick up a
/// binary from it.
fn resolve_pty_tool(tool: &str) -> Result<String, String> {
    let mut dirs: Vec<std::path::PathBuf> = vec![
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
    ];
    if let Ok(home) = std::env::var("HOME") {
        let home = std::path::PathBuf::from(home);
        dirs.push(home.join(".cargo/bin"));
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".volta/bin"));
        dirs.push(home.join(".npm-global/bin"));
        dirs.push(home.join(".bun/bin"));
        dirs.push(home.join(".nvm/versions"));
    }
    for d in &dirs {
        let candidate = d.join(tool);
        if candidate.is_file() {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }
    // NVM stores node binaries under versioned subdirs; best-effort shallow scan.
    if let Ok(home) = std::env::var("HOME") {
        let nvm = std::path::PathBuf::from(home).join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(&nvm) {
            for e in entries.flatten() {
                let p = e.path().join("bin").join(tool);
                if p.is_file() {
                    return Ok(p.to_string_lossy().to_string());
                }
            }
        }
    }
    Err(format!(
        "Tool `{}` not found in trusted install dirs: {:?}",
        tool, dirs
    ))
}

#[tauri::command]
fn pty_spawn(
    tool: String,
    cwd: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    dir_state: State<'_, AllowedDirs>,
    sessions: State<'_, PtySessions>,
) -> Result<u32, String> {
    let tool = validate_pty_tool(&tool)?;
    validate_path(&cwd)?;
    let canonical_cwd = is_dir_allowed(&cwd, &dir_state)?;

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Cannot open pty: {}", e))?;

    // Resolve the tool to a fixed, trusted absolute path — we do not rely on
    // `$PATH` lookup inside the spawned process, and we give the child a
    // sanitised PATH that only contains known-safe install dirs.
    let tool_abs = resolve_pty_tool(tool)?;
    let mut cmd = CommandBuilder::new(&tool_abs);
    cmd.cwd(&canonical_cwd);
    cmd.env("TERM", "xterm-256color");
    let mut safe_path = String::from("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    if let Ok(home) = std::env::var("HOME") {
        safe_path.push_str(&format!(
            ":{h}/.cargo/bin:{h}/.local/bin:{h}/.volta/bin:{h}/.npm-global/bin:{h}/.bun/bin",
            h = home
        ));
        cmd.env("HOME", &home);
    }
    cmd.env("PATH", safe_path);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Cannot spawn {}: {}", tool, e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Cannot clone pty reader: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Cannot take pty writer: {}", e))?;

    let id = sessions.next_id.fetch_add(1, Ordering::SeqCst);

    {
        let mut map = safe_lock(&sessions.inner);
        map.insert(
            id,
            PtySession {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    // Reader thread — streams bytes to the frontend as base64 chunks.
    let app_for_reader = app.clone();
    let sessions_for_reader = Arc::clone(&sessions.inner);
    let _ = thread::Builder::new()
        .name(format!("pty-reader-{}", id))
        .spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        let _ = app_for_reader
                            .emit("pty:data", serde_json::json!({ "id": id, "data": encoded }));
                    }
                    Err(_) => break,
                }
            }
            // Reader returned EOF / error — tell the frontend the session ended
            // and drop it from the session map so pty_write returns an error.
            let _ = app_for_reader.emit("pty:exit", serde_json::json!({ "id": id }));
            let mut map = safe_lock(&sessions_for_reader);
            map.remove(&id);
        });

    Ok(id)
}

#[tauri::command]
fn pty_write(id: u32, data: String, sessions: State<'_, PtySessions>) -> Result<(), String> {
    if data.len() > MAX_PTY_WRITE {
        return Err("Input too large".to_string());
    }
    let mut map = safe_lock(&sessions.inner);
    let session = map
        .get_mut(&id)
        .ok_or_else(|| "Session not found".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    Ok(())
}

#[tauri::command]
fn pty_resize(
    id: u32,
    cols: u16,
    rows: u16,
    sessions: State<'_, PtySessions>,
) -> Result<(), String> {
    let map = safe_lock(&sessions.inner);
    let session = map
        .get(&id)
        .ok_or_else(|| "Session not found".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {}", e))?;
    Ok(())
}

#[tauri::command]
fn pty_kill(id: u32, sessions: State<'_, PtySessions>) -> Result<(), String> {
    let mut map = safe_lock(&sessions.inner);
    if let Some(mut session) = map.remove(&id) {
        // Best-effort — the reader thread will also observe EOF and emit pty:exit.
        let _ = session.child.kill();
    }
    Ok(())
}

/* ── AI Sessions (persistent chat history) ──────────────────────────── */

fn sessions_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve data dir: {}", e))?;
    let dir = data_dir.join("ai-sessions");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create sessions dir: {}", e))?;
    Ok(dir)
}

#[tauri::command]
fn ai_save_session(app: AppHandle, session: String) -> Result<(), String> {
    let parsed: serde_json::Value =
        serde_json::from_str(&session).map_err(|e| format!("Invalid JSON: {}", e))?;
    let id = parsed
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Session must have an id")?;
    let path = sessions_dir(&app)?.join(format!("{}.json", id));
    atomic_write(&path, session.as_bytes())
}

#[tauri::command]
fn ai_list_sessions(app: AppHandle) -> Result<String, String> {
    let dir = sessions_dir(&app)?;
    let mut sessions: Vec<serde_json::Value> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                if let Ok(data) = fs::read_to_string(&path) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&data) {
                        sessions.push(val);
                    }
                }
            }
        }
    }
    // Sort by updatedAt descending
    sessions.sort_by(|a, b| {
        let ta = a.get("updatedAt").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let tb = b.get("updatedAt").and_then(|v| v.as_f64()).unwrap_or(0.0);
        tb.partial_cmp(&ta).unwrap_or(std::cmp::Ordering::Equal)
    });
    serde_json::to_string(&sessions).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
fn ai_delete_session(app: AppHandle, id: String) -> Result<(), String> {
    let path = sessions_dir(&app)?.join(format!("{}.json", id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Cannot delete session: {}", e))?;
    }
    Ok(())
}

/* ── ACP (Agent Client Protocol) ───────────────────────────────────── */

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AcpAdapter {
    Claude,
    Codex,
}

impl AcpAdapter {
    fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    fn from_str(v: &str) -> Result<Self, String> {
        match v {
            "claude" => Ok(Self::Claude),
            "codex" => Ok(Self::Codex),
            _ => Err(format!("Unsupported ACP adapter: {}", v)),
        }
    }

    fn candidate_bin_names(self) -> &'static [&'static str] {
        match self {
            Self::Claude => &["claude-agent-acp"],
            // Keep both names for compatibility with different package eras.
            Self::Codex => &["codex-acp", "codex-agent-acp"],
        }
    }
}

/// Holds ACP process and active adapter. Initialised lazily on first use.
pub struct AcpState {
    process: tokio::sync::Mutex<Option<Arc<AcpProcess>>>,
    adapter: tokio::sync::Mutex<AcpAdapter>,
}

/// Resolve the ACP adapter binary bundled via npm.
fn resolve_acp_bin(_app: &AppHandle, adapter: AcpAdapter) -> Result<String, String> {
    let bin_names = adapter.candidate_bin_names();

    // Collect candidate paths
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // 1. Current working directory (Tauri dev runs from project root)
    if let Ok(cwd) = std::env::current_dir() {
        for bin_name in bin_names {
            candidates.push(cwd.join("node_modules/.bin").join(bin_name));
        }
        // Also try one level up (cwd might be src-tauri/)
        if let Some(parent) = cwd.parent() {
            for bin_name in bin_names {
                candidates.push(parent.join("node_modules/.bin").join(bin_name));
            }
        }
    }

    // 2. Relative to the executable (production .app bundle)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for bin_name in bin_names {
                candidates.push(dir.join("../Resources/node_modules/.bin").join(bin_name));
                candidates.push(dir.join("node_modules/.bin").join(bin_name));
            }
        }
    }

    // 3. CARGO_MANIFEST_DIR (set at compile time for dev builds)
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let manifest_path = std::path::Path::new(manifest_dir);
    if let Some(project_root) = manifest_path.parent() {
        for bin_name in bin_names {
            candidates.push(project_root.join("node_modules/.bin").join(bin_name));
        }
    }

    for c in &candidates {
        if c.exists() {
            return Ok(c.to_string_lossy().to_string());
        }
    }

    // PATH is intentionally NOT searched: an attacker-controlled directory
    // earlier in $PATH (e.g. via a compromised shell profile) could otherwise
    // substitute a malicious `claude-agent-acp` binary. Only bundled /
    // project-relative `node_modules/.bin` paths are trusted.
    Err(format!(
        "ACP binary not found for {}. candidates: {:?} / searched: {:?}",
        adapter.as_str(),
        bin_names,
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
    ))
}

/// Ensure the ACP process is running and return a handle.
async fn ensure_acp(state: &AcpState, app: &AppHandle) -> Result<Arc<AcpProcess>, String> {
    let adapter = *state.adapter.lock().await;
    let mut guard = state.process.lock().await;
    if let Some(ref acp) = *guard {
        return Ok(Arc::clone(acp));
    }
    let bin = resolve_acp_bin(app, adapter)?;
    // Hand the ACP reader the same allow-lists that guard Tauri commands so
    // `fs/read_text_file` / `fs/write_text_file` can't escape them.
    let paths_state = app.state::<AllowedPaths>();
    let dirs_state = app.state::<AllowedDirs>();
    let allowed_paths = Arc::clone(&paths_state.0);
    let allowed_dirs = Arc::clone(&dirs_state.0);
    let acp = AcpProcess::spawn(&bin, app.clone(), allowed_paths, allowed_dirs).await?;
    *guard = Some(Arc::clone(&acp));
    Ok(acp)
}

#[tauri::command]
async fn acp_get_adapter(state: State<'_, AcpState>) -> Result<String, String> {
    Ok(state.adapter.lock().await.as_str().to_string())
}

#[tauri::command]
async fn acp_set_adapter(adapter: String, state: State<'_, AcpState>) -> Result<String, String> {
    let next = AcpAdapter::from_str(&adapter)?;
    {
        let mut adapter_guard = state.adapter.lock().await;
        if *adapter_guard != next {
            *adapter_guard = next;
            let mut process_guard = state.process.lock().await;
            if let Some(acp) = process_guard.take() {
                acp.kill().await;
            }
        }
    }
    Ok(next.as_str().to_string())
}

/// Initialize ACP — spawns the process and sends the `initialize` handshake.
/// Returns the InitializeResponse (auth methods, capabilities).
#[tauri::command]
async fn acp_initialize(app: AppHandle, state: State<'_, AcpState>) -> Result<String, String> {
    let acp = ensure_acp(&state, &app).await?;
    // Read the user-facing version from tauri.conf.json (which references
    // package.json) so we don't duplicate the version constant in Rust.
    let version = app.package_info().version.to_string();
    let result = acp
        .request(
            "initialize",
            serde_json::json!({
                "protocolVersion": 1,
                "clientInfo": {
                    "name": "mdeditor",
                    "title": "mdeditor",
                    "version": version
                },
                "clientCapabilities": {
                    "fs": { "readTextFile": true, "writeTextFile": true }
                }
            }),
        )
        .await?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Create a new ACP session. Returns sessionId, models, modes, configOptions, commands.
#[tauri::command]
async fn acp_new_session(
    cwd: String,
    app: AppHandle,
    state: State<'_, AcpState>,
) -> Result<String, String> {
    let acp = ensure_acp(&state, &app).await?;
    let result = acp
        .request(
            "session/new",
            serde_json::json!({
                "cwd": cwd,
                "mcpServers": []
            }),
        )
        .await?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Send a prompt to an ACP session. Streaming updates arrive via `acp:session-update` events.
/// Returns the prompt response (stopReason, usage).
#[tauri::command]
async fn acp_prompt(
    session_id: String,
    prompt: String,
    app: AppHandle,
    state: State<'_, AcpState>,
) -> Result<String, String> {
    let acp = ensure_acp(&state, &app).await?;
    let result = acp
        .request(
            "session/prompt",
            serde_json::json!({
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": prompt }]
            }),
        )
        .await?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Cancel an in-progress prompt.
#[tauri::command]
async fn acp_cancel(
    session_id: String,
    app: AppHandle,
    state: State<'_, AcpState>,
) -> Result<(), String> {
    let acp = ensure_acp(&state, &app).await?;
    acp.notify(
        "session/cancel",
        serde_json::json!({ "sessionId": session_id }),
    )
    .await
}

/// Switch model for a session.
#[tauri::command]
async fn acp_set_model(
    session_id: String,
    model_id: String,
    app: AppHandle,
    state: State<'_, AcpState>,
) -> Result<String, String> {
    let acp = ensure_acp(&state, &app).await?;
    let result = acp
        .request(
            "session/set_model",
            serde_json::json!({
                "sessionId": session_id,
                "modelId": model_id
            }),
        )
        .await?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Set a config option (model selector, thinking toggle, etc.).
#[tauri::command]
async fn acp_set_config(
    session_id: String,
    config_id: String,
    value: String,
    app: AppHandle,
    state: State<'_, AcpState>,
) -> Result<String, String> {
    let acp = ensure_acp(&state, &app).await?;
    let result = acp
        .request(
            "session/set_config_option",
            serde_json::json!({
                "sessionId": session_id,
                "configId": config_id,
                "value": value
            }),
        )
        .await?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// List past sessions.
#[tauri::command]
async fn acp_list_sessions(
    cwd: Option<String>,
    app: AppHandle,
    state: State<'_, AcpState>,
) -> Result<String, String> {
    let acp = ensure_acp(&state, &app).await?;
    let result = acp
        .request("session/list", serde_json::json!({ "cwd": cwd }))
        .await?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Resume (reconnect to) a past session.
#[tauri::command]
async fn acp_resume_session(
    session_id: String,
    cwd: String,
    app: AppHandle,
    state: State<'_, AcpState>,
) -> Result<String, String> {
    let acp = ensure_acp(&state, &app).await?;
    let result = acp
        .request(
            "session/resume",
            serde_json::json!({
                "sessionId": session_id,
                "cwd": cwd,
                "mcpServers": []
            }),
        )
        .await?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Kill the ACP process.
#[tauri::command]
async fn acp_shutdown(state: State<'_, AcpState>) -> Result<(), String> {
    let mut guard = state.process.lock().await;
    if let Some(acp) = guard.take() {
        acp.kill().await;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;

                // macOS app menu
                use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};

                let app_menu = SubmenuBuilder::new(app, "mdeditor")
                    .about(None)
                    .separator()
                    .item(&MenuItem::with_id(
                        app,
                        "check_updates",
                        "Check for Updates...",
                        true,
                        None::<&str>,
                    )?)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .item(&app_menu)
                    .item(&edit_menu)
                    .build()?;
                app.set_menu(menu)?;

                app.on_menu_event(|app_handle, event| {
                    if event.id().as_ref() == "check_updates" {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.emit("menu-check-updates", ());
                        }
                    }
                });
            }

            // Clean up stale temp-images directory on startup
            if let Ok(data_dir) = app.path().app_data_dir() {
                let temp_dir = data_dir.join("temp-images");
                if temp_dir.exists() {
                    let _ = fs::remove_dir_all(&temp_dir);
                }
            }

            Ok(())
        })
        .manage(AllowedPaths(Arc::new(Mutex::new(Vec::new()))))
        .manage(AllowedDirs(Arc::new(Mutex::new(Vec::new()))))
        .manage(PtySessions::new())
        .manage(AcpState {
            process: tokio::sync::Mutex::new(None),
            adapter: tokio::sync::Mutex::new(AcpAdapter::Claude),
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_file_binary,
            write_file,
            write_file_binary,
            ensure_dir,
            get_image_temp_dir,
            allow_path,
            allow_dir,
            reopen_dir,
            list_directory,
            list_files_recursive,
            search_in_dir,
            build_backlinks_index,
            create_text_file,
            load_settings,
            save_settings,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            ai_save_session,
            ai_list_sessions,
            ai_delete_session,
            acp_get_adapter,
            acp_set_adapter,
            acp_initialize,
            acp_new_session,
            acp_prompt,
            acp_cancel,
            acp_set_model,
            acp_set_config,
            acp_list_sessions,
            acp_resume_session,
            acp_shutdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // ── validate_path tests ──

    #[test]
    fn rejects_relative_path() {
        assert!(validate_path("relative/path.md").is_err());
    }

    #[test]
    fn accepts_normal_absolute_path() {
        // /tmp always exists on macOS/Linux
        assert!(validate_path("/tmp/test-file.md").is_ok());
    }

    #[test]
    fn blocks_etc_directory() {
        assert!(validate_path("/etc/passwd").is_err());
    }

    #[test]
    fn blocks_var_directory() {
        assert!(validate_path("/var/log/syslog").is_err());
    }

    #[test]
    fn blocks_usr_directory() {
        assert!(validate_path("/usr/bin/ls").is_err());
    }

    #[test]
    fn blocks_ssh_directory() {
        assert!(validate_path("/Users/alice/.ssh/id_rsa").is_err());
    }

    #[test]
    fn does_not_false_positive_on_etc_in_name() {
        // "etc" as part of a directory name should NOT be blocked
        assert!(validate_path("/tmp/etcetera/notes.md").is_ok());
    }

    #[test]
    fn does_not_false_positive_on_var_in_name() {
        assert!(validate_path("/tmp/variable-data/file.txt").is_ok());
    }

    #[test]
    fn does_not_false_positive_on_usr_in_name() {
        assert!(validate_path("/tmp/usrdata/file.txt").is_ok());
    }

    #[test]
    fn blocks_sbin_directory() {
        assert!(validate_path("/sbin/reboot").is_err());
    }

    #[test]
    fn blocks_gnupg_directory() {
        assert!(validate_path("/Users/alice/.gnupg/private-keys-v1.d/key").is_err());
    }

    #[test]
    fn blocks_aws_directory() {
        assert!(validate_path("/Users/alice/.aws/credentials").is_err());
    }

    #[test]
    fn blocks_kube_directory() {
        assert!(validate_path("/Users/alice/.kube/config").is_err());
    }

    #[test]
    fn blocks_keychains_directory() {
        assert!(validate_path("/Users/alice/Library/Keychains/login.keychain-db").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn blocks_private_etc_on_macos() {
        assert!(validate_path("/private/etc/hosts").is_err());
    }

    // ── atomic_write tests ──

    #[test]
    fn atomic_write_creates_file() {
        let dir = std::env::temp_dir().join("mdeditor-test-atomic");
        let _ = fs::create_dir_all(&dir);
        let target = dir.join("test-atomic.txt");
        let _ = fs::remove_file(&target);

        let result = atomic_write(&target, b"hello atomic");
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&target).unwrap(), "hello atomic");

        // Cleanup
        let _ = fs::remove_file(&target);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn atomic_write_overwrites_existing() {
        let dir = std::env::temp_dir().join("mdeditor-test-overwrite");
        let _ = fs::create_dir_all(&dir);
        let target = dir.join("test-overwrite.txt");

        fs::write(&target, "old content").unwrap();
        let result = atomic_write(&target, b"new content");
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&target).unwrap(), "new content");

        // Cleanup
        let _ = fs::remove_file(&target);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn atomic_write_no_leftover_temp_on_success() {
        let dir = std::env::temp_dir().join("mdeditor-test-no-temp");
        let _ = fs::create_dir_all(&dir);
        let target = dir.join("test-no-temp.txt");
        let _ = fs::remove_file(&target);

        atomic_write(&target, b"data").unwrap();

        // No .tmp files should remain
        let temps: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(temps.is_empty(), "leftover temp files found: {:?}", temps);

        // Cleanup
        let _ = fs::remove_file(&target);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn atomic_write_fails_when_parent_missing() {
        // Parent directory does not exist → writing the temp file fails cleanly.
        let target = std::env::temp_dir()
            .join("mdeditor-nonexistent-dir-xyz")
            .join("f.txt");
        let result = atomic_write(&target, b"nope");
        assert!(result.is_err(), "expected error, got: {:?}", result);
    }

    // ── starts_with_any tests ──

    #[test]
    fn starts_with_any_matches_exact_prefix() {
        let prefixes = ["/etc", "/var"];
        assert!(starts_with_any(Path::new("/etc/hosts"), &prefixes));
        assert!(starts_with_any(Path::new("/var/log/app.log"), &prefixes));
    }

    #[test]
    fn starts_with_any_respects_component_boundary() {
        // "/etc" must not match "/etcetera" — this is the whole point of
        // using Path::starts_with over str::starts_with.
        let prefixes = ["/etc"];
        assert!(!starts_with_any(Path::new("/etcetera/notes.md"), &prefixes));
        assert!(!starts_with_any(Path::new("/var-logs/x"), &["/var"]));
    }

    #[test]
    fn starts_with_any_empty_prefix_list_returns_false() {
        assert!(!starts_with_any(Path::new("/anything"), &[]));
    }

    // ── has_blocked_component tests ──

    #[test]
    fn blocked_component_matches_anywhere_in_path() {
        let blocked = [".ssh"];
        assert!(has_blocked_component(
            Path::new("/Users/a/.ssh/id_rsa"),
            &blocked
        ));
        assert!(has_blocked_component(Path::new("/tmp/.ssh/keys"), &blocked));
    }

    #[test]
    fn blocked_component_is_case_insensitive() {
        let blocked = [".ssh", ".aws"];
        assert!(has_blocked_component(
            Path::new("/Users/a/.SSH/id_rsa"),
            &blocked
        ));
        assert!(has_blocked_component(
            Path::new("/Users/a/.Aws/creds"),
            &blocked
        ));
    }

    #[test]
    fn blocked_component_does_not_match_substring() {
        // ".ssh" should not match ".sshnotes" as a component
        let blocked = [".ssh"];
        assert!(!has_blocked_component(
            Path::new("/Users/a/.sshnotes/x"),
            &blocked
        ));
        assert!(!has_blocked_component(
            Path::new("/tmp/myssh/keys"),
            &blocked
        ));
    }

    #[test]
    fn blocked_component_multi_segment_uses_substring() {
        // Entries with `/` use substring match (documented behavior).
        let blocked = [".config/gcloud"];
        assert!(has_blocked_component(
            Path::new("/Users/a/.config/gcloud/creds"),
            &blocked
        ));
        assert!(!has_blocked_component(
            Path::new("/Users/a/.config/other/creds"),
            &blocked
        ));
    }

    // ── validate_path additional edge cases ──

    #[test]
    fn rejects_empty_path() {
        assert!(validate_path("").is_err());
    }

    #[test]
    fn blocks_boot_proc_sys_bin_directories() {
        assert!(validate_path("/boot/vmlinuz").is_err());
        assert!(validate_path("/proc/1/mem").is_err());
        assert!(validate_path("/sys/kernel/x").is_err());
        assert!(validate_path("/bin/sh").is_err());
    }

    #[test]
    fn blocks_docker_and_gpg_component() {
        assert!(validate_path("/Users/alice/.docker/config.json").is_err());
        assert!(validate_path("/Users/alice/.gpg/private").is_err());
    }

    #[test]
    fn blocks_gcloud_under_config() {
        assert!(validate_path("/Users/alice/.config/gcloud/credentials.db").is_err());
    }

    #[test]
    fn blocks_git_internal_paths() {
        // .git/ holds credentials (packed-refs, config with URLs, hooks).
        assert!(validate_path("/Users/alice/repo/.git/config").is_err());
        assert!(validate_path("/tmp/proj/.git/HEAD").is_err());
    }

    #[test]
    fn blocks_npmrc_and_netrc() {
        assert!(validate_path("/Users/alice/.npmrc").is_err());
        assert!(validate_path("/Users/alice/.netrc").is_err());
    }

    #[test]
    fn ssh_match_is_case_insensitive_via_validate_path() {
        assert!(validate_path("/Users/alice/.SSH/id_rsa").is_err());
    }

    #[test]
    fn nested_allowed_path_still_passes() {
        // /tmp is NOT in the blocked list; nested paths are fine.
        assert!(validate_path("/tmp/notes/subdir/file.md").is_ok());
    }

    // ── search helpers ──

    #[test]
    fn searchable_ext_matches_known_types() {
        assert!(has_searchable_ext("foo.md"));
        assert!(has_searchable_ext("README.MD"));
        assert!(has_searchable_ext("a.ts"));
        assert!(!has_searchable_ext("image.png"));
        assert!(!has_searchable_ext("noext"));
    }

    #[test]
    fn skip_dir_includes_node_modules_and_hidden() {
        assert!(should_skip_dir("node_modules"));
        assert!(should_skip_dir(".git"));
        assert!(should_skip_dir("target"));
        assert!(!should_skip_dir("src"));
    }

    #[test]
    fn trim_line_short_line_passthrough() {
        let (t, p) = trim_line_around("hello world", 6, 5);
        assert_eq!(t, "hello world");
        assert_eq!(p, 6);
    }

    #[test]
    fn trim_line_long_line_centers_match() {
        let line = "a".repeat(500) + "MATCH" + &"b".repeat(500);
        let (t, p) = trim_line_around(&line, 500, 5);
        assert!(t.starts_with('…'));
        assert!(t.ends_with('…'));
        assert_eq!(&t[p..p + 5], "MATCH");
    }

    // ── wiki link extraction ──

    fn collect_wiki_links(src: &str) -> Vec<(String, u32)> {
        let mut out = Vec::new();
        extract_wiki_links(src, |t, l, _| out.push((t.to_string(), l)));
        out
    }

    #[test]
    fn extracts_simple_wiki_link() {
        let hits = collect_wiki_links("see [[notes]] here");
        assert_eq!(hits, vec![("notes".to_string(), 1)]);
    }

    #[test]
    fn extracts_aliased_wiki_link_target_only() {
        let hits = collect_wiki_links("see [[notes|My Notes]] here");
        assert_eq!(hits, vec![("notes".to_string(), 1)]);
    }

    #[test]
    fn extracts_multiple_links_per_line_with_correct_line_number() {
        let src = "first line\n[[a]] and [[b|alias]]\nthird";
        let hits = collect_wiki_links(src);
        assert_eq!(
            hits,
            vec![("a".to_string(), 2), ("b".to_string(), 2)]
        );
    }

    #[test]
    fn ignores_links_inside_fenced_code_block() {
        let src = "before\n```\n[[ignored]]\n```\n[[after]]";
        let hits = collect_wiki_links(src);
        assert_eq!(hits, vec![("after".to_string(), 5)]);
    }

    #[test]
    fn ignores_links_inside_inline_code() {
        let hits = collect_wiki_links("plain `[[code]]` then [[real]]");
        assert_eq!(hits, vec![("real".to_string(), 1)]);
    }

    #[test]
    fn ignores_empty_brackets() {
        assert!(collect_wiki_links("[[]] [[ ]]").is_empty());
    }

    #[test]
    fn handles_unicode_targets() {
        let hits = collect_wiki_links("see [[ノート]] here");
        assert_eq!(hits, vec![("ノート".to_string(), 1)]);
    }

    #[test]
    fn does_not_match_single_brackets() {
        assert!(collect_wiki_links("just [link](url) text").is_empty());
    }

    // ── validate_pty_tool tests ──

    #[test]
    fn pty_tool_allows_claude_and_codex() {
        assert_eq!(validate_pty_tool("claude").unwrap(), "claude");
        assert_eq!(validate_pty_tool("codex").unwrap(), "codex");
    }

    #[test]
    fn pty_tool_rejects_arbitrary_binaries() {
        // The frontend must never be able to spawn a shell or arbitrary
        // executable via pty_spawn — only the two CLI tools we explicitly
        // support.
        assert!(validate_pty_tool("sh").is_err());
        assert!(validate_pty_tool("bash").is_err());
        assert!(validate_pty_tool("claude; rm -rf /").is_err());
        assert!(validate_pty_tool("/usr/bin/claude").is_err());
        assert!(validate_pty_tool("").is_err());
    }
}
