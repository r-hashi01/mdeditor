# mdeditor

[![Test](https://github.com/r-hashi01/mdeditor/actions/workflows/test.yml/badge.svg)](https://github.com/r-hashi01/mdeditor/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/r-hashi01/mdeditor?sort=semver)](https://github.com/r-hashi01/mdeditor/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)](#対応プラットフォーム)
[Tauri v2](https://v2.tauri.app/) で構築された、高速でネイティブな Markdown エディタ。

- **軽量** — macOS / Windows / Debian 向けインストーラは 4〜5 MB 前後。起動は 1 秒未満。
- **サンドボックス** — すべてのファイル I/O は Rust 側のホワイトリスト検査を通過。`/etc`, `.ssh`, `.aws` などシステム / シークレット領域はブロック。
- **AI ネイティブ** — `claude` / `codex` CLI を埋め込み PTY ターミナルで開いているフォルダを cwd として実行。エディタから離れる必要なし。

[English](README.md) · [変更履歴](CHANGELOG.md) · [アーキテクチャ](docs/ARCHITECTURE.md) · [セキュリティポリシー](SECURITY.md) · [コントリビュート](CONTRIBUTING.md)

## スクリーンショット

| | |
|---|---|
| ![Welcome 画面](docs/screenshots/mdeditor-home.png) | ![エディタとプレビュー](docs/screenshots/mdeditor-editor.png) |
| ![プレビュー専用](docs/screenshots/mdeditor-preview.png) | ![AI ペイン](docs/screenshots/mdeditor-ai-pane.png) |

## 特徴

### エディタ

- **分割ペインのリアルタイムプレビュー**（スクロール同期、code / split / preview 切替）
- **タブ機能** — 変更マーカー付き、`Cmd/Ctrl+W` で閉じる
- **ファイルツリーサイドバー** — フォルダ記憶（起動時に最近開いたフォルダを再オープン）
- **検索 / 置換** — `Cmd/Ctrl+F`、`Cmd/Ctrl+H`
- **テーブルエディタ** — 列数・ヘッダー・アライメントを指定して挿入
- **画像の貼り付け / ドラッグ&ドロップ** — 開いているドキュメントの `images/` サブフォルダに保存
- **シンタックスハイライト**（CodeMirror 6）— Markdown, JS/TS, Python, Rust, Bash, JSON, CSS, HTML, XML, YAML, SQL, Dockerfile
- **目次（TOC）自動生成** — `h1–h3`、スムーズスクロールで見出しへ移動
- **外観カスタマイズ** — 10 種類の組み込みテーマ（Catppuccin、GitHub、Dracula、Nord、Tokyo Night、Rosé Pine、Solarized…）、エディタ / プレビューのフォントファミリ・サイズ、行間、行番号、TOC 表示
- **AI ペイン**（`Cmd/Ctrl+J`）— 開いているフォルダを cwd として `claude` / `codex` CLI を埋め込み PTY ターミナルで起動。Claude と Codex はタブで切り替え、フォルダを切り替えるとセッションは自動で再起動
- **AI コンテキスト添付** — クリップボタンから Files & Directories / 現在の選択範囲 / プロジェクト Rules / 画像 を次のプロンプトに添付（Zed / Cursor 風）。送信前にチップで内容を確認可能

### レンダリング

- **GFM Markdown**（`marked`）+ **DOMPurify** による XSS サニタイズ
- **Mermaid** 図（flowchart / sequence / ER / Gantt / class / state / pie ほか）
- **Marp** プレゼン — スライド単位の frontmatter、スコープ付きディレクティブ、`default` / `gaia` / `uncover` 組み込みテーマ、`</style>` エスケープ / `@import` ブロック
- **draw.io** (`.drawio`) — `mxGraphModel` を外部ランタイム無しでインライン SVG 描画（rect / ellipse / rhombus / edges / text）
- **CSV / TSV** ビューア — クォート付きフィールド対応
- **SVG / HTML / PDF / DOCX / 画像** のプレビュー。Marp / HTML / PDF で統一された下部ズームバー（`-` / `+` / パーセント表示）
- **Marp の PDF 書き出し目安ライン** — 各スライドに破線の 16:9 カットラインを表示し、PDF 出力時に切れる位置を可視化
- **コードブロック**のシンタックスハイライト（highlight.js）

### デスクトップ統合

- **キーボードショートカット** — `Cmd/Ctrl+O` ファイルを開く、`Cmd/Ctrl+Shift+O` フォルダを開く、`Cmd/Ctrl+S` 保存、`Cmd/Ctrl+W` タブを閉じる、`Cmd/Ctrl+B` ファイルツリーの開閉、`Cmd/Ctrl+J` AI ペインの開閉、`Cmd+1…9` 最近のフォルダを開く
- **macOS ネイティブメニュー**（About / Check for Updates / Edit / Hide…）
- **自動アップデータ** — 起動時バックグラウンドチェック、メニュー / 設定から手動確認。minisign 署名済みアーティファクトのみ受理
- **状態の永続化** — 最後のフォルダ、最近のフォルダ、ウィンドウ位置、テーマ、フォント設定

## 対応プラットフォーム

| OS | インストーラ | サイズ |
|---|---|---|
| macOS (Apple Silicon) | `.dmg`, `.app.tar.gz` | 約 4.5 MB |
| macOS (Intel) | `.dmg`, `.app.tar.gz` | 約 4.7 MB |
| Windows x64 | `.exe` NSIS / `.msi` | 3.8〜4.7 MB |
| Debian / Ubuntu (22.04+) | `.deb` | 約 4.6 MB |
| その他 Linux | `.AppImage`（依存同梱で約 82 MB）, `.rpm` | — |

他のディストロでも `libwebkit2gtk-4.1` が入っていれば動作する見込みです。

## インストール

### ユーザー向け

`v*` タグごとのビルド済みバイナリは [Releases ページ](https://github.com/r-hashi01/mdeditor/releases) で配布しています。ご自身のプラットフォームに合うアーティファクトを選んでください。

#### macOS

本アプリは **notarize されていません**（OSS プロジェクトで有償の Developer 証明書を持っていないため）。初回起動時に Gatekeeper が開くのを拒否するので、右クリック → **開く** → ダイアログで **開く**、または次のコマンドを一度実行してください:

```bash
xattr -dr com.apple.quarantine /Applications/mdeditor.app
```

自動アップデートは minisign 署名済みアーティファクトのみ受理します。

#### Linux

`.deb` / `.rpm` はシステム全体にインストール。`.AppImage` はポータブル — `chmod +x` して実行。GTK + WebKit2GTK 4.1 が必要です。

#### Windows

多くのユーザーには `.exe` (NSIS) を推奨。`.msi` は管理された環境向け。

### 開発者向け

ソースから動かす場合は [Bun](https://bun.sh/)、[Rust](https://www.rust-lang.org/tools/install)、およびプラットフォーム固有の [Tauri 前提条件](https://v2.tauri.app/start/prerequisites/) を入れてから、次を実行してください:

```bash
bun install
bun run tauri dev
```

ブラウザ側だけ確認したい場合は `bun run dev` を使えます。

## セキュリティモデル

mdeditor は、悪意のある Markdown / HTML / Marp ドキュメントを開いてもシークレットファイルを読み出せず、ユーザーが選択したフォルダから脱出できないように設計されています。主な防御:

- **パスサンドボックス** — すべての IPC コマンドは、ネイティブの開く / 保存ダイアログで構築されたインメモリのホワイトリストに対してパスを検証します。システムディレクトリ（`/etc`, `/var`, `/usr`, `/sys`, `/Library`）およびパス中のシークレットコンポーネント（`.ssh`, `.gnupg`, `.aws`, `.kube`, `.docker`, `Keychains` ほか）は、canonicalize 後に大文字小文字を区別せず検査し、シンボリックリンクバイパスを防ぎます。
- **アトミック書き込み**（一時ファイル + rename、PID + ナノ秒サフィックス）— クラッシュしても書きかけのファイルが残らない。
- **サイズ上限** — 全 IPC コマンドで 10 MB の読み書きシーリング。`File::take` による境界付き読み込みで TOCTOU grow-after-check を防止。
- **厳格な CSP** — スクリプトは `'self'`、画像 / フォントは `data:` のみ、外部への `connect-src` は Tauri の IPC チャネル以外ブロック。
- **HTML プレビュー iframe** — 完全サンドボックス（`allow-scripts` 無し）+ `script-src 'none'` CSP。悪意のある `.html` を開いても JS は実行されません。
- **DOMPurify** がすべての Markdown / Marp / CSV HTML 出力を DOM 反映前にサニタイズ。
- **AI ペイン（ACP）** — `claude-agent-acp` / `codex-acp` からの `fs/read_text_file` / `fs/write_text_file` 要求は IPC コマンドと同じホワイトリストで検証。シェル `execute` などのツール権限要求はデフォルトで拒否。書き込み先は書き込み後に再 canonicalize してシンボリックリンクエスケープを検出。
- **PTY アローリスト** — `claude` / `codex` バイナリのみ spawn 可能。信頼済みのインストール先（Homebrew, `/usr/local/bin`, `~/.cargo/bin`, …）からのみ解決し、`$PATH` は参照しません。
- **署名付き自動更新** — ビルド時に minisign 公開鍵を埋め込み、改ざんされた更新を拒否。

完全な脅威モデルと報告ポリシーは [SECURITY.md](SECURITY.md) を参照してください。

## 開発

### 前提条件

- [Bun](https://bun.sh/)（パッケージマネージャ兼テストランナー）
- [Rust](https://www.rust-lang.org/tools/install)（stable）
- プラットフォーム固有の Tauri 前提条件 — [tauri.app のドキュメント](https://v2.tauri.app/start/prerequisites/)

### よく使うコマンド

```bash
bun install            # フロントエンド依存のインストール
bun run tauri dev      # Tauri デスクトップアプリを起動（Rust + WebView）
bun run dev            # フロントエンドのみの dev サーバ (http://localhost:5173)
bun run build          # プロダクション用フロントエンドビルド
bun run tauri build    # プラットフォーム向けリリースインストーラを生成
bun run clean          # dist/ と Rust ビルド成果物を削除
```

### テスト

```bash
bun run test                  # Vitest — フロントエンドのユニットテスト
bun run test:watch            # Vitest ウォッチモード
cd src-tauri && cargo test    # Rust ユニットテスト（パス検証 / アトミック書き込み）
```

フロントエンドテストは Vitest + happy-dom で、純粋なレンダリング / サニタイズロジック（Marp, CSV, draw.io, 設定バリデータ, HTML エスケープ）を検証します。Rust テストはセキュリティ境界（`validate_path`, `has_blocked_component`, `starts_with_any`, `atomic_write`）をカバーしています。

### プロジェクト構成

Rust / TypeScript の境界、パスサンドボックス、ACP AI ペインパイプラインの解説は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## バージョニング

ユーザーに見えるバージョンは **`package.json`** の 1 箇所のみ。`src-tauri/tauri.conf.json` は `"version": "../package.json"` で参照し、Rust レイヤは実行時に `AppHandle::package_info()` 経由で読み込みます。`src-tauri/Cargo.toml` のクレートバージョンはプレースホルダ（`0.0.0`）でどこにも表示されません。

リリースは `package.json` のバージョンを上げて `v<version>` タグを打つだけ — 残りは `release.yml` が処理します。

## CI

- **`test.yml`** — `main` への push と PR で実行。並列 2 ジョブ（Vitest フロントエンド + `cargo test --lib` Rust、matrix: Ubuntu + macOS）
- **`release.yml`** — `v*` タグで実行、macOS (aarch64 + x86_64) / Ubuntu / Windows のインストーラをビルドし GitHub Release に公開。サードパーティアクションはすべてコミット SHA で pin 済み

## ロードマップ

- 新しいファイル種別が増えてもサンドボックス / ACP / PTY 境界を保ち続ける。
- 大きめのフォルダや複合メディア文書でのプレビュー体験をさらに磨く。
- 配布物とリリース手順の予測可能性を維持して、公開バイナリを信頼しやすくする。

## 技術スタック

| レイヤ           | 技術 |
|-----------------|------|
| バックエンド      | Tauri v2, Rust |
| フロントエンド    | TypeScript, Vite 7 |
| エディタ         | CodeMirror 6 |
| プレビュー       | marked, highlight.js, DOMPurify |
| 図表             | mermaid, 独自 draw.io / Marp レンダラ |
| ドキュメント     | mammoth (DOCX) |
| パッケージ / テスト | Bun, Vitest (happy-dom), cargo test |

## コントリビュート

Issue / Discussion / PR を歓迎します。セットアップ手順・コミット規約・PR チェックリストは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。参加者は [Code of Conduct](CODE_OF_CONDUCT.md) に同意したものとみなされます。

セキュリティ脆弱性の報告は公開 Issue を開かず、[SECURITY.md](SECURITY.md) の手順に従ってください。

## ライセンス

[MIT](LICENSE)
