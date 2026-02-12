# mdeditor

[Tauri v2](https://v2.tauri.app/) で構築された軽量Markdownエディタ。高速・セキュア・ネイティブ動作。

[English](README.md)

## 特徴

- **リアルタイム分割プレビュー** — スクロール同期付き
- **Mermaidダイアグラム描画** — フローチャート、シーケンス図、ER図など
- **シンタックスハイライト** — JS, TS, Python, Rust, Bash, JSON, CSS, HTML, XML, YAML, INI/TOML 等11言語以上
- **設定ファイルビューア** — `.env`, `.yaml`, `.ini`, `.toml`, `.properties` など
- **キーボードショートカット** — Cmd/Ctrl+O（開く）、Cmd/Ctrl+S（保存）
- **ダークテーマ** — Catppuccin Mocha 風
- **GFM**（GitHub Flavored Markdown）対応

## パフォーマンス

| 項目 | mdeditor | Electron系エディタ |
|------|----------|-------------------|
| アプリサイズ | 約3 MB | 150+ MB |
| DMGサイズ | 約1.7 MB | 80+ MB |
| メモリ使用量 | 約30-50 MB | 200+ MB |
| 起動時間 | 瞬時 | 2-5秒 |

## セキュリティ

- **DOMPurify** — レンダリングHTMLのXSS対策
- **Content Security Policy (CSP)** — リソース読み込みの制限
- **AllowedPathsホワイトリスト** — ネイティブダイアログで選択されたファイルのみアクセス可能
- **パス検証** — システムディレクトリのブロックとパスの正規化
- **10MBファイルサイズ制限** — 読み込み・書き込み双方に適用

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| バックエンド | Tauri v2 (Rust) |
| フロントエンド | TypeScript, Vite 7 |
| エディタ | CodeMirror 6 |
| レンダリング | marked, highlight.js, mermaid |
| サニタイズ | DOMPurify |

## 対応プラットフォーム

- macOS (Apple Silicon / Intel)
- Linux (Ubuntu 22.04+)
- Windows

## はじめに

### 前提条件

- [Node.js](https://nodejs.org/) 22以上
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- プラットフォーム固有の依存パッケージ: [Tauriの前提条件](https://v2.tauri.app/start/prerequisites/) を参照

### 開発

```bash
npm install
npm run tauri dev
```

### プロダクションビルド

```bash
npm run tauri build
```

リリースビルドではLTO、シンボルストリップ、単一コード生成ユニット、サイズ最適化により最小のバイナリサイズを実現しています。

## CI/CD

GitHub Actionsワークフローがバージョンタグ（`v*`）のプッシュで起動し、macOS (aarch64 + x86_64)、Ubuntu、Windows向けにビルドを生成します。全アクションはコミットSHAにピン留めされ、npm auditチェックも含まれています。

## ライセンス

[MIT](LICENSE)
