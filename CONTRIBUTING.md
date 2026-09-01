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
| `vp test`                  | parser / renderer / HTTP のテストとファジング               |
| `vp test --coverage`       | 同上。`src/**` のカバレッジ 95% を要求する                  |
| `bun run bench`            | 組版パイプラインの処理時間を測る                            |
| `bun run bench:latency`    | 保存からプレビュー反映までの遅れと、無変更時の転送量を測る  |
| `bun run bench:size`       | バンドルサイズとモジュール内訳を測る                        |
| `bun run bench:startup`    | 実行ファイルの起動時間を測る                                |
| `bun run bench:memory`     | 変換段階ごとの RSS ピークを測る                             |
| `bun audit`                | 依存関係の脆弱性を検査する                                  |

`vp fmt` / `vp lint` でも個別に実行できます。テストのファジングは種を固定しているので再現します。

## HTTP

| 経路                         | 内容                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `GET /`                      | 原稿を読み、A4 1段組（約 24 行で頁分け）で返す               |
| `GET /magazine.html`         | 同じ原稿を A4 2段組（約 40 行で頁分け）で返す                |
| `GET /magazine`              | `/magazine.html` と同じ                                      |
| `GET /web.html`              | 同じ原稿を Web 記事スタイルで返す                            |
| `GET /web`                   | `/web.html` と同じ                                           |
| `GET /diff.html`             | 作業中の原稿と `HEAD` の区画差分（組版レイアウト）           |
| `GET /diff`                  | `/diff.html` と同じ                                          |
| `GET /magazine-diff.html`    | 同じ差分を A4 2段組で返す                                    |
| `GET /magazine-diff`         | `/magazine-diff.html` と同じ                                 |
| `GET /web-diff.html`         | 同じ差分を Web 記事スタイルで返す                            |
| `GET /web-diff`              | `/web-diff.html` と同じ                                      |
| `GET /health`                | `{ "ok": true }`                                             |
| `GET /events`                | 原稿が保存されたことを知らせる SSE（`text/event-stream`）    |
| `GET /assets/typeset.css`    | 組版 CSS（1段 / 2段）                                        |
| `GET /assets/web.css`        | Web 記事 CSS                                                 |
| `GET /assets/reload.js`      | 自動リロードのスクリプト（プレビューの HTML だけが読み込む） |
| `GET` 原稿ディレクトリの画像 | 相対パスの png / jpg / gif / webp / svg / avif               |

`GET /diff` は git で追跡されている原稿ファイルのときだけ差分を返します。git が無い、リポジトリ外、未追跡、標準入力では案内ページ（200）になり、切替にも「差分」は出ません。案内も、開いた経路のレイアウト（組版 / 2段 / Web）で返します。`export` の 5 ファイルには含めません。比較はフェンス外の空行で区切った区画単位で、追加は各ブロックの `diff-added`、削除は `diff-removed` です。削除を残すので、組版・2段の頁は通常プレビューとずれることがあります。

`GET /` は毎回ファイルを読み直し、`Cache-Control: no-store` で返します。読み直した中身が前と同じときは組み直さず、変換結果を使い回します。

保存の追従は `/events` で行います。サーバーが原稿を `fs.watch` で監視し（`/events` に購読者がいるあいだだけ）、中身が変わったときだけイベントを流します。ページは原稿のバージョン（内容のハッシュ）を持っていて、`/events?v=<version>` で接続し、イベントが来たらリロードします。読み込みから接続までの間に保存が挟まっていても、バージョンの食い違いでその場に通知が来ます。以前の `Refresh: 2`（2 秒ごとの全リロード、保存から表示まで平均 1 秒）は `<noscript>` の中にだけ残っています。

応答にはセキュリティヘッダを付けます。プレビューの CSP はリロード用に `script-src 'self'` / `connect-src 'self'`（インライン・属性のスクリプトは不可）、export した静的 HTML はスクリプトを含まないので `<meta>` の CSP を `script-src 'none'` のまま締めています。原稿が無いときは 404、読み込み失敗時は 500 で、stack trace はブラウザへ出しません。`CONNECT` / `TRACE` / `TRACK` は 405 です。

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

画像は組む前に実寸を読みます。`withImageSizes(fragment, root)`（`src/typesetting/measure-images.ts`）が、原稿からの相対パスで見つかった画像の縦横を先頭のバイト列から読み（`src/typesetting/image-size.ts`）、断片の `<img>` に `width` / `height` として書き入れます。頁分け（`paginate.ts`）はこれを見て図の高さを本文行に換算し、ブラウザは読み込む前に図の場所を空けられます。読めなかった画像や外部の URL は属性が付かず、従来どおり 1 行として数えます。`exportSite(markdown)` は原稿の場所を持たないので実寸を読みません（`writeExport` とプレビューは読みます）。

変換済みの断片を他の用途にも使うときは、`exportFiles(fragment)` に断片を渡すと Markdown の変換をやり直さずに書き出す一式（`pathname`・`body`・`contentType`）が得られます。`writeExport` はこの形で、変換 1 回の結果を HTML の組み立てと画像の収集の両方に使っています。

原稿の取り出し方は `src/manuscript.ts` の `Manuscript`（`root`・`read()`・任意の `watch()`）にまとめてあります。ファイルから読む原稿は `file` に絶対パスを持ち、プレビューの差分ビューが git を探るために使います。`watch` はファイル原稿だけが持ち、プレビューの `/events` が購読中にだけ使います。`createPreviewApp` と `writeExport` はパスの文字列も `Manuscript` も受け取ります。標準入力のように元ファイルが無い原稿は `memoryManuscript` で包み、画像の基準ディレクトリを明示します。

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
bun run bench:startup                  # dist-bin の実行ファイルを繰り返し起動して測る
bun run bench:memory                   # 既定は 400 倍の原稿
bun run bench:memory -- --scale 2000
```

`bench:startup` は先に `bun run compile` が要ります。組版ではなく、ランタイムとモジュールの読み込みにかかる時間を見るためのものです。ここが伸びると、原稿の大きさに関係なく毎回の実行が遅くなります。`node:http` と `node:fs` は読み込むだけで合わせて 30ms ほどかかるので、実際に使うところ（`serve` と保存の監視）で `process.getBuiltinModule` から取り出しています。

`content/index.md` を `--scale` 倍した原稿で、`escapeHtml` / `renderInline` / `renderMarkdown` / `renderDocument` の中央値・最小値・スループットを出します。JIT が温まってから計測します。`--json` で機械可読な出力になります。

`renderMarkdown` は 3 つの経路を分けて測ります。cold は初回変換（原稿全体の変換）、reload は無変更の原稿の変換し直し、1 edit は 1 ブロックだけ編集した原稿の変換し直しです。変換は前回の原稿との差分だけをやり直すので（`src/markdown/render.ts` の増分変換）、reload と 1 edit は原稿が大きいほど cold より桁で速くなります。

## CI とリリース

`main` への push と PR で `vp check`、knip、カバレッジ付きテスト、export、バイナリの smoke test、`actionlint`、`zizmor` が走ります。セキュリティ用ワークフローは Semgrep、Gitleaks、`bun audit` を weekly でも回します。

バージョンタグ（`v0.1.0` など）では、同じ検査のあとスタンドアロン実行ファイルを GitHub Release に載せます。脆弱性の報告手順は [SECURITY.md](SECURITY.md) です。
