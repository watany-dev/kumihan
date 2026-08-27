# kumihan

GitHub Codespaces 上で Markdown 原稿を編集し、Hono が組版済み HTML を生成してブラウザで確認するための開発環境です。

個人または小規模な執筆・組版作業を対象にした v0.1 です。VS Code Extension、CMS、データベース、独自デプロイ基盤は含みません。

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
Hono Preview    Static Export
  │               │
  ▼               ▼
Browser       dist/index.html
                  │
                  ▼
             GitHub Pages
```

## 使い方

### GitHub Codespaces

1. このリポジトリを Codespaces で開く
2. Dev Container が Node.js を用意し、`npm install` を実行する
3. ターミナルで `npm run dev` を実行する
4. Forwarded Port `3000`（Typeset Preview）をブラウザで開く
5. `content/index.md` を編集して保存し、ブラウザを再読み込みする

### ローカル

```bash
npm install
npm run dev
```

http://127.0.0.1:3000 を開きます。

## npm scripts

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | Preview server を起動する |
| `npm run build` | TypeScript をビルドする |
| `npm run export` | `dist/index.html` と CSS を生成する |
| `npm test` | parser / renderer のテストを実行する |

## HTTP

| 経路 | 内容 |
| --- | --- |
| `GET /` | `content/index.md` を読み、組版 HTML を返す |
| `GET /health` | `{ "ok": true }` |
| `GET /assets/typeset.css` | 組版 CSS |

`GET /` は毎回ファイルを読み直し、`Cache-Control: no-store` で返します。v0.1 の live reload はブラウザの手動更新です。

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

Preview は A4 横幅の通常横書きです。本文は明朝、見出しはゴシック、code は等幅です。印刷時は `@page { size: A4; }` を使います。

Web 側に editor textarea はありません。編集は VS Code で行います。

## 静的書き出しと GitHub Pages

Preview と公開版は同じ `renderMarkdown()` / `renderDocument()` を使います。

```bash
npm run export
```

生成物:

```
dist/
├─ index.html
└─ assets/
   └─ typeset.css
```

`main` への push で GitHub Actions が `npm ci` → `npm run export` → GitHub Pages へ deploy します。リポジトリの Pages 設定は **GitHub Actions** を選んでください。

## Public API

renderer は Hono と Node filesystem から独立しています。

```ts
import { renderMarkdown } from './src/markdown/render.ts'
import { renderDocument } from './src/typesetting/render-page.ts'
import { exportSite } from './src/export/export-site.ts'
import { createPreviewApp } from './src/app.ts'

const fragment = renderMarkdown(markdown)
const document = renderDocument(fragment)
const assets = exportSite(markdown)
const app = createPreviewApp({
  source: './content/index.md',
})
```

将来 VS Code Extension から Webview 表示する場合も、同じ renderer を再利用する想定です。
