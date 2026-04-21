## [0.4.0] - 2026-04-21

### Added
- AI pane: embedded chat for `claude` / `codex` via Agent Client Protocol (ACP),
  plus a PTY mode for the native CLI UIs (`Cmd/Ctrl+J`)
- File-tree sidebar with folder memory (recent folders, auto-reopen)
- Multi-tab editing with dirty-state tracking and `Cmd/Ctrl+W`
- Marp slide renderer (frontmatter-driven, `default` / `gaia` / `uncover`
  themes, scoped `<style>` sanitiser)
- draw.io (`.drawio`) inline SVG rendering
- CSV / TSV table viewer with quoted-field parsing
- PDF and DOCX inline preview (via native WebKit / mammoth.js)
- Table-editor dialog, image paste / drag-and-drop, bash / Dockerfile syntax
- Settings modal redesign with 10 built-in themes and font / layout controls
- Auto-updater with minisign-signed artifacts and menu entry
  "Check for Updates…"
- Vitest frontend test suite and Rust unit tests on the security boundary

### Changed
- **Breaking (internal)**: `AllowedPaths` / `AllowedDirs` now wrap
  `Arc<Mutex<…>>` so the ACP reader can share them with Tauri commands
- Version is now sourced from `package.json` only; `tauri.conf.json` references
  it and `src-tauri/Cargo.toml` uses a placeholder

### Security
- **ACP fs handlers are now sandboxed**: `fs/read_text_file` and
  `fs/write_text_file` requests from the agent are validated against the same
  whitelist as Tauri commands. Unauthorised paths are rejected before any
  I/O — previously the agent could read or write any file the mdeditor
  process had access to, including `~/.ssh/*` and `~/.aws/credentials`
- **ACP write targets are re-canonicalised** after the write to catch
  symlink-based escapes of the allowed directory; offending files are
  removed and an error is returned
- **ACP permission auto-approve restricted**: tool-call kinds other than
  `read` / `edit` / `think` / `search` (notably shell `execute`) are now
  denied by default. Every permission request is also emitted as an
  `acp:permission-request` event for UI hook-up
- **ACP binary resolution no longer consults `$PATH`**: only project-relative
  / bundled `node_modules/.bin` candidates are trusted, preventing PATH
  hijacking via a compromised shell profile
- **PTY binary resolution** now searches a fixed list of trusted install
  directories (Homebrew, `/usr/local/bin`, `~/.cargo/bin`, `~/.bun/bin`, …)
  and passes a sanitised `PATH` to the child
- **HTML preview iframe** drops `allow-scripts` from the sandbox and its
  injected CSP sets `script-src 'none'` — viewing hostile `.html` cannot
  execute JS
- **Blocked path components expanded** with `.git`, `.npmrc`, `.netrc` to
  protect repo-local credentials
- **File reads now use `File::take(MAX_FILE_SIZE + 1)`** so a file that
  grows between the metadata check and the read cannot bypass the 10 MB cap
- **`write_file_binary` re-canonicalises after write** and verifies the
  final path stays within the canonical parent directory
- **`save_settings` validates JSON shape** and filters `recentFolders` /
  `lastOpenedFolder` entries through `validate_path`, blocking the path
  that would otherwise let a compromised frontend smuggle blocked paths
  into settings and reopen them via `reopen_dir`

## [0.3.0] - 2026-04-17

### Added
- Settings modal with appearance customization
- Auto-updater via `tauri-plugin-updater`
- Signed release artifacts (minisign)

## [0.2.0]

### Added
- Mermaid diagram rendering
- Config file viewing
- Initial security hardening (path validation, atomic writes)
- README (English / Japanese), MIT LICENSE

## [0.1.0]

### Added
- Initial release: lightweight Markdown editor built on Tauri v2
