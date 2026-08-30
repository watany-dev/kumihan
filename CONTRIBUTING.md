# 開発

ツールチェーンは [Vite+](https://viteplus.dev/)（`vp`）と [Bun](https://bun.sh/) 1.4.0 です。ユーザー向けの使い方は [README.md](README.md) にあります。

```bash
curl -fsSL https://vite.plus | bash
curl -fsSL https://bun.sh/install | bash
vp install
```

GitHub Codespaces と Dev Container は Bun と Vite+ を入れ、`vp install --frozen-lockfile` まで済ませます。

## コマンド

| コマンド                   | 内容                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `bun run dev`              | Preview server を起動する                                   |
| `bun run export`           | `dist/*.html` と CSS を生成する                             |
| `bun run compile`          | 今の OS 向けスタンドアロン実行ファイルを `dist-bin/` に出す |
| `bun run compile -- --all` | Linux / macOS / Windows 向けバイナリを出す                  |
| `vp check`                 | フォーマット・lint（警告もエラー）・型チェック              |
| `bun run knip`             | 未使用のファイル・export・依存関係を検出する                |
| `bun run test`             | ローカル向け。agent レポーターで成功時のログを抑える        |
| `vp test`                  | parser / renderer / HTTP のテストとファジング（CI と同じ）  |
| `vp test --coverage`       | 同上。`src/**` のカバレッジ 95% を要求する                  |
| `bun run bench`            | 組版パイプラインの処理時間を測る                            |
| `bun run bench:size`       | バンドルサイズとモジュール内訳を測る                        |
| `bun run bench:memory`     | 変換段階ごとの RSS ピークを測る                             |
| `bun audit`                | 依存関係の脆弱性を検査する                                  |

`vp fmt` / `vp lint` でも個別に実行できます。テストのファジングは種を固定しているので再現します。

## HTTP

| 経路                         | 内容                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `GET /`                      | 原稿を読み、A4 1段組（約 24 行で頁分け）で返す                       |
| `GET /magazine.html`         | 同じ原稿を A4 2段組（約 40 行で頁分け）で返す                        |
| `GET /magazine`              | `/magazine.html` と同じ                                              |
| `GET /web.html`              | 同じ原稿を Web 記事スタイルで返す                                    |
| `GET /web`                   | `/web.html` と同じ                                                   |
| `GET /health`                | `{ "ok": true }`                                                     |
| `GET /assets/typeset.css`    | 組版 CSS（1段 / 2段）                                                |
| `GET /assets/web.css`        | Web 記事 CSS                                                         |
| `GET` 原稿ディレクトリの画像 | 相対パスの png / jpg / gif / webp / svg / avif。`Refresh` は付けない |

`GET /` は毎回ファイルを読み直し、`Cache-Control: no-store` で返します。HTML 応答には `Refresh: 2` を付けます（export した静的 HTML には付けません）。応答には CSP（`script-src 'none'`）ほかセキュリティヘッダを付け、静的 HTML にも同じ CSP を `<meta>` で埋めます。原稿が無いときは 404、読み込み失敗時は 500 で、stack trace はブラウザへ出しません。`CONNECT` / `TRACE` / `TRACK` は 405 です。

`bun run dev` と `kumihan serve` の既定は `127.0.0.1:3000` です。Codespaces では `--host 0.0.0.0`、ソースから動かすときは `KUMIHAN_HOST` で広げます。listen に失敗したときは理由を 1 行で出して終了します。

待ち受けを広げても、答えるのは Host ヘッダが自分の名前のリクエストだけです（DNS リバインディング対策。`src/security/host.ts`）。IP リテラルと `localhost` / `*.localhost`、`--host` / `KUMIHAN_HOST` に渡した名前、Codespaces の `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` は通り、それ以外の名前は `KUMIHAN_ALLOWED_HOSTS`（カンマ区切り、`.example.com` で接尾辞）で足します。合わない Host には原稿を読まずに 403 を返します。

## API

renderer は Hono と filesystem から独立しています。

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

原稿の取り出し方は `src/manuscript.ts` の `Manuscript`（`root` と `read()`）にまとめてあります。`createPreviewApp` と `writeExport` はパスの文字列も `Manuscript` も受け取ります。標準入力のように元ファイルが無い原稿は `memoryManuscript` で包み、画像の基準ディレクトリを明示します。

```ts
import { memoryManuscript } from './src/manuscript.ts'
import { writeExport } from './src/export/write-files.ts'

// root を省くと process.cwd() から画像を探します。
const stdin = Buffer.concat(await process.stdin.toArray()).toString('utf8')
await writeExport(memoryManuscript(stdin, 'content'), 'dist')
```

## ベンチマーク

```bash
bun run bench                          # 既定は 50 回 × 40 倍の原稿
bun run bench -- --iterations 300 --scale 100
bun run bench:size                     # バンドルの生 / minify / gzip とモジュール内訳
bun run bench:size -- --binary         # スタンドアロン実行ファイルのサイズも測る
bun run bench:memory                   # 既定は 400 倍の原稿
bun run bench:memory -- --scale 2000
```

`content/index.md` を `--scale` 倍した原稿で、`escapeHtml` / `renderInline` / `renderMarkdown` / `renderDocument` の中央値・最小値・スループットを出します。JIT が温まってから計測します。`--json` で機械可読な出力になります。

## CI とリリース

`main` への push と PR で `vp check`、knip、カバレッジ付きテスト、export、バイナリの smoke test、`actionlint`、`zizmor` が走ります。セキュリティ用ワークフローは Semgrep、Gitleaks、`bun audit` を weekly でも回します。

バージョンタグ（`v0.1.0` など）では、同じ検査のあとスタンドアロン実行ファイルを GitHub Release に載せます。脆弱性の報告手順は [SECURITY.md](SECURITY.md) です。
