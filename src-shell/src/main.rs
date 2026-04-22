// Minimal wry + tao shell for mdeditor. No Tauri runtime.
//
// Exposes `window.__shell_ipc(cmd, args)` to the frontend and dispatches to
// the command fns in `commands.rs`. Path sandbox rules mirror
// `src-tauri/src/lib.rs` so the allow-list semantics are preserved.

mod commands;
mod dialogs;
mod sandbox;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::{http::Response, WebViewBuilder};

use commands::AppState;
use sandbox::new_list;

#[derive(Deserialize)]
struct IpcRequest {
    id: u64,
    cmd: String,
    #[serde(default)]
    args: serde_json::Value,
}

#[derive(Serialize)]
struct IpcResponse {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

enum UserEvent {
    IpcReply(String),
}

fn dispatch(state: &AppState, cmd: &str, args: &serde_json::Value) -> Result<serde_json::Value, String> {
    match cmd {
        "ping" => Ok(serde_json::json!("pong")),
        "allow_path" => commands::allow_path(state, args),
        "allow_dir" => commands::allow_dir(state, args),
        "reopen_dir" => commands::reopen_dir(state, args),
        "list_directory" => commands::list_directory(state, args),
        "read_file" => commands::read_file(state, args),
        "read_file_binary" => commands::read_file_binary(state, args),
        "write_file" => commands::write_file(state, args),
        "write_file_binary" => commands::write_file_binary(state, args),
        "ensure_dir" => commands::ensure_dir(state, args),
        "get_image_temp_dir" => commands::get_image_temp_dir(state, args),
        "load_settings" => commands::load_settings(state, args),
        "save_settings" => commands::save_settings(state, args),
        "dialog_open" => dialogs::open(args),
        "dialog_save" => dialogs::save(args),
        "dialog_ask" => dialogs::ask(args),
        "dialog_message" => dialogs::message(args),
        _ => Err(format!("unknown cmd: {cmd}")),
    }
}

fn dist_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
}

fn serve_asset(req_path: &str) -> Response<Vec<u8>> {
    let rel = req_path.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    let path = dist_dir().join(rel);
    let path = if path.is_dir() { path.join("index.html") } else { path };

    match std::fs::read(&path) {
        Ok(body) => Response::builder()
            .header("Content-Type", mime_for(&path))
            .header("Access-Control-Allow-Origin", "*")
            .body(body)
            .unwrap(),
        Err(_) => Response::builder()
            .status(404)
            .body(b"not found".to_vec())
            .unwrap(),
    }
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

const IPC_INIT: &str = r#"
window.__shell_ipc = (() => {
  let nextId = 1;
  const pending = new Map();
  window.__shell_on_reply = (payload) => {
    try {
      const msg = typeof payload === "string" ? JSON.parse(payload) : payload;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || "ipc error"));
    } catch (e) { console.error(e); }
  };
  return (cmd, args = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    window.ipc.postMessage(JSON.stringify({ id, cmd, args }));
  });
})();
"#;

fn main() -> wry::Result<()> {
    let state = std::sync::Arc::new(AppState {
        allowed_paths: new_list(),
        allowed_dirs: new_list(),
    });

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("mdeditor (shell poc)")
        .build(&event_loop)
        .unwrap();

    let state_for_ipc = state.clone();
    let webview = WebViewBuilder::new(&window)
        .with_url("asset://localhost/")
        .with_initialization_script(IPC_INIT)
        .with_custom_protocol("asset".into(), move |req| {
            serve_asset(req.uri().path()).map(|b| b.into())
        })
        .with_ipc_handler(move |req| {
            let body: &str = req.body();
            let parsed: Result<IpcRequest, _> = serde_json::from_str(body);
            let response = match parsed {
                Ok(r) => {
                    let (ok, result, error) = match dispatch(&state_for_ipc, &r.cmd, &r.args) {
                        Ok(v) => (true, Some(v), None),
                        Err(e) => (false, None, Some(e)),
                    };
                    IpcResponse { id: r.id, ok, result, error }
                }
                Err(e) => IpcResponse {
                    id: 0,
                    ok: false,
                    result: None,
                    error: Some(format!("bad ipc: {e}")),
                },
            };
            let json = serde_json::to_string(&response).unwrap_or_else(|_| "{}".into());
            let js = format!("window.__shell_on_reply({json})");
            let _ = proxy.send_event(UserEvent::IpcReply(js));
        })
        .build()?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *control_flow = ControlFlow::Exit,
            Event::UserEvent(UserEvent::IpcReply(js)) => {
                let _ = webview.evaluate_script(&js);
            }
            _ => {}
        }
    });
}
