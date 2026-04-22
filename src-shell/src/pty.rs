// PTY sessions for the Claude Code / Codex CLI panel.
// Mirrors src-tauri/src/lib.rs pty_* commands — spawns only the allow-listed
// tools from a trusted install directory, sanitises PATH, streams output
// as base64 via a shell event back to the frontend.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use base64::Engine;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde_json::Value;

use crate::events::EventEmitter;
use crate::sandbox::{is_dir_allowed, safe_lock, validate_path, SharedList};

const MAX_PTY_WRITE: usize = 1024 * 1024;
const ALLOWED_PTY_TOOLS: &[&str] = &["claude", "codex"];

pub struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct PtySessions {
    pub inner: Arc<Mutex<HashMap<u32, PtySession>>>,
    pub next_id: AtomicU32,
}

impl PtySessions {
    pub fn new() -> Self {
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

fn resolve_pty_tool(tool: &str) -> Result<String, String> {
    let mut dirs: Vec<PathBuf> = vec![
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
    ];
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".cargo/bin"));
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".volta/bin"));
        dirs.push(home.join(".npm-global/bin"));
        dirs.push(home.join(".bun/bin"));
    }
    for d in &dirs {
        let candidate = d.join(tool);
        if candidate.is_file() {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let nvm = PathBuf::from(home).join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(&nvm) {
            for e in entries.flatten() {
                let p = e.path().join("bin").join(tool);
                if p.is_file() {
                    return Ok(p.to_string_lossy().to_string());
                }
            }
        }
    }
    Err(format!("Tool `{}` not found in trusted install dirs", tool))
}

pub fn spawn(
    sessions: &PtySessions,
    allowed_dirs: &SharedList,
    emitter: &EventEmitter,
    args: &Value,
) -> Result<Value, String> {
    let tool = args.get("tool").and_then(|v| v.as_str()).ok_or("missing tool")?;
    let cwd = args.get("cwd").and_then(|v| v.as_str()).ok_or("missing cwd")?;
    let cols = args.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
    let rows = args.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;

    let tool = validate_pty_tool(tool)?;
    validate_path(cwd)?;
    let canonical_cwd = is_dir_allowed(cwd, allowed_dirs)?;

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Cannot open pty: {}", e))?;

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
        map.insert(id, PtySession { writer, master: pair.master, child });
    }

    let emitter_reader = emitter.clone();
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
                        emitter_reader.emit("pty:data", serde_json::json!({ "id": id, "data": encoded }));
                    }
                    Err(_) => break,
                }
            }
            emitter_reader.emit("pty:exit", serde_json::json!({ "id": id }));
            let mut map = safe_lock(&sessions_for_reader);
            map.remove(&id);
        });

    Ok(Value::from(id))
}

pub fn write(sessions: &PtySessions, args: &Value) -> Result<Value, String> {
    let id = args.get("id").and_then(|v| v.as_u64()).ok_or("missing id")? as u32;
    let data = args.get("data").and_then(|v| v.as_str()).ok_or("missing data")?;
    if data.len() > MAX_PTY_WRITE {
        return Err("Input too large".to_string());
    }
    let mut map = safe_lock(&sessions.inner);
    let session = map.get_mut(&id).ok_or("Session not found")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| format!("Write failed: {}", e))?;
    Ok(Value::Null)
}

pub fn resize(sessions: &PtySessions, args: &Value) -> Result<Value, String> {
    let id = args.get("id").and_then(|v| v.as_u64()).ok_or("missing id")? as u32;
    let cols = args.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
    let rows = args.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
    let map = safe_lock(&sessions.inner);
    let session = map.get(&id).ok_or("Session not found")?;
    session
        .master
        .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Resize failed: {}", e))?;
    Ok(Value::Null)
}

pub fn kill(sessions: &PtySessions, args: &Value) -> Result<Value, String> {
    let id = args.get("id").and_then(|v| v.as_u64()).ok_or("missing id")? as u32;
    let mut map = safe_lock(&sessions.inner);
    if let Some(mut session) = map.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_claude_and_codex() {
        assert_eq!(validate_pty_tool("claude").unwrap(), "claude");
        assert_eq!(validate_pty_tool("codex").unwrap(), "codex");
    }

    #[test]
    fn rejects_arbitrary_binaries() {
        assert!(validate_pty_tool("sh").is_err());
        assert!(validate_pty_tool("bash").is_err());
        assert!(validate_pty_tool("claude; rm -rf /").is_err());
        assert!(validate_pty_tool("/usr/bin/claude").is_err());
        assert!(validate_pty_tool("").is_err());
    }
}
