# kumihan

GitHub Codespaces 上で Markdown 原稿を編集し、Hono が組版済み HTML を生成してブラウザで確認するための開発環境です。

個人または小規模な執筆・組版作業を対象にした v0.1 です。VS Code Extension、CMS、データベース、独自デプロイ基盤は含みません。

ツールチェーンは [Vite+](https://viteplus.dev/)（`vp`）と [Bun](https://bun.sh/) です。CI は GitHub Actions で、`actionlint` と `zizmor` がワークフローを検査し、Semgrep・Gitleaks・`bun audit` がセキュリティ検査を行います。テストカバレッジは `src/**` に対して 95% 以上を要求します。

```
VS Code
  │
  │ edit
  ▼
content/index.md
  │
  ├───────────────┐
  │               │
  ▼               ▼
Hono Preview              Static Export
  │                         │
  ├ /            1段組      ├ dist/index.html
  ├ /magazine.html 2段組    ├ dist/magazine.html
  └ /web.html      Web      ├ dist/web.html
                            └ dist/assets/*
                                  │
                                  ▼
                             GitHub Pages
```

## 使い方

前提:

```bash
# Vite+（vp）
curl -fsSL https://vite.plus | bash

# Bun 1.4.0（vp が packageManager から入れる場合もあります）
curl -fsSL https://bun.sh/install | bash
```

### GitHub Codespaces

1. このリポジトリを Codespaces で開く
2. Dev Container が Bun と Vite+ を用意し、`vp install --frozen-lockfile` を実行する
3. ターミナルで `bun run dev` を実行する
4. Forwarded Port `3000`（Typeset Preview）をブラウザで開く
5. `content/index.md` を編集して保存し、ブラウザを再読み込みする

### ローカル

```bash
vp install
bun run dev
```

http://127.0.0.1:3000 を開きます。

### ベンチマーク

組版パイプラインの処理時間を計測します。

```bash
bun run bench                          # 既定は 50 回 × 40 倍の原稿
bun run bench -- --iterations 300 --scale 100
```

`content/index.md` を `--scale` 倍に増幅した原稿を使い、`escapeHtml` /
`renderInline` / `renderMarkdown` / `renderDocument` の中央値・最小値・
スループットを表示します。

### スタンドアロン実行ファイル

[Releases](https://github.com/watany-dev/kumihan/releases) からバイナリを落とすか、`bun run compile` で今のマシン向けに作ります。`v*.*.*` タグで全 OS 分が Release に載ります。

```bash
curl -fsSL -o kumihan \
  https://github.com/watany-dev/kumihan/releases/latest/download/kumihan-linux-x64
chmod +x kumihan
./kumihan serve manuscript.md
./kumihan export manuscript.md --out dist
```

`bun run compile -- --all` で Linux / macOS / Windows 向けを `dist-bin/` に出します。macOS で隔離されるときは `xattr -d com.apple.quarantine kumihan-darwin-arm64`。既定は `127.0.0.1:3000`、Codespaces では `--host 0.0.0.0`。

## コマンド

| コマンド                   | 内容                                           |
| -------------------------- | ---------------------------------------------- |
| `bun run dev`              | Preview server を起動する                      |
| `bun run compile`          | 今の OS 向けスタンドアロン実行ファイルを作る   |
| `bun run compile -- --all` | Linux / macOS / Windows 向けバイナリを作る     |
| `vp check`                 | フォーマット・lint（警告もエラー）・型チェック |
| `vp test`                  | parser / renderer / HTTP のテスト              |
| `vp test --coverage`       | 同上。`src/**` のカバレッジ 95% を要求する     |
| `bun run export`           | `dist/*.html` と CSS を生成する                |
| `bun audit`                | 依存関係の脆弱性を検査する                     |

`vp fmt` / `vp lint` で個別にも実行できます。Oxlint は `correctness` と `suspicious` を error、`perf` を warn とし、`denyWarnings` で警告も CI を失敗させます。eval・`javascript:` URL・import cycle などのセキュリティ規則は個別に error です。Oxfmt は `printWidth: 100`、単一引用符、セミコロンなし、import 整列を強制します。

## HTTP

| 経路                      | 内容                                            |
| ------------------------- | ----------------------------------------------- |
| `GET /`                   | `content/index.md` を読み、A4 1段組 HTML を返す |
| `GET /magazine.html`      | 同じ原稿を A4 2段組で返す                       |
| `GET /magazine`           | `/magazine.html` と同じ                         |
| `GET /web.html`           | 同じ原稿を Web 記事スタイルで返す               |
| `GET /web`                | `/web.html` と同じ Web 記事ビュー               |
| `GET /health`             | `{ "ok": true }`                                |
| `GET /assets/typeset.css` | 組版 CSS（1段 / 2段）                           |
| `GET /assets/web.css`     | Web 記事 CSS                                    |

`GET /` は毎回ファイルを読み直し、`Cache-Control: no-store` で返します。v0.1 の live reload はブラウザの手動更新です。

すべての応答に Content-Security-Policy（`script-src 'none'`）、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、Permissions-Policy を付けます。静的 HTML にも同じ CSP を `<meta>` で埋めます。

原稿が無い場合は分かりやすい 404 HTML を返します。読み込み失敗時は 500 を返し、stack trace はブラウザへ出しません。

## Markdown

初期版で扱う原稿は `content/index.md` のみです。履歴は Git に任せます。

対応:

- `#` / `##` / `###` 見出し
- 段落
- `**bold**` / `*emphasis*` / `` `inline code` ``
- `[link](https://example.com)`
- `>` 引用
- `-` 箇条書き / `1.` 番号付きリスト
- `---` 水平線
- フェンス付きコードブロック

非対応: raw HTML、入れ子リスト、table、footnote、task list、image、MDX、frontmatter、syntax highlighting。

HTML は必ず escape します。リンクは `https:` / `http:` / `mailto:` / 相対 URL / `#fragment` のみ許可し、`javascript:` などは安全な値へ置き換えます。

日本語の soft line break では不要な半角空白を入れません。行末2スペースは明示的な改行です。

## 組版

Preview の既定表示は A4 の1段組です。本文は明朝、見出しはゴシック、code は等幅です。印刷時は `@page { size: A4; }` を使います。

`/magazine.html` は同じ原稿をページ内の縦2列にします。見出し・リード・コードは全幅、本文が2段です。切り替えは右上（Web ではヘッダー）の表示モードから行い、JavaScript は使いません。

## Web 記事

`/web.html` は同じ Markdown を、技術メディアの Web 記事に近い画面組で表示します。本文はゴシック、見出しにアクセント、画面幅に合わせた読み幅です。

参考にした画面の骨格は [CodeZine の記事ページ](https://codezine.jp/article/detail/23908) です。ロゴやナビは複製せず、読み幅・ゴシック本文・左アクセントの見出しなど記事本文の組だけを取り入れています。

Web 側に editor textarea はありません。編集は VS Code で行います。

## 静的書き出しと GitHub Pages

Preview と公開版は同じ `renderMarkdown()` / `renderDocument()` を使います。

```bash
bun run export
```

生成物:

```
dist/
├─ index.html
├─ magazine.html
├─ web.html
└─ assets/
   ├─ typeset.css
   └─ web.css
```

`main` への push で GitHub Actions が `vp install --frozen-lockfile` → `vp test` → `vp run export` → GitHub Pages へ deploy します。リポジトリの Pages 設定は **GitHub Actions** を選んでください。バージョンタグ（`v0.1.0` など）では、同じ検査のあと `bun build --compile` でスタンドアロン実行ファイルを GitHub Release に載せます。

CI ではこれに加えて `vp check`、カバレッジ 95%、`actionlint`、`zizmor` を実行します。セキュリティ用ワークフローは Semgrep、Gitleaks、`bun audit` を weekly でも回します。GitHub Actions はコミット SHA にピン留めし、Dependabot が週次で更新します。脆弱性の報告手順は [SECURITY.md](SECURITY.md) を見てください。

## Public API

renderer は Hono と Node filesystem から独立しています。

```ts
import { renderMarkdown } from './src/markdown/render.ts'
import { renderDocument } from './src/typesetting/render-page.ts'
import { exportSite } from './src/export/export-site.ts'
import { createPreviewApp } from './src/app.ts'

const fragment = renderMarkdown(markdown)
const document = renderDocument(fragment)
const magazine = renderDocument(fragment, { mode: 'magazine' })
const webDocument = renderDocument(fragment, { mode: 'web' })
const assets = exportSite(markdown)
const app = createPreviewApp({
  source: './content/index.md',
})
```

将来 VS Code Extension から Webview 表示する場合も、同じ renderer を再利用する想定です。
