// mdeditor shell entrypoint. All the heavy lifting — window, IPC bridge,
// path sandbox, dialogs, PTY, ACP — lives in the `fude` crate. Here we
// just configure it and register the four app-specific commands for
// settings persistence, folder reopen, and the image scratch directory.

use std::fs;
use std::path::PathBuf;

use fude::{
    app_config_dir, atomic_write, ensure_scratch_dir, safe_lock, validate_path, AcpAdapterConfig,
    App, Ctx, FsState,
};
use serde_json::Value;

fn dist_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("missing arg: {}", key))
}

fn require_fs(ctx: &Ctx) -> Result<&std::sync::Arc<FsState>, String> {
    ctx.fs
        .as_ref()
        .ok_or_else(|| "fs sandbox not enabled".to_string())
}

fn reopen_dir(ctx: &Ctx, args: &Value) -> Result<Value, String> {
    let fs_state = require_fs(ctx)?;
    let path = arg_str(args, "path")?;
    validate_path(path)?;

    let settings_path = app_config_dir(&ctx.identifier)?.join("settings.json");
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
    let mut dirs = safe_lock(&fs_state.allowed_dirs);
    if !dirs.contains(&canonical) {
        dirs.push(canonical);
    }
    Ok(Value::Null)
}

fn get_image_temp_dir(ctx: &Ctx, _args: &Value) -> Result<Value, String> {
    let dir = ensure_scratch_dir(ctx, "temp-images")?;
    Ok(Value::from(dir.to_string_lossy().to_string()))
}

fn load_settings(ctx: &Ctx, _args: &Value) -> Result<Value, String> {
    let settings_path = app_config_dir(&ctx.identifier)?.join("settings.json");
    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Cannot read settings: {}", e))?;
        Ok(Value::from(content))
    } else {
        Ok(Value::from("{}"))
    }
}

fn save_settings(ctx: &Ctx, args: &Value) -> Result<Value, String> {
    let settings = arg_str(args, "settings")?;
    let mut parsed: Value =
        serde_json::from_str(settings).map_err(|e| format!("Invalid settings JSON: {}", e))?;
    if !parsed.is_object() {
        return Err("Settings must be a JSON object".to_string());
    }
    if let Some(obj) = parsed.as_object_mut() {
        if let Some(v) = obj.get_mut("recentFolders") {
            if let Some(arr) = v.as_array_mut() {
                arr.retain(|entry| entry.as_str().map(|s| validate_path(s).is_ok()).unwrap_or(false));
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
    let config_dir = app_config_dir(&ctx.identifier)?;
    fs::create_dir_all(&config_dir).map_err(|e| format!("Cannot create config dir: {}", e))?;
    atomic_write(&config_dir.join("settings.json"), sanitised.as_bytes())?;
    Ok(Value::Null)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    App::new("com.mdeditor.editor")
        .title("mdeditor (shell)")
        .assets(dist_root())
        .with_fs_sandbox()
        .with_dialogs()
        .with_pty(&["claude", "codex"])
        .with_acp(
            vec![
                AcpAdapterConfig {
                    name: "claude".into(),
                    candidate_bin_names: vec!["claude-agent-acp".into()],
                },
                AcpAdapterConfig {
                    name: "codex".into(),
                    candidate_bin_names: vec!["codex-acp".into(), "codex-agent-acp".into()],
                },
            ],
            "mdeditor",
            env!("CARGO_PKG_VERSION"),
        )
        .command("ping", |_ctx, _args| Ok(Value::from("pong")))
        .command("reopen_dir", reopen_dir)
        .command("get_image_temp_dir", get_image_temp_dir)
        .command("load_settings", load_settings)
        .command("save_settings", save_settings)
        .run()
}
