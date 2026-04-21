//! ACP (Agent Client Protocol) client implementation.
//!
//! Spawns `claude-agent-acp` (or `codex-acp`) as a child process and communicates
//! via ndjson over stdin/stdout following JSON-RPC 2.0.

use crate::{validate_path_pub, SharedPathList};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex};

/// Tracks pending JSON-RPC requests awaiting a response.
type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, Value>>>>>;

pub struct AcpProcess {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: PendingMap,
    next_id: AtomicU64,
    child: Arc<Mutex<Option<Child>>>,
}

/// Pick a permission option from a `session/request_permission` params object.
/// If `allow` is true, prefer an allow-once-like option; otherwise prefer a
/// reject-once-like option. Falls back to "reject" / the literal option id if
/// the expected kinds aren't present, so the agent always receives a usable
/// optionId and the request is never left hanging.
fn pick_permission_option(params: &Value, allow: bool) -> String {
    let want_prefixes: &[&str] = if allow {
        &[
            "allow_once",
            "allow-once",
            "allow_always",
            "allow-always",
            "allow",
        ]
    } else {
        &[
            "reject_once",
            "reject-once",
            "reject_always",
            "reject-always",
            "reject",
            "deny",
        ]
    };
    if let Some(options) = params.get("options").and_then(|v| v.as_array()) {
        // Match by `kind` first — ACP spec field.
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
        // Then by optionId prefix match.
        for want in want_prefixes {
            for opt in options {
                if let Some(id) = opt.get("optionId").and_then(|v| v.as_str()) {
                    if id
                        .to_ascii_lowercase()
                        .starts_with(&want.to_ascii_lowercase())
                    {
                        return id.to_string();
                    }
                }
            }
        }
    }
    // Last resort: a plausible literal.
    if allow {
        "allow-once".to_string()
    } else {
        "reject-once".to_string()
    }
}

/// Resolve `path` against the client's allowed-file and allowed-dir whitelists.
/// Mirrors `is_path_allowed` in lib.rs but operates on the shared `Arc<Mutex>`
/// state (accessible from the async reader task).
fn check_path_access(
    path: &str,
    allowed_paths: &SharedPathList,
    allowed_dirs: &SharedPathList,
) -> Result<std::path::PathBuf, String> {
    validate_path_pub(path)?;
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

/// Resolve a write target that may not yet exist. Returns the absolute path
/// that should be written to, and the canonical parent directory (used for the
/// post-write symlink-escape check).
fn resolve_write_target(
    path: &str,
    allowed_paths: &SharedPathList,
    allowed_dirs: &SharedPathList,
) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    validate_path_pub(path)?;
    // Fast-path: file already exists and is already whitelisted.
    if let Ok(canonical) = check_path_access(path, allowed_paths, allowed_dirs) {
        let parent = canonical
            .parent()
            .ok_or_else(|| "Invalid file path".to_string())?
            .to_path_buf();
        return Ok((canonical, parent));
    }
    // Otherwise: the parent directory must be whitelisted.
    let p = Path::new(path);
    let parent = p.parent().ok_or_else(|| "Invalid file path".to_string())?;
    let filename = p
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;
    let canonical_parent =
        std::fs::canonicalize(parent).map_err(|_| "Parent directory does not exist".to_string())?;
    let dir_ok = {
        let guard = allowed_dirs.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .iter()
            .any(|d| canonical_parent.starts_with(Path::new(d)))
    };
    if !dir_ok {
        return Err("Access denied: parent directory not whitelisted".to_string());
    }
    Ok((canonical_parent.join(filename), canonical_parent))
}

/// Safely perform the ACP write: validates the target, writes, then
/// canonicalises the final path to catch symlinks that would escape the
/// parent directory. On escape, the file is removed and an error is returned.
fn acp_write_file(
    path: &str,
    content: &str,
    allowed_paths: &SharedPathList,
    allowed_dirs: &SharedPathList,
) -> Result<(), String> {
    let (target, canonical_parent) = resolve_write_target(path, allowed_paths, allowed_dirs)?;
    std::fs::write(&target, content).map_err(|e| format!("Failed to write file: {}", e))?;
    // Re-canonicalise after write: if `filename` turned out to be a symlink
    // escaping `canonical_parent`, reject and clean up.
    let final_canonical = match std::fs::canonicalize(&target) {
        Ok(p) => p,
        Err(e) => {
            let _ = std::fs::remove_file(&target);
            return Err(format!("Cannot resolve written file: {}", e));
        }
    };
    if validate_path_pub(&final_canonical.to_string_lossy()).is_err()
        || !final_canonical.starts_with(&canonical_parent)
    {
        let _ = std::fs::remove_file(&target);
        return Err("Write rejected: symlink escape detected".to_string());
    }
    Ok(())
}

impl AcpProcess {
    /// Spawn the ACP server process and start the reader loop.
    ///
    /// `allowed_paths` / `allowed_dirs` are the same whitelists populated by
    /// the native file/folder dialogs — the reader enforces them on every
    /// `fs/read_text_file` and `fs/write_text_file` request so the agent
    /// cannot coerce us into reading/writing arbitrary files on disk.
    pub async fn spawn(
        bin: &str,
        app: AppHandle,
        allowed_paths: SharedPathList,
        allowed_dirs: SharedPathList,
    ) -> Result<Arc<Self>, String> {
        use tokio::process::Command;

        let mut cmd = Command::new(bin);
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::inherit());

        // Forward PATH / HOME so the child can find `claude` / `codex`
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

        // Reader loop — reads ndjson lines from stdout
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

                // Is this a response to one of our requests?
                if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                    if msg.get("result").is_some() || msg.get("error").is_some() {
                        let mut map = pending_for_reader.lock().await;
                        if let Some(tx) = map.remove(&id) {
                            if let Some(err) = msg.get("error") {
                                let _ = tx.send(Err(err.clone()));
                            } else {
                                let _ =
                                    tx.send(Ok(msg.get("result").cloned().unwrap_or(Value::Null)));
                            }
                        }
                        continue;
                    }
                }

                // Is this a notification from the agent? (no id, has method)
                if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
                    let params = msg.get("params").cloned().unwrap_or(Value::Null);
                    match method {
                        "session/update" => {
                            let _ = app.emit("acp:session-update", &params);
                        }
                        "session/request_permission" => {
                            // Policy:
                            //   • fs-related tool kinds ("read" / "edit") — the
                            //     actual I/O routes through fs/read_text_file
                            //     or fs/write_text_file which are allow-listed
                            //     above, so auto-allow is safe.
                            //   • all other kinds (notably "execute" for shell
                            //     commands, "delete", "move", "fetch") — deny
                            //     by default. The UI can upgrade this later
                            //     by listening to the `acp:permission-request`
                            //     event and responding through a dedicated
                            //     command.
                            if let Some(id) = msg.get("id") {
                                let _ = app.emit(
                                    "acp:permission-request",
                                    serde_json::json!({
                                        "requestId": id,
                                        "params": params,
                                    }),
                                );
                                let kind = params
                                    .pointer("/toolCall/kind")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let safe_kind =
                                    matches!(kind, "read" | "edit" | "think" | "search");
                                let option_id = pick_permission_option(&params, safe_kind);
                                let response = serde_json::json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "result": {
                                        "outcome": {
                                            "outcome": "selected",
                                            "optionId": option_id
                                        }
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
                            // Read file for the agent — validated against the
                            // user's allow-lists. Unauthorised paths return an
                            // error instead of leaking file contents.
                            if let Some(id) = msg.get("id") {
                                let path =
                                    params.get("path").and_then(|p| p.as_str()).unwrap_or("");
                                let response = match check_path_access(
                                    path,
                                    &paths_for_reader,
                                    &dirs_for_reader,
                                ) {
                                    Ok(canonical) => match std::fs::read_to_string(&canonical) {
                                        Ok(content) => serde_json::json!({
                                            "jsonrpc": "2.0",
                                            "id": id,
                                            "result": { "content": content }
                                        }),
                                        Err(e) => serde_json::json!({
                                            "jsonrpc": "2.0",
                                            "id": id,
                                            "error": {
                                                "code": -32603,
                                                "message": format!("Cannot read file: {}", e)
                                            }
                                        }),
                                    },
                                    Err(msg) => serde_json::json!({
                                        "jsonrpc": "2.0",
                                        "id": id,
                                        "error": { "code": -32602, "message": msg }
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
                            // Write file for the agent — validated against the
                            // user's allow-lists. Unauthorised paths are
                            // rejected before any write occurs.
                            if let Some(id) = msg.get("id") {
                                let path =
                                    params.get("path").and_then(|p| p.as_str()).unwrap_or("");
                                let content =
                                    params.get("content").and_then(|c| c.as_str()).unwrap_or("");
                                let response = match acp_write_file(
                                    path,
                                    content,
                                    &paths_for_reader,
                                    &dirs_for_reader,
                                ) {
                                    Ok(()) => serde_json::json!({
                                        "jsonrpc": "2.0",
                                        "id": id,
                                        "result": {}
                                    }),
                                    Err(msg) => serde_json::json!({
                                        "jsonrpc": "2.0",
                                        "id": id,
                                        "error": { "code": -32602, "message": msg }
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
                            // Unknown request from agent — respond with method not found
                            if let Some(id) = msg.get("id") {
                                let response = serde_json::json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "error": {
                                        "code": -32601,
                                        "message": format!("Method not found: {}", method)
                                    }
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

    /// Send a JSON-RPC request and wait for the response.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        let mut data = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        data.push('\n');
        {
            let mut w = self.stdin.lock().await;
            w.write_all(data.as_bytes())
                .await
                .map_err(|e| format!("ACP write error: {}", e))?;
            w.flush()
                .await
                .map_err(|e| format!("ACP flush error: {}", e))?;
        }

        match rx.await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(err)) => Err(format!(
                "ACP error: {}",
                err.get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown")
            )),
            Err(_) => Err("ACP response channel closed".to_string()),
        }
    }

    /// Send a JSON-RPC notification (no response expected).
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });

        let mut data = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        data.push('\n');
        let mut w = self.stdin.lock().await;
        w.write_all(data.as_bytes())
            .await
            .map_err(|e| format!("ACP write error: {}", e))?;
        w.flush()
            .await
            .map_err(|e| format!("ACP flush error: {}", e))?;
        Ok(())
    }

    /// Kill the ACP process.
    pub async fn kill(&self) {
        let mut guard = self.child.lock().await;
        if let Some(ref mut child) = *guard {
            let _ = child.kill().await;
        }
        *guard = None;
    }
}
