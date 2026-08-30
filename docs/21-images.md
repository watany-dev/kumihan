# 画像対応（#21）

実装 PR で README / CONTRIBUTING に吸収し、このファイルは消す。

完了条件: `![alt](path)` が組版 / 2段 / Web に出る。export した HTML からも見える。危険な URL は無効。raw HTML の `<img>` は出さない。

## やらない

title（`![alt](x "t")`）、参照リンク、`data:`、`<img>` 生タグ、画像専用ブロック要素、頁高さの実測。空 alt は通す。

## 決定

| 項目 | 選択 | 理由 |
| --- | --- | --- |
| 記法 | 既存 `parseLink` の直前に `!` | `[...](...)` と同じ閉じ判定を再利用する |
| alt | `escapeHtml(literal(alt))` | 属性値。中の強調は出さない |
| URL | `sanitizeImageUrl` = `sanitizeUrl` のあと http/https/スキーム無しだけ | リンクの mailto / `#fragment` を src にしない |
| 無効時 | `<img src="#" alt="…">` | `[x](javascript:…)` が `href="#"` になるのと同じ |
| CSP | `img-src 'self' https: http:` | 通す URL と一致させる。`script-src 'none'` は触らない |
| 相対パス | 原稿ファイルのディレクトリ基準。HTML の `src` は書き換えない | preview も export も同じ相対 URL |
| 配信 / コピー | 拡張子 allowlist + ルート外拒否 | 原稿や `../` を出さない |
| 見た目 | `max-width: 100%; height: auto`。2段は画像だけの段落を全幅 | スクリーンショットが 1 段に潰れるのを避ける |
| 頁分け | 触らない | 既存の「HTML 改行数」天井のまま |

拡張子: `.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg` `.avif`。SVG は `<img>` と CSP の `script-src 'none'` に任せる。

## 流れ

```
原稿.md（隣に shot.png）
  ![図](shot.png)     →  <p><img src="shot.png" alt="図"></p>
  ![x](https://…)     →  src そのまま（CSP の https:）
  ![x](javascript:…)  →  src="#"

serve:  GET /shot.png  →  dirname(原稿)/shot.png
export: dist/shot.png へコピー。src は shot.png のまま
```

renderer はファイルを見ない。`exportSite(markdown)` の API は変えない。コピーは `writeExport` だけ。

## 変更箇所

1. `src/markdown/inline.ts` — `nextMarkerIndex` に `!`。`![` なら `parseLink`、成功で `<img>`。
2. `src/markdown/escape.ts` — `sanitizeImageUrl`。制御文字・未知スキームの判定は `sanitizeUrl` に任せる。
3. `src/security/headers.ts` — HTTP ヘッダと `<meta>` の `img-src` を同じ値に。
4. `src/manuscript-path.ts`（新規） — `resolveManuscriptFile(root, rel) → string | null`。preview と export が同じ関数を使う。
5. `src/app.ts` — 既存ルートの後ろに GET キャッチオール。当たったらファイルを返す。`Refresh: 2` は HTML だけ。
6. `src/export/write-files.ts` — 断片 HTML からローカル `src` を集め、root 内なら `outDir` へ相対パスごとコピー。無いファイルは 1 行警告して続行。
7. `src/typesetting/typeset.css.ts` / `web.css.ts` — 上記の img ルール。2段は `.typeset.cols-2 p:has(> img:only-child) { column-span: all }`（img は `<p>` の中）。
8. `src/typesetting/paginate.ts` — void に `img` を足す。bare `<img>` が来ても `</img>` まで頁を吸い込まない。
9. `test/fuzz.test.ts` — `ALLOWED_TAGS` / `VOID_TAGS` に `img`。`src` / `alt` 以外の属性は拒否。src のスキームは http/https のみ（mailto 不可）。INLINE に `![` を足す。
10. README / CONTRIBUTING — 対応記法に画像。未対応から image を外す。HTTP 表に「原稿ディレクトリの画像」。export の木に画像ファイル。

## パス判定

`resolveManuscriptFile`:

- 空、NUL、バックスラッシュ、スキーム付き、絶対パスは拒否
- `%2e%2e` は decode してから見る
- `path.resolve(root, rel)` の結果が `root` の外なら拒否（`path.relative` が `..` で始まる / 絶対）
- 拡張子が allowlist 外なら拒否
- 実ファイルを読むときは `realpath`。symlink で root の外へ出たら拒否

予約パス（`/`, `/health`, `/magazine.html`, `/assets/typeset.css`, `/assets/web.css`）は先に登録済みなので取られない。

## 実装順

テストを先に書いて、そのテストが通るまで進める。

1. `sanitizeImageUrl` と `![alt](url)` の HTML。security テストに `src` 版を足す。
2. CSP を緩める。document / http テストの期待値を更新。
3. CSS。組版と Web のスナップショットが属性を含むこと。
4. `resolveManuscriptFile` の単体テスト（`../`, 絶対, 拡張子, symlink）。
5. preview が原稿隣の画像を返し、root 外は 404。
6. `writeExport` がコピーする。http(s) はコピーしない。
7. fuzz / README / CONTRIBUTING。

## テスト（最小）

| 層 | 失敗したら壊れているもの |
| --- | --- |
| `renderMarkdown('![図](a.png)')` | `<p><img src="a.png" alt="図"></p>` |
| `![x](javascript:alert1)` | `src="#"`。`javascript:` が属性に残らない |
| `![x](mailto:a@b)` | `src="#"` |
| `![<script>](a.png)` | alt がエスケープ |
| `<img src="x">` を原稿に書く | タグにならない（既存の escape） |
| `[![a](b.png)](https://e)` | リンクの中に img（追加コードなし） |
| preview `GET /a.png` | 200、画像 Content-Type |
| preview `GET /../package.json` 相当 | 404 |
| export | `dist/a.png` があり、3 HTML の src が `a.png` |

HTTP の画像応答にも既存のセキュリティヘッダが付くこと（`app.use('*', previewSecureHeaders())` のまま）。
