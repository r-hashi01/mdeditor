# mdeditor-shell (experimental)

Minimal wry + tao shell to explore a lighter-than-Tauri desktop host.
Goal: cut the native binary from ~4.5 MB (Tauri, opt-level=z + fat LTO)
down toward ~1 MB by dropping the Tauri runtime, plugin system, command
macro layer, and updater.

## Current state (POC)

- Opens a tao window and loads `../dist` via an `asset://` custom protocol.
- Exposes `window.__shell_ipc(cmd, args) => Promise` over `window.ipc.postMessage`.
- Dispatches to a single-file match in `dispatch()`. Two demo commands: `ping`, `read_text_file`.
- Release binary: **~787 KB** (stripped, LTO fat, opt-level=z).

## Not yet ported from `src-tauri/`

- 30 `#[tauri::command]` handlers (path sandbox, atomic write, settings, image temp dir, …).
- Dialog (file picker, ask/message) — replace with `rfd` or a custom NSOpenPanel/GTK wrapper.
- Shell open (external URLs) — replace with `open` crate or `std::process::Command`.
- PTY / ACP bridge (`src-tauri/src/acp.rs`) — pull in `portable-pty` directly.
- Bundle/packaging pipeline (`.app`, `.dmg`, Windows MSI, AppImage).
- Updater — intentionally dropped.

## Run (dev, after `bun run build`)

```bash
cargo run --release
```

The shell reads the frontend from `../dist` at runtime; no bundling yet.
