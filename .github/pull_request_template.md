## Summary

<!-- What does this PR change and why? Link issues with `Closes #n` if applicable. -->

## Changes

- 

## Testing

- [ ] `pnpm run test` passes
- [ ] `cd src-tauri && cargo test --lib` passes
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `cargo fmt --check` + `cargo clippy -D warnings` clean
- [ ] Manually verified in `pnpm run tauri dev` (describe below if UI-affecting)

<!-- Describe any manual verification steps, platforms tested, edge cases. -->

## Security-sensitive changes

<!-- Delete this section if none. Otherwise call out changes to: CSP, path allowlist / validate_path, ACP permissions, PTY allowlist, auto-update signing, IPC surface. -->

- [ ] No CSP / sandbox / allowlist weakening
- [ ] Any new IPC command validates every path argument

## Checklist

- [ ] Conventional Commit title (`feat:`, `fix(ci):`, …)
- [ ] CHANGELOG.md updated under `## [Unreleased]` for user-facing changes
- [ ] New pure logic has a Vitest or cargo unit test
- [ ] No direct edits to `pnpm-lock.yaml` or `Cargo.lock`
