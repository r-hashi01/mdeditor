# Security Policy

## Supported versions

Only the latest `0.x` release line is supported. Security fixes will be
released as a new `0.x.y` version and published to the
[Releases page](https://github.com/r-hashi01/mdeditor/releases).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive reports.

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/r-hashi01/mdeditor/security)
2. Click **Report a vulnerability**

Include, if possible:

- A description of the issue and its impact
- Steps to reproduce (a minimal proof-of-concept is ideal)
- Affected version(s) / commit SHA
- Your assessment of severity

You can expect an initial acknowledgement within **7 days**. We aim to ship a
fix within **30 days** for high-severity issues, and will credit reporters in
the release notes unless you ask otherwise.

## Scope

In scope:

- The Tauri Rust backend (`src-tauri/`) — path sandbox, IPC command surface,
  ACP fs handlers, PTY binary resolution, auto-updater signature verification
- The TypeScript frontend (`src/`) — Markdown / Marp / CSV / HTML rendering,
  DOMPurify sanitization, CSP / iframe sandboxing
- Release-signing pipeline (`.github/workflows/release.yml`) and the embedded
  updater public key

Out of scope:

- Vulnerabilities in the `claude` / `codex` CLIs themselves (report upstream)
- Issues that require an already-compromised local user account (mdeditor
  trusts its own process; the sandbox protects against hostile *content*,
  not a hostile operator)
- Social-engineering attacks against the user to open a malicious folder
  (we warn on folder open; full isolation is not a goal of this editor)

## Security model summary

See the **Security model** section of [`README.md`](README.md#security-model)
for the current hardening posture.
