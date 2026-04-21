# mdeditor — Claude Code Guidelines

## Quick Start

```bash
bun install           # install frontend deps
bun run dev           # Vite dev server (http://localhost:5173)
bun run tauri dev     # launch Tauri desktop app (compiles Rust + opens WebView)
bun run build         # production frontend build
bun run tauri build   # production desktop app bundle
bun run clean         # remove dist/ and Rust build artifacts
```

## Key Gotchas

- **WebKit on macOS**: Tauri uses WebKit, not Chromium. CSS scoping from `style-mod` (CodeMirror) doesn't work — use inline `style` attributes via `Decoration.mark({ attributes: { style: "..." } })` with CSS custom properties (`var(--syn-*)`)
- **CodeMirror decorations**: Prefer `StateField` over `ViewPlugin` for decorations (more reliable in WebKit). Use `Prec.highest` to override markdown parser styling
- **Security model**: Rust backend tracks allowed paths — all file I/O must go through `validate_path()` + `is_path_allowed()` / `is_dir_allowed()`
- **Tests**: `bun run test` (Vitest + happy-dom, frontend pure logic) and `cd src-tauri && cargo test --lib` (Rust path-sandbox / atomic-write). CI runs both.

## Conventions

- Semicolons everywhere, `import type` for type-only imports
- Commit style: `type(scope): description` (e.g., `feat:`, `fix(ci):`)
- Release: push `v*` tag → GitHub Actions builds all platforms

## Do NOT

- Edit `bun.lock` or `Cargo.lock` directly
- Weaken CSP in `tauri.conf.json` without explicit approval
- Remove path validation from Rust commands
