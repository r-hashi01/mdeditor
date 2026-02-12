# mdeditor

A lightweight Markdown editor built with [Tauri v2](https://v2.tauri.app/). Fast, secure, and native.

[日本語](README.ja.md)

## Features

- **Real-time split-pane preview** with synchronized scrolling
- **Mermaid diagram rendering** (flowcharts, sequence diagrams, ER diagrams, etc.)
- **Syntax highlighting** for 11+ languages (JS, TS, Python, Rust, Bash, JSON, CSS, HTML, XML, YAML, INI/TOML)
- **Config file viewer** for `.env`, `.yaml`, `.ini`, `.toml`, `.properties`, and more
- **Keyboard shortcuts**: Cmd/Ctrl+O (open), Cmd/Ctrl+S (save)
- **Dark theme** inspired by Catppuccin Mocha
- **GFM** (GitHub Flavored Markdown) support

## Performance

| Metric | mdeditor | Electron-based editors |
|--------|----------|----------------------|
| App size | ~3 MB | 150+ MB |
| DMG size | ~1.7 MB | 80+ MB |
| Memory | ~30-50 MB | 200+ MB |
| Startup | Instant | 2-5 seconds |

## Security

- **DOMPurify** for XSS prevention in rendered HTML
- **Content Security Policy (CSP)** restricting resource loading
- **AllowedPaths whitelist** — only files selected via native dialog are accessible
- **Path validation** with system directory blocking and canonicalization
- **10 MB file size limit** for read and write operations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Tauri v2 (Rust) |
| Frontend | TypeScript, Vite 7 |
| Editor | CodeMirror 6 |
| Rendering | marked, highlight.js, mermaid |
| Sanitization | DOMPurify |

## Supported Platforms

- macOS (Apple Silicon / Intel)
- Linux (Ubuntu 22.04+)
- Windows

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Platform-specific dependencies: see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
npm install
npm run tauri dev
```

### Production Build

```bash
npm run tauri build
```

Release builds use LTO, symbol stripping, single codegen unit, and size optimization for minimal binary size.

## CI/CD

The GitHub Actions workflow triggers on version tags (`v*`) and produces builds for macOS (aarch64 + x86_64), Ubuntu, and Windows. All actions are pinned to commit SHAs with an npm audit check included.

## License

[MIT](LICENSE)
