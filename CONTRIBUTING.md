# Contributing to mdeditor

Thanks for your interest. Issues, discussions, and pull requests are welcome.
When filing issues or opening pull requests, please use the GitHub templates in `.github/` so reports stay consistent.

## Ground rules

- By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security vulnerabilities must **not** be filed as public issues. See [SECURITY.md](SECURITY.md) for the private reporting process.
- For non-trivial changes, open an issue or discussion first to align on approach before investing implementation effort.

## Development setup

Prerequisites: [Bun](https://bun.sh/), [Rust stable](https://www.rust-lang.org/tools/install), and the platform-specific [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

If your change touches the sandbox, ACP, or PTY boundary, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before you start.

```bash
bun install
bun run tauri dev      # launch the desktop app (compiles Rust + opens WebView)
bun run dev            # frontend-only dev server (http://localhost:5173)
```

## Running tests

Both suites must pass before a PR can merge:

```bash
bun run test                  # Vitest — frontend unit tests
cd src-tauri && cargo test --lib   # Rust unit tests
```

Also verify lint and format:

```bash
bun x tsc --noEmit
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings
```

These are the exact checks CI runs.

## Coding conventions

### TypeScript

- Semicolons everywhere.
- `import type` for type-only imports.
- Prefer pure functions in renderers / sanitizers — they are unit-testable with happy-dom.
- DOM output that includes user-controlled content must pass through DOMPurify.

### Rust

- `cargo fmt` + `cargo clippy` with `-D warnings` — no exceptions.
- All filesystem access from IPC commands must pass through `validate_path()` + `is_path_allowed()` / `is_dir_allowed()`. Do not add commands that take raw paths without validation.
- Atomic writes use the temp-file-then-rename helper. Do not write partial data to the final destination directly.

### WebKit gotcha

Tauri uses WebKit on macOS, not Chromium. CSS scoping from `style-mod` (CodeMirror) does not apply reliably. For CodeMirror decorations, use inline `style` attributes via `Decoration.mark({ attributes: { style: "…" } })` with CSS custom properties (`var(--syn-*)`), and prefer `StateField` over `ViewPlugin` with `Prec.highest`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

Optional longer body explaining why.
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `deps`, `perf`, `style`.

Examples from this repo:

```
feat: appearance customization, settings modal redesign, and auto-updater
fix(ci): update all invalid action SHA pins
deps(rust): Bump tokio from 1.49.0 to 1.52.1
```

## Pull request checklist

- [ ] Branch name is descriptive (`fix/update-checker-race`, `feat/marp-themes`).
- [ ] `bun run test` passes locally.
- [ ] `cd src-tauri && cargo test --lib` passes locally.
- [ ] `bun x tsc --noEmit` produces no errors.
- [ ] `cargo fmt --check` and `cargo clippy -D warnings` pass.
- [ ] New IPC commands validate every path argument against the sandbox.
- [ ] User-facing changes have a CHANGELOG.md entry under an `## [Unreleased]` section.
- [ ] Security-sensitive changes (CSP, path allowlist, ACP permissions, PTY allowlist) are called out explicitly in the PR description.
- [ ] New pure logic has a Vitest or cargo unit test.

CI runs the same checks on every PR — merge is gated on them being green.

## Do not

- Edit `bun.lock` or `Cargo.lock` manually — let the package managers regenerate them.
- Weaken the CSP in `tauri.conf.json` without prior agreement in an issue.
- Remove path validation or broaden the PTY allowlist without prior agreement.
- Bypass the pre-commit hooks (`--no-verify`) or signing (`--no-gpg-sign`) unless explicitly asked.

## Release process (maintainers)

1. Update `package.json` version.
2. Add a `CHANGELOG.md` entry dated today.
3. Commit, tag `v<version>`, push both. `release.yml` builds and publishes the GitHub Release automatically.

The user-facing version lives only in `package.json`. `tauri.conf.json` references it via `"version": "../package.json"`; `src-tauri/Cargo.toml` remains `0.0.0`.

## Questions

Open a [Discussion](https://github.com/r-hashi01/mdeditor/discussions) for anything that does not fit an issue or PR.
