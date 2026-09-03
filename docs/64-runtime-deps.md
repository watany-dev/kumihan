# 実行時依存と重複した入口（#64 / #59–#63）

実装 PR で README / CONTRIBUTING に吸収し、このファイルは消す。

完了条件: `bun run dev` / `bun run export` が `cli.ts` と同じ入口になり、`KUMIHAN_HOST` と listen 失敗の 1 行説明がどちらからも効く。`versionOf` が `Buffer.from(..., 0, 8).toString('hex')` になる。Hono は残す。`exportFiles` と CSP の表は触らない。

## いまの前提

PR #64 は #59–#63 をまとめて入れた実装だが、その後の main と食い違っている（`DIRTY`）。

| 課題 | main の状態 | この設計 |
| --- | --- | --- |
| #59 hono を外す | #66 が逆を採った。`streamSSE` / 複数パス / `secure-headers` / `Cache-Control` ミドルウェア | **やらない** |
| #60 `exportSite` を落とす | #65 で完了。`exportFiles` だけ | **触らない** |
| #61 `dev` / `export` を `cli.ts` に寄せる | `src/server.ts` と `scripts/export.ts` が残っている。`--host` は環境変数を読まない | **やる** |
| #62 CSP の二重定義 | #66 でディレクティブ表 1 つ。HTTP は `secureHeaders()`、`<meta>` は同じ表 | **触らない** |
| #63 標準の書き方 | `versionOf` は手書き 16 進のまま。`git()` は `new Promise` + `execFile` | **`versionOf` だけ** |

#64 を rebase して残さない。実装は main からの別 PR。

## やらない

- Hono を外す。パス表 + `new Response` への置き換え、自前の `request()` / HEAD 本文削除、`withPreviewHeaders` への定数ヘッダ移行
- `promisify(execFile)`。失敗を `null` にする包みと `.stdin?.end()` が残るので短くならない
- CSP の表を `[name, value]` の配列に書き直す（#66 の camelCase オブジェクトのまま `secureHeaders()` に渡す）
- `exportFiles` / `ExportFile` の形を変える
- `kumihan serve` の標準入力の規則を狭める（README の「`-` は省略できます」を壊さない）
- `app.request` の契約を変える。テストは今のまま Hono の `request` / `fetch` を使う
- hop-by-hop ヘッダの除去をやめる（#66 が `streamSSE` 用に入れたもの）

## 決定

| 項目 | 選択 | 理由 |
| --- | --- | --- |
| Hono | 残す | #66 以降、経路登録・SSE・ヘッダは Hono の API の方が短い。実行時依存ゼロのための手書きは、いまの 12 経路では元が取れない |
| `dev` | `bun src/cli.ts serve content/index.md` | `src/server.ts` と同じ原稿。引数があるので非 TTY の stdin を読まない |
| `export` | `bun src/cli.ts export content/index.md` | `scripts/export.ts` と同じ原稿。CI の閉じない stdin で待たない |
| `--host` の既定 | `process.env['KUMIHAN_HOST'] ?? '127.0.0.1'` | README の `KUMIHAN_HOST=0.0.0.0 bun run dev` を、`server.ts` を消したあともそのまま通す。`--host` があれば環境変数より優先 |
| serve の stdin | 今のまま（`-` または、引数省略かつ非 TTY） | 掛けるのは npm script 側の明示パス。CLI のパイプ省略は残す |
| `versionOf` | `Buffer.from(digest, 0, 8).toString('hex')` | 8 バイト・16 桁の契約は変えない。手書き `padStart` ループだけ落とす |
| `git()` | 触らない | `promisify` しても `.stdin?.end()` と `error → null` が残る |
| カバレッジ exclude | `src/cli.ts` だけ | `src/server.ts` を消すので行を外す |

## 流れ

```
bun run dev
  = bun src/cli.ts serve content/index.md
  --host 既定 = KUMIHAN_HOST ?? 127.0.0.1
  listen 失敗 → describeListenError の 1 行で終了

bun run export
  = bun src/cli.ts export content/index.md
  dist/ に今までどおり 5 ファイル + 画像

kumihan serve            # 端末なら content/index.md
cat draft.md | kumihan serve          # パイプ。`-` 省略のまま
cat draft.md | kumihan serve -        # 明示。空なら終了 1
```

`src/server.ts`（ポート 3000 固定、listen の `error` 無し、`KUMIHAN_HOST` だけ読む縮小版）と `scripts/export.ts`（原稿無しの案内が無い縮小版）は消す。差が出ていた 3 点（ホスト、listen 失敗、原稿無し）は `cli.ts` 側の実装に揃う。

## 変更箇所

1. `package.json` — `dev` / `export` を上表のコマンドに。`dependencies` の hono は残す。`bunfig.toml` の `hono` 除外も残す。
2. `src/cli.ts` — `--host` の `default` だけ変える。stdin の分岐は触らない。
3. `src/server.ts` — 削除。
4. `scripts/export.ts` — 削除。
5. `vite.config.ts` — coverage `exclude` から `src/server.ts` を外す。
6. `src/app.ts` — `versionOf` のループを `Buffer.from(digest, 0, 8).toString('hex')` に。`Buffer` は Node のグローバル（`cli.ts` と同じ）。lint が `node:buffer` を要求したらその import だけ足す。
7. CONTRIBUTING.md — コマンド表の内容は変えない。カバレッジの説明が `src/server.ts` に触れていたら外す。Hono の一文は残す。

`src/node-server.ts` の `Hono` 型、`createPreviewApp(): Hono`、セキュリティヘッダ、SSE は触らない。

## stdin を狭めない理由

#61 は「`bun run dev` が閉じない stdin で止まらない」が完了条件。PR #64 は serve 全体を「`-` のときだけ読む」に狭めてこれを満たした。その副作用で、README にある

```
cat manuscript.md | ./kumihan serve          # `-` は省略できます
```

が壊れる。

npm script がファイルを明示すれば、`bun run dev` / `bun run export` は stdin を見ない。CLI のパイプ省略は残る。`sleep 30 | bun src/cli.ts serve` のような引数無しの直叩きは今までどおり stdin を待つが、ユーザー向け入口ではない。

## `versionOf`

いま:

```
for (const byte of new Uint8Array(digest, 0, 8)) {
  version += byte.toString(16).padStart(2, '0')
}
```

あと:

```
Buffer.from(digest, 0, 8).toString('hex')
```

`crypto.subtle.digest` の戻りは `ArrayBuffer`。先頭 8 バイト、16 桁の小文字 16 進。テスト（`data-kumihan-version="([0-9a-f]{16})"`）は変更なし。

`node:http` / `node:fs` を遅延している理由（読み込みだけで数十 ms）と同じ心配があるので、`bun run bench:startup` を実装 PR で一度見る。`cli.ts` は serve / export のどちらも `app.ts` を静的 import しているため、ここでの `Buffer` 利用が export 起動に乗る。悪化したら手書きに戻す。

## 実装順

テストを先に書いて、そのテストが通るまで進める、というより、既存テストが契約になる。新規の失敗テストは不要（HEAD / `/events` のクエリ無しは #66 のまま通っている）。

1. `versionOf`。`test/render-cache.test.ts` / `test/app.test.ts` が変更なしで通る。
2. `--host` の既定。`src/server.ts` / `scripts/export.ts` を消し、`package.json` と coverage exclude を付ける。
3. `vp check` / `vp test` / knip。`bun run export` の 5 ファイル。`KUMIHAN_HOST=0.0.0.0` なしの `bun run dev` が `127.0.0.1:3000`。埋まっているポートで 1 行終了。
4. `timeout 3 bun run dev` が待ち受けまで届く（非 TTY でも stdin で止まらない）。
5. `bun run bench:startup` が悪化していないこと。README のパイプ例は動かして確認するだけ（コードは触らない）。

## テスト（最小）

既存が契約。実装 PR でテストファイルを増やさない。

| 層 | 失敗したら壊れているもの |
| --- | --- |
| `test/http.test.ts` の `assertSecurityHeaders` | CSP / フレーム / Permissions-Policy。変更禁止 |
| `test/app.test.ts` の version 正規表現 | `versionOf` が 16 桁 16 進でなくなった |
| `test/export.test.ts` | 書き出し 5 本と Content-Type |
| `test/git-source.test.ts` | `git()` を触っていないこと |
| HTTP / SSE / 差分 / fuzz-http | `app.request` / `app.fetch` のまま通る |

手動:

| 操作 | 期待 |
| --- | --- |
| `bun run dev` | `Typeset preview: http://127.0.0.1:3000` |
| `KUMIHAN_HOST=0.0.0.0 bun run dev` | 待ち受けは `0.0.0.0`、表示は `127.0.0.1` |
| ポート使用中の `bun run dev` | `ポートが使用中です: ...` で終了 1。スタック無し |
| `timeout 3 bun run dev`（stdin を閉じない） | 待ち受けの 3 行まで出る |
| `bun run export` | `dist/index.html` ほか 5 本 + 画像。CSP は `script-src 'none'` |
| `cat content/index.md \| kumihan serve` | パイプ原稿で起動（`-` 省略） |
| `bun run bench:startup` | 実装前より悪くない |

## PR #64 との関係

#64 の差分のうち採るのは、`--host` の既定、`dev` / `export` の付け替え、2 ファイル削除、`versionOf` の 1 行、coverage exclude。採らないのは hono 削除、パス表、自前 SSE、stdin の狭め、CSP の配列化。競合を解くより、main から小さく入れ直す。
