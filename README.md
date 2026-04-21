# mdeditor

A fast, native Markdown editor built with [Tauri v2](https://v2.tauri.app/).
Real-time preview, Marp slides, draw.io diagrams, and a sandboxed file-access
model — in a ~3 MB app bundle.

[日本語版はこちら](README.ja.md)

![mdeditor screenshot](docs/screenshot.png)

## Features

### Editor

- **Split-pane live preview** with synchronized scrolling (code / split / preview modes)
- **Tabs** with dirty-state tracking, `Cmd/Ctrl+W` to close
- **File tree sidebar** with folder memory (reopen recent folders on startup)
- **Search / replace** (`Cmd/Ctrl+F`, `Cmd/Ctrl+H`)
- **Table editor** — dialog-driven insert with column count, headers, alignment
- **Image paste / drag-and-drop** — saved into an `images/` subfolder of the open document
- **Markdown-aware syntax highlighting** via CodeMirror 6 — Markdown, JS/TS, Python, Rust, Bash, JSON, CSS, HTML, XML, YAML, SQL, Dockerfile
- **Table of contents** auto-generated from `h1–h3`, smooth-scroll navigation
- **Configurable appearance** — 10 built-in themes (Catppuccin, GitHub, Dracula, Nord, Tokyo Night, Rosé Pine, Solarized…), editor / preview font family and size, line height, line numbers, TOC visibility
- **AI pane** (`Cmd/Ctrl+J`) — run the `claude` or `codex` CLI inside an embedded PTY terminal, rooted at the open folder. Claude and Codex live in separate tabs; sessions restart automatically when you switch folders

### Rendering

- **GFM Markdown** via `marked` + **XSS sanitization** via DOMPurify
- **Mermaid** diagrams (flowchart, sequence, ER, Gantt, class, state, pie, and more)
- **Marp** presentations — slide-aware frontmatter, per-slide scoped directives, built-in `default` / `gaia` / `uncover` themes, `<style>`-escape & `@import` blocking
- **draw.io** (`.drawio`) — inline SVG rendering of `mxGraphModel` (rect / ellipse / rhombus / edges / text) without an external runtime
- **CSV / TSV** viewer with quoted-field parsing
- **SVG / HTML / PDF / DOCX / images** preview
- **Code block syntax highlighting** in the preview via highlight.js

### Desktop integration

- **Keyboard shortcuts** — `Cmd/Ctrl+O` open file, `Cmd/Ctrl+Shift+O` open folder, `Cmd/Ctrl+S` save, `Cmd/Ctrl+W` close tab, `Cmd/Ctrl+B` toggle file tree, `Cmd/Ctrl+J` toggle AI pane, `Cmd+1…9` open recent folder
- **Native macOS menu** (About / Check for Updates / Edit / Hide…)
- **Auto-updater** — background check on launch and manual "Check for Updates" from menu / settings
- **Remembers** last opened folder, recent folders, window position, theme, font settings

## Security model

- All filesystem access is **sandboxed** through a Rust-side whitelist. Only paths
  chosen by the user via a native open/save dialog — or inside a user-selected
  folder — are readable or writable
- **System directory blocking**: `/etc`, `/var`, `/usr`, `/sys`, `/proc`, `/bin`,
  `/sbin`, `/boot`, macOS `/private/*` symlinks and `/Library`; sensitive
  components anywhere in the path (`.ssh`, `.gnupg`, `.aws`, `.kube`, `.docker`,
  `.config/gcloud`, `Keychains`, `.git`, `.npmrc`, `.netrc`) are rejected —
  case-insensitively and after canonicalization to defeat symlink bypass
- **Atomic writes** via temp-file-then-rename (per-PID + nanosecond suffix) so a
  crash mid-save can never leave a half-written file on disk
- **10 MB read / write size cap** on every IPC command, enforced with bounded
  reads (`File::take`) to defeat TOCTOU grow-after-check
- **CSP** restricts scripts to `'self'`, only permits `data:` images and fonts,
  and blocks third-party `connect-src` other than Tauri's own IPC channel
- **HTML previews** render inside a fully-sandboxed iframe (no `allow-scripts`)
  with a `script-src 'none'` CSP — viewing a hostile `.html` cannot execute JS
- **DOMPurify** sanitizes every Markdown / Marp / CSV HTML output before it
  reaches the DOM
- **AI pane (ACP)** — the `fs/read_text_file` and `fs/write_text_file` requests
  coming from `claude-agent-acp` / `codex-acp` are validated against the same
  whitelist as IPC commands, so the agent cannot coerce mdeditor into reading
  `~/.ssh/*` or writing outside the opened folder. Write targets are
  re-canonicalised after the write to catch symlink escapes. Tool-permission
  requests for anything other than read/edit (notably shell `execute`) are
  denied by default
- **AI pane PTY** is restricted to a fixed allowlist of tool names
  (`claude`, `codex`); the binary is resolved from a fixed list of trusted
  install dirs (Homebrew, `/usr/local/bin`, `~/.cargo/bin`, …) rather than
  `$PATH`, so an attacker-controlled shell profile cannot substitute a
  rogue binary. The spawned CLI still runs as your user — treat its
  commands with the same trust you'd give it in a normal terminal
- **Auto-updater** uses minisign-signed artifacts; the embedded public key
  rejects unsigned or tampered release bundles

## Supported platforms

- macOS (Apple Silicon / Intel)
- Linux (Ubuntu 22.04+, other distros likely work with `libwebkit2gtk-4.1`)
- Windows

## Installation

Pre-built binaries are published on every `v*` tag at the
[Releases page](https://github.com/r-hashi01/mdeditor/releases).

## Development

### Prerequisites

- [Bun](https://bun.sh/) (package manager + test runner)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Platform-specific Tauri prerequisites —
  [tauri.app docs](https://v2.tauri.app/start/prerequisites/)

### Common tasks

```bash
bun install            # install frontend deps
bun run tauri dev      # launch the Tauri desktop app (Rust + WebView)
bun run dev            # frontend-only dev server (http://localhost:5173)
bun run build          # production frontend build
bun run tauri build    # bundle a release installer for the current platform
bun run clean          # remove dist/ and Rust build artifacts
```

### Tests

```bash
bun run test                  # Vitest — frontend unit tests
bun run test:watch            # Vitest watch mode
cd src-tauri && cargo test    # Rust unit tests (path validation, atomic write)
```

Frontend tests use Vitest with happy-dom; they cover the pure rendering /
sanitization logic (Marp, CSV, draw.io, settings validator, HTML escaping).
Rust tests focus on the security boundary (`validate_path`,
`has_blocked_component`, `starts_with_any`, `atomic_write`).

## Project structure

```
src/                 TypeScript frontend
  main.ts            entry point — wires editor, preview, tabs, file tree
  editor.ts          CodeMirror 6 setup and language switching
  preview.ts         Markdown / Marp / CSV / image / PDF / DOCX rendering
  marp-renderer.ts   Marp-compatible slide renderer (no @marp-team deps)
  drawio-renderer.ts .drawio XML → inline SVG
  csv-renderer.ts    CSV / TSV → HTML table
  file-tree.ts       sidebar file tree
  tab-manager.ts     multi-tab state management
  fileio.ts          open / save commands (invoke IPC)
  folder-io.ts       folder open / reopen (AllowedDirs whitelist)
  image-handler.ts   paste / drop image → write to images/
  table-editor.ts    markdown table insert dialog
  settings.ts        persisted user settings + sanitizer
  settings-modal.ts  settings UI
  themes.ts          CodeMirror + highlight.js theme presets
  update-checker.ts  manual + auto update flow
  welcome.ts         welcome screen / recent folders

  ai-pane.ts         embedded PTY terminal for `claude` / `codex` CLIs (xterm.js)

src-tauri/src/lib.rs Rust backend — IPC commands, path whitelist, atomic writes, PTY sessions
```

## Versioning

The user-facing version lives in a single place: **`package.json`**.
`src-tauri/tauri.conf.json` references it via `"version": "../package.json"`,
and the Rust layer reads it at runtime through `AppHandle::package_info()`.
The crate-level `src-tauri/Cargo.toml` version is a placeholder (`0.0.0`) and
is not displayed anywhere.

To cut a release, bump the version in `package.json` and tag `v<version>`.

## CI

- **`test.yml`** — runs on every push to `main` and every PR.
  Two parallel jobs: Vitest (frontend) + `cargo test --lib` (Rust).
- **`release.yml`** — runs on `v*` tags, builds macOS (aarch64 + x86_64),
  Ubuntu, Windows installers and publishes them as a GitHub Release.
  All third-party actions are pinned to commit SHAs.

## Tech stack

| Layer         | Technology |
|---------------|-----------|
| Backend       | Tauri v2, Rust |
| Frontend      | TypeScript, Vite 7 |
| Editor        | CodeMirror 6 |
| Preview       | marked, highlight.js, DOMPurify |
| Diagrams      | mermaid, custom draw.io / Marp renderers |
| Documents     | mammoth (DOCX) |
| Package / test | Bun, Vitest (happy-dom), cargo test |

## License

[MIT](LICENSE)
