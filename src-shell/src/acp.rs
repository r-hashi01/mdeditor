//! ACP (Agent Client Protocol) client.
//! Ported from src-tauri/src/acp.rs with event emission swapped to our
//! EventEmitter and path validation swapped to crate::sandbox.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex};

use crate::events::EventEmitter;
use crate::sandbox::{validate_path, SharedList};

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, Value>>>>>;

pub struct AcpProcess {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: PendingMap,
    next_id: AtomicU64,
    child: Arc<Mutex<Option<Child>>>,
}

fn pick_permission_option(params: &Value, allow: bool) -> String {
    let want_prefixes: &[&str] = if allow {
        &["allow_once", "allow-once", "allow_always", "allow-always", "allow"]
    } else {
        &["reject_once", "reject-once", "reject_always", "reject-always", "reject", "deny"]
    };
    if let Some(options) = params.get("options").and_then(|v| v.as_array()) {
        for want in want_prefixes {
            for opt in options {
                if let Some(k) = opt.get("kind").and_then(|v| v.as_str()) {
                    if k.eq_ignore_ascii_case(want) {
                        if let Some(id) = opt.get("optionId").and_then(|v| v.as_str()) {
                            return id.to_string();
                        }
                    }
                }
            }
        }
        for want in want_prefixes {
            for opt in options {
                if let Some(id) = opt.get("optionId").and_then(|v| v.as_str()) {
                    if id.to_ascii_lowercase().starts_with(&want.to_ascii_lowercase()) {
                        return id.to_string();
                    }
                }
            }
        }
    }
    if allow { "allow-once".to_string() } else { "reject-once".to_string() }
}

fn check_path_access(
    path: &str,
    allowed_paths: &SharedList,
    allowed_dirs: &SharedList,
) -> Result<std::path::PathBuf, String> {
    validate_path(path)?;
    let canonical = std::fs::canonicalize(path).map_err(|_| "Invalid file path".to_string())?;
    let canonical_str = canonical.to_string_lossy().to_string();

    {
        let guard = allowed_paths.lock().unwrap_or_else(|e| e.into_inner());
        if guard.contains(&canonical_str) {
            return Ok(canonical);
        }
    }
    {
        let guard = allowed_dirs.lock().unwrap_or_else(|e| e.into_inner());
        if guard.iter().any(|d| canonical.starts_with(Path::new(d))) {
            return Ok(canonical);
        }
    }
    Err("Access denied: path not whitelisted".to_string())
}

fn resolve_write_target(
    path: &str,
    allowed_paths: &SharedList,
    allowed_dirs: &SharedList,
) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    validate_path(path)?;
    if let Ok(canonical) = check_path_access(path, allowed_paths, allowed_dirs) {
        let parent = canonical
            .parent()
            .ok_or_else(|| "Invalid file path".to_string())?
            .to_path_buf();
        return Ok((canonical, parent));
    }
    let p = Path::new(path);
    let parent = p.parent().ok_or_else(|| "Invalid file path".to_string())?;
    let filename = p.file_name().ok_or_else(|| "Invalid file name".to_string())?;
    let canonical_parent =
        std::fs::canonicalize(parent).map_err(|_| "Parent directory does not exist".to_string())?;
    let dir_ok = {
        let guard = allowed_dirs.lock().unwrap_or_else(|e| e.into_inner());
        guard.iter().any(|d| canonical_parent.starts_with(Path::new(d)))
    };
    if !dir_ok {
        return Err("Access denied: parent directory not whitelisted".to_string());
    }
    Ok((canonical_parent.join(filename), canonical_parent))
}

fn acp_write_file(
    path: &str,
    content: &str,
    allowed_paths: &SharedList,
    allowed_dirs: &SharedList,
) -> Result<(), String> {
    let (target, canonical_parent) = resolve_write_target(path, allowed_paths, allowed_dirs)?;
    std::fs::write(&target, content).map_err(|e| format!("Failed to write file: {}", e))?;
    let final_canonical = match std::fs::canonicalize(&target) {
        Ok(p) => p,
        Err(e) => {
            let _ = std::fs::remove_file(&target);
            return Err(format!("Cannot resolve written file: {}", e));
        }
    };
    if validate_path(&final_canonical.to_string_lossy()).is_err()
        || !final_canonical.starts_with(&canonical_parent)
    {
        let _ = std::fs::remove_file(&target);
        return Err("Write rejected: symlink escape detected".to_string());
    }
    Ok(())
}

impl AcpProcess {
    pub async fn spawn(
        bin: &str,
        emitter: EventEmitter,
        allowed_paths: SharedList,
        allowed_dirs: SharedList,
    ) -> Result<Arc<Self>, String> {
        use tokio::process::Command;

        let mut cmd = Command::new(bin);
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::inherit());

        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        }
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn ACP process: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to capture ACP stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to capture ACP stdout")?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let acp = Arc::new(Self {
            stdin: Arc::new(Mutex::new(stdin)),
            pending: pending.clone(),
            next_id: AtomicU64::new(1),
            child: Arc::new(Mutex::new(Some(child))),
        });

        let pending_for_reader = pending.clone();
        let stdin_for_reader = acp.stdin.clone();
        let paths_for_reader = allowed_paths.clone();
        let dirs_for_reader = allowed_dirs.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if line.is_empty() {
                    continue;
                }
                let msg: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                    if msg.get("result").is_some() || msg.get("error").is_some() {
                        let mut map = pending_for_reader.lock().await;
                        if let Some(tx) = map.remove(&id) {
                            if let Some(err) = msg.get("error") {
                                let _ = tx.send(Err(err.clone()));
                            } else {
                                let _ = tx.send(Ok(msg.get("result").cloned().unwrap_or(Value::Null)));
                            }
                        }
                        continue;
                    }
                }

                if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
                    let params = msg.get("params").cloned().unwrap_or(Value::Null);
                    match method {
                        "session/update" => {
                            emitter.emit("acp:session-update", params);
                        }
                        "session/request_permission" => {
                            if let Some(id) = msg.get("id") {
                                emitter.emit(
                                    "acp:permission-request",
                                    serde_json::json!({ "requestId": id, "params": params }),
                                );
                                let kind = params
                                    .pointer("/toolCall/kind")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let safe_kind = matches!(kind, "read" | "edit" | "think" | "search");
                                let option_id = pick_permission_option(&params, safe_kind);
                                let response = serde_json::json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "result": {
                                        "outcome": { "outcome": "selected", "optionId": option_id }
                                    }
                                });
                                let mut data = serde_json::to_string(&response).unwrap();
                                data.push('\n');
                                let mut w = stdin_for_reader.lock().await;
                                let _ = w.write_all(data.as_bytes()).await;
                                let _ = w.flush().await;
                            }
                        }
                        "fs/read_text_file" => {
                            if let Some(id) = msg.get("id") {
                                let path = params.get("path").and_then(|p| p.as_str()).unwrap_or("");
                                let response = match check_path_access(path, &paths_for_reader, &dirs_for_reader) {
                                    Ok(canonical) => match std::fs::read_to_string(&canonical) {
                                        Ok(content) => serde_json::json!({
                                            "jsonrpc": "2.0", "id": id,
                                            "result": { "content": content }
                                        }),
                                        Err(e) => serde_json::json!({
                                            "jsonrpc": "2.0", "id": id,
                                            "error": { "code": -32603, "message": format!("Cannot read file: {}", e) }
                                        }),
                                    },
                                    Err(m) => serde_json::json!({
                                        "jsonrpc": "2.0", "id": id,
                                        "error": { "code": -32602, "message": m }
                                    }),
                                };
                                let mut data = serde_json::to_string(&response).unwrap();
                                data.push('\n');
                                let mut w = stdin_for_reader.lock().await;
                                let _ = w.write_all(data.as_bytes()).await;
                                let _ = w.flush().await;
                            }
                        }
                        "fs/write_text_file" => {
                            if let Some(id) = msg.get("id") {
                                let path = params.get("path").and_then(|p| p.as_str()).unwrap_or("");
                                let content = params.get("content").and_then(|c| c.as_str()).unwrap_or("");
                                let response = match acp_write_file(path, content, &paths_for_reader, &dirs_for_reader) {
                                    Ok(()) => serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
                                    Err(m) => serde_json::json!({
                                        "jsonrpc": "2.0", "id": id,
                                        "error": { "code": -32602, "message": m }
                                    }),
                                };
                                let mut data = serde_json::to_string(&response).unwrap();
                                data.push('\n');
                                let mut w = stdin_for_reader.lock().await;
                                let _ = w.write_all(data.as_bytes()).await;
                                let _ = w.flush().await;
                            }
                        }
                        _ => {
                            if let Some(id) = msg.get("id") {
                                let response = serde_json::json!({
                                    "jsonrpc": "2.0", "id": id,
                                    "error": { "code": -32601, "message": format!("Method not found: {}", method) }
                                });
                                let mut data = serde_json::to_string(&response).unwrap();
                                data.push('\n');
                                let mut w = stdin_for_reader.lock().await;
                                let _ = w.write_all(data.as_bytes()).await;
                                let _ = w.flush().await;
                            }
                        }
                    }
                }
            }
        });

        Ok(acp)
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let msg = serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }
        let mut data = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        data.push('\n');
        {
            let mut w = self.stdin.lock().await;
            w.write_all(data.as_bytes()).await.map_err(|e| format!("ACP write error: {}", e))?;
            w.flush().await.map_err(|e| format!("ACP flush error: {}", e))?;
        }
        match rx.await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(err)) => Err(format!(
                "ACP error: {}",
                err.get("message").and_then(|m| m.as_str()).unwrap_or("unknown")
            )),
            Err(_) => Err("ACP response channel closed".to_string()),
        }
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let msg = serde_json::json!({ "jsonrpc": "2.0", "method": method, "params": params });
        let mut data = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        data.push('\n');
        let mut w = self.stdin.lock().await;
        w.write_all(data.as_bytes()).await.map_err(|e| format!("ACP write error: {}", e))?;
        w.flush().await.map_err(|e| format!("ACP flush error: {}", e))?;
        Ok(())
    }

    pub async fn kill(&self) {
        let mut guard = self.child.lock().await;
        if let Some(ref mut child) = *guard {
            let _ = child.kill().await;
        }
        *guard = None;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AcpAdapter {
    Claude,
    Codex,
}

impl AcpAdapter {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
    pub fn from_str(v: &str) -> Result<Self, String> {
        match v {
            "claude" => Ok(Self::Claude),
            "codex" => Ok(Self::Codex),
            _ => Err(format!("Unsupported ACP adapter: {}", v)),
        }
    }
    pub fn candidate_bin_names(self) -> &'static [&'static str] {
        match self {
            Self::Claude => &["claude-agent-acp"],
            Self::Codex => &["codex-acp", "codex-agent-acp"],
        }
    }
}

pub struct AcpState {
    pub process: Mutex<Option<Arc<AcpProcess>>>,
    pub adapter: Mutex<AcpAdapter>,
}

impl AcpState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            adapter: Mutex::new(AcpAdapter::Claude),
        }
    }
}

pub fn resolve_acp_bin(adapter: AcpAdapter) -> Result<String, String> {
    let bin_names = adapter.candidate_bin_names();
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        for b in bin_names {
            candidates.push(cwd.join("node_modules/.bin").join(b));
        }
        if let Some(parent) = cwd.parent() {
            for b in bin_names {
                candidates.push(parent.join("node_modules/.bin").join(b));
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for b in bin_names {
                candidates.push(dir.join("../Resources/node_modules/.bin").join(b));
                candidates.push(dir.join("node_modules/.bin").join(b));
            }
        }
    }
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    if let Some(project_root) = std::path::Path::new(manifest_dir).parent() {
        for b in bin_names {
            candidates.push(project_root.join("node_modules/.bin").join(b));
        }
    }

    for c in &candidates {
        if c.exists() {
            return Ok(c.to_string_lossy().to_string());
        }
    }
    Err(format!("ACP binary not found for {}", adapter.as_str()))
}

pub async fn ensure_acp(
    state: &AcpState,
    emitter: EventEmitter,
    allowed_paths: SharedList,
    allowed_dirs: SharedList,
) -> Result<Arc<AcpProcess>, String> {
    let adapter = *state.adapter.lock().await;
    let mut guard = state.process.lock().await;
    if let Some(ref acp) = *guard {
        return Ok(Arc::clone(acp));
    }
    let bin = resolve_acp_bin(adapter)?;
    let acp = AcpProcess::spawn(&bin, emitter, allowed_paths, allowed_dirs).await?;
    *guard = Some(Arc::clone(&acp));
    Ok(acp)
}
