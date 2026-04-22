// Synchronous dispatch wrappers for the 11 acp_* IPC commands.
// Each runs the underlying async op on a shared current-thread tokio runtime.

use std::future::Future;
use std::sync::Arc;

use serde_json::Value;
use tokio::runtime::Handle;

use crate::acp::{ensure_acp, AcpAdapter, AcpState};
use crate::commands::AppState;
use crate::events::EventEmitter;

pub struct AcpCtx {
    pub state: Arc<AcpState>,
    pub handle: Handle,
    pub version: String,
}

impl AcpCtx {
    pub fn new(version: String) -> Self {
        // Run a dedicated current-thread tokio runtime on a background thread.
        // The thread blocks on an infinite future so tokio::spawn from ACP
        // reader tasks keeps firing indefinitely. Main-thread commands submit
        // work via `handle.spawn(...)` and block on a oneshot channel.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name("acp-rt".into())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_io()
                    .enable_time()
                    .build()
                    .expect("tokio runtime");
                tx.send(rt.handle().clone()).ok();
                rt.block_on(std::future::pending::<()>());
            })
            .expect("spawn acp-rt");
        let handle = rx.recv().expect("tokio handle");
        Self { state: Arc::new(AcpState::new()), handle, version }
    }

    fn run<F, T>(&self, fut: F) -> T
    where
        F: Future<Output = T> + Send + 'static,
        T: Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::channel();
        self.handle.spawn(async move {
            let _ = tx.send(fut.await);
        });
        rx.recv().expect("tokio task panicked")
    }
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key).and_then(|v| v.as_str()).ok_or_else(|| format!("missing arg: {}", key))
}

pub fn get_adapter(ctx: &AcpCtx) -> Result<Value, String> {
    let state = ctx.state.clone();
    let adapter = ctx.run(async move { *state.adapter.lock().await });
    Ok(Value::from(adapter.as_str()))
}

pub fn set_adapter(ctx: &AcpCtx, args: &Value) -> Result<Value, String> {
    let next = AcpAdapter::from_str(arg_str(args, "adapter")?)?;
    let state = ctx.state.clone();
    ctx.run(async move {
        let mut adapter_guard = state.adapter.lock().await;
        if *adapter_guard != next {
            *adapter_guard = next;
            let mut process_guard = state.process.lock().await;
            if let Some(acp) = process_guard.take() {
                acp.kill().await;
            }
        }
    });
    Ok(Value::from(next.as_str()))
}

pub fn initialize(ctx: &AcpCtx, app: &AppState, emitter: &EventEmitter) -> Result<Value, String> {
    let state = ctx.state.clone();
    let ap = app.allowed_paths.clone();
    let ad = app.allowed_dirs.clone();
    let em = emitter.clone();
    let version = ctx.version.clone();
    ctx.run(async move {
        let acp = ensure_acp(&state, em, ap, ad).await?;
        acp.request(
            "initialize",
            serde_json::json!({
                "protocolVersion": 1,
                "clientInfo": { "name": "mdeditor", "title": "mdeditor", "version": version },
                "clientCapabilities": {
                    "fs": { "readTextFile": true, "writeTextFile": true }
                }
            }),
        )
        .await
    })
}

pub fn new_session(
    ctx: &AcpCtx,
    app: &AppState,
    emitter: &EventEmitter,
    args: &Value,
) -> Result<Value, String> {
    let cwd = arg_str(args, "cwd")?.to_string();
    let state = ctx.state.clone();
    let ap = app.allowed_paths.clone();
    let ad = app.allowed_dirs.clone();
    let em = emitter.clone();
    ctx.run(async move {
        let acp = ensure_acp(&state, em, ap, ad).await?;
        acp.request("session/new", serde_json::json!({ "cwd": cwd, "mcpServers": [] }))
            .await
    })
}

pub fn prompt(
    ctx: &AcpCtx,
    app: &AppState,
    emitter: &EventEmitter,
    args: &Value,
) -> Result<Value, String> {
    let session_id = arg_str(args, "sessionId")?.to_string();
    let prompt = arg_str(args, "prompt")?.to_string();
    let state = ctx.state.clone();
    let ap = app.allowed_paths.clone();
    let ad = app.allowed_dirs.clone();
    let em = emitter.clone();
    ctx.run(async move {
        let acp = ensure_acp(&state, em, ap, ad).await?;
        acp.request(
            "session/prompt",
            serde_json::json!({
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": prompt }]
            }),
        )
        .await
    })
}

pub fn cancel(
    ctx: &AcpCtx,
    app: &AppState,
    emitter: &EventEmitter,
    args: &Value,
) -> Result<Value, String> {
    let session_id = arg_str(args, "sessionId")?.to_string();
    let state = ctx.state.clone();
    let ap = app.allowed_paths.clone();
    let ad = app.allowed_dirs.clone();
    let em = emitter.clone();
    ctx.run(async move {
        let acp = ensure_acp(&state, em, ap, ad).await?;
        acp.notify("session/cancel", serde_json::json!({ "sessionId": session_id })).await?;
        Ok(Value::Null)
    })
}

pub fn set_model(
    ctx: &AcpCtx,
    app: &AppState,
    emitter: &EventEmitter,
    args: &Value,
) -> Result<Value, String> {
    let session_id = arg_str(args, "sessionId")?.to_string();
    let model_id = arg_str(args, "modelId")?.to_string();
    let state = ctx.state.clone();
    let ap = app.allowed_paths.clone();
    let ad = app.allowed_dirs.clone();
    let em = emitter.clone();
    ctx.run(async move {
        let acp = ensure_acp(&state, em, ap, ad).await?;
        acp.request(
            "session/set_model",
            serde_json::json!({ "sessionId": session_id, "modelId": model_id }),
        )
        .await
    })
}

pub fn set_config(
    ctx: &AcpCtx,
    app: &AppState,
    emitter: &EventEmitter,
    args: &Value,
) -> Result<Value, String> {
    let session_id = arg_str(args, "sessionId")?.to_string();
    let config_id = arg_str(args, "configId")?.to_string();
    let value = arg_str(args, "value")?.to_string();
    let state = ctx.state.clone();
    let ap = app.allowed_paths.clone();
    let ad = app.allowed_dirs.clone();
    let em = emitter.clone();
    ctx.run(async move {
        let acp = ensure_acp(&state, em, ap, ad).await?;
        acp.request(
            "session/set_config_option",
            serde_json::json!({ "sessionId": session_id, "configId": config_id, "value": value }),
        )
        .await
    })
}

pub fn list_sessions(
    ctx: &AcpCtx,
    app: &AppState,
    emitter: &EventEmitter,
    args: &Value,
) -> Result<Value, String> {
    let cwd = args.get("cwd").and_then(|v| v.as_str()).map(|s| s.to_string());
    let state = ctx.state.clone();
    let ap = app.allowed_paths.clone();
    let ad = app.allowed_dirs.clone();
    let em = emitter.clone();
    ctx.run(async move {
        let acp = ensure_acp(&state, em, ap, ad).await?;
        acp.request("session/list", serde_json::json!({ "cwd": cwd })).await
    })
}

pub fn resume_session(
    ctx: &AcpCtx,
    app: &AppState,
    emitter: &EventEmitter,
    args: &Value,
) -> Result<Value, String> {
    let session_id = arg_str(args, "sessionId")?.to_string();
    let cwd = arg_str(args, "cwd")?.to_string();
    let state = ctx.state.clone();
    let ap = app.allowed_paths.clone();
    let ad = app.allowed_dirs.clone();
    let em = emitter.clone();
    ctx.run(async move {
        let acp = ensure_acp(&state, em, ap, ad).await?;
        acp.request(
            "session/resume",
            serde_json::json!({ "sessionId": session_id, "cwd": cwd, "mcpServers": [] }),
        )
        .await
    })
}

pub fn shutdown(ctx: &AcpCtx) -> Result<Value, String> {
    let state = ctx.state.clone();
    ctx.run(async move {
        let mut guard = state.process.lock().await;
        if let Some(acp) = guard.take() {
            acp.kill().await;
        }
    });
    Ok(Value::Null)
}
