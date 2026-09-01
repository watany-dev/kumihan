# レンダリング差分ビュー（#51）

実装 PR で README / CONTRIBUTING に吸収し、このファイルは消す。

完了条件: git 管理下の原稿で `/diff` を開くと、HEAD 以降に追加・削除・変更した区画が印付きで出る。git が無い / リポジトリ外 / 未追跡 / 標準入力では従来動作のまま差分モードが出ない。保存で差分ビューも追従する。`export` の出力は変わらない。

## やらない

リビジョン選択 UI、`?rev=`、語単位のインライン diff、組版 / 2段での差分、HEAD 移動の自動検知、export への `diff.html`、git ライブラリ、stdin 原稿。空の差分（HEAD と同じ）は印なしの Web 記事として出す。

## 決定

| 項目 | 選択 | 理由 |
| --- | --- | --- |
| 比較対象 | 作業中の原稿（`read()`）対 `HEAD` | ステージ済みも未ステージも同じ。MVP は rev 固定 |
| 単位 | フェンス外の空行で区切った区画 | 増分変換と同じ切り方。区画ごとの変換をつないだものは全体変換と一致する |
| 算法 | 区画列の LCS（keep / add / del） | 原稿規模なら区画は高々数千。隣接 del+add は変更として縦に並べる |
| 描画 | Web レイアウト。add は緑の左罫＋淡い地、del は赤の左罫＋淡色 | 頁割り（組版 / 2段）は対象外。校正の赤入れに近い |
| 経路 | `/diff` と `/diff.html` | `/magazine` と `/web` と同じ別名 |
| 切替 | git が使えるときだけ「差分」を足す | 使えないときは出さない。直打ちの `/diff` は案内ページ |
| 変換 | 区画ごとにキャッシュを経由しない変換 | `renderMarkdown` の増分キャッシュはモジュール変数。区画ごとに呼ぶと組版側のキャッシュが壊れる |
| 画像 | 連結した断片を `withImageSizes` に通す | 削除側の画像が無くても、読めない画像は寸法なしで出す（既存の落ち方） |
| 子プロセス | `git` CLI。シェルなし、引数配列 | 依存を増やさない。パスは `--` の後ろ。rev は外部入力にしない |
| export | 触れない | プレビュー専用。`exportFiles` の 5 ファイルは現状のまま |

## 流れ

```
serve 原稿.md
  起動: 原稿に file がある → git を一度だけ探る
    失敗 → 切替に「差分」を出さない。GET /diff は案内
    成功 → 切替に「差分」を出す

GET /diff
  新 = manuscript.read()
  旧 = git cat-file -p $(git rev-parse HEAD:<rel>)
       （HEAD に無いが index にはある → 旧は空 = 全部 add）
  両方を同じ正規化のあと区画に分け、LCS
  keep/add は新の区画、del は旧の区画を変換
  add → <div class="diff-added">、del → <div class="diff-removed">
  連結 → withImageSizes → renderDocument(mode: 'web')
```

標準入力（`memoryManuscript`）は `file` が無いので探らない。

## 変更箇所

1. `src/manuscript.ts` — `Manuscript` に任意の `file?: string`（絶対パス）。`toManuscript` だけ入れる。stdin は持たない。
2. `src/markdown/segments.ts`（新規） — `segmentEnd` と `splitSegments`（正規化済み文字列）。`render.ts` の増分変換は今のループのまま、終端判定だけ共有する。ホットパスに配列確保を足さない。
3. `src/markdown/render.ts` — 区画 1 つの変換を `renderMarkdownPiece` として出す（`renderLines`。`lastRender` を触らない）。正規化は今どおりここ。
4. `src/git-source.ts`（新規） — 探りと本文取得。`node:child_process` は `process.getBuiltinModule` で、使うときだけ読む（export 起動を伸ばさない）。
5. `src/diff/block-diff.ts`（新規） — 純関数。LCS と HTML の組み立て。git も HTTP も見ない。
6. `src/app.ts` — `/diff` `/diff.html`。探りは `createPreviewApp` を同期のままにするため、初回の HTML 応答で await して結果を覚える。
7. `src/typesetting/render-page.ts` — 切替の 4 本目。既定は出さないので既存の document / export テストは動かない。
8. `src/typesetting/web.css.ts` — `.diff-added` / `.diff-removed`。スクリプトは増やさず、CSP も変えない。
9. テスト — 下表。README / CONTRIBUTING の HTTP 表と表示モード表。

`PreviewMode` に `'diff'` は足さない。頁割りキャッシュと混ぜない。`renderDocument` は `mode: 'web'` のまま、切替用のフラグだけ足す。

## git

探り（どれかが失敗したら機能ごと無効）:

```
git rev-parse --show-toplevel
git ls-files --error-unmatch -- <repo相対パス>
```

cwd は原稿ファイルのディレクトリ。相対パスは toplevel からの POSIX（`/`）。`contained(toplevel, file)` が偽、または相対が `..` で始まるなら無効（リポジトリ外）。

本文:

```
git rev-parse --verify --end-of-options HEAD:<rel>   → blob OID
git cat-file -p <oid>
```

`show HEAD:path` より、検証済み OID だけを `cat-file` に渡す。stdin は `ignore`。`GIT_TERMINAL_PROMPT=0`。数秒で打ち切る。

失敗の分け方:

| 状況 | 差分モード |
| --- | --- |
| git が無い / リポジトリでない / 未追跡 / リポジトリ外 / stdin | 無効。案内ページ |
| index にはあるが HEAD に無い（新規 `git add`） | 有効。旧は空 |
| `cat-file` がその場で失敗 | 案内ページ（500 にしない） |

HEAD がコミットで動いても、保存かページ再読み込みまで組み直さない（Issue の MVP 外）。保存で原稿バージョンが変われば `rev-parse` し直すので、そのタイミングでは新しい HEAD を見る。

## 差分の形

LCS は区画の字面が完全一致したとき keep。1 文字でも違えば del+add（変更）。語単位は将来。

並びの規則:

- keep はそのまま（wrapper なし）。Web の `h1 + p` など隣接セレクタを、変わっていない箇所では維持する
- 連続する del、連続する add は同じ kind の wrapper 1 つにまとめる
- 隣接する del ランと add ランは、del（旧）→ add（新）の順で出す。削除が元の位置に残る

不変条件（テストする）:

```
join(renderMarkdownPiece(seg) for seg in splitSegments(normalize(src)))
  === renderMarkdown(src)
```

空白だけの区画は HTML に出ない。LCS の列からも落とす。

キャッシュキーは `(blob OID, versionOf(新))`。両方前回と同じなら組み直さない。新側の `versionOf` は既存。旧側の変換結果も OID ごとに持つ。

## 描画と CSS

```html
<div class="diff-removed">…旧の変換…</div>
<div class="diff-added">…新の変換…</div>
```

色は Web 記事の既存トーンに合わせる（赤 `#e60012` 系を削除、追加は緑）。左罫 4px、薄い背景。wrapper 内の最後のブロックは下余白を畳む。

`.article > *` の `content-visibility` は wrapper に掛かる。keep のブロックには今までどおり掛かる。

印刷時も印は残す（切替は既存どおり消える）。

案内ページは 200。切替は 3 モードだけ。自動リロードは付ける（原稿が読めるようになったときのため。git の有効/無効はプロセス中は変わらない）。

## セキュリティ

- シェルを介さない。パスは `ls-files` では `--` の後ろ。OID は `rev-parse --verify --end-of-options` の出力だけを `cat-file` に渡す
- 原稿パスに改行・NUL があれば探り失敗として無効
- MVP はクエリも rev も受けない。将来 `?rev=` を足すときは、使う前に `git rev-parse --verify --end-of-options` で検証する
- CSP / スクリプト / `reload.js` は触らない
- スタックはブラウザに出さない（既存の 500 と同じ）

## 実装順

テストを先に書いて、そのテストが通るまで進める。

1. `segments.ts` の切り出し。既存の増分変換テストがそのまま通る。不変条件のテストを足す。
2. `git-source.ts`。一時ディレクトリで `git init` するフィクスチャ（このリポジトリの状態に依存しない）。
3. `block-diff.ts`。keep / add / del / 変更ペア / 空 / フェンスをまたぐ空行。
4. `/diff` と `web.css`。切替フラグ。stdin と git 無しでリンクが出ないこと。
5. 保存の SSE で `/diff` が追従すること。`exportSite` のパス一覧が変わらないこと。README / CONTRIBUTING。

## テスト（最小）

| 層 | 失敗したら壊れているもの |
| --- | --- |
| 不変条件（上） | 区画切り出しが増分変換と食い違っている |
| `diffSegments(['A','B'], ['A','C'])` | keep A、del B、add C。B が removed、C が added |
| フェンス内の空行 | 1 区画のまま。フェンスの中で切らない |
| `git init` した原稿を編集 | `/diff` が 200。追加が `diff-added`、削除が `diff-removed` |
| 未追跡 / リポジトリ外 / `memoryManuscript` | 切替に「差分」が無い。`/diff` は案内。他モードの HTML は今までどおり |
| 新規 `git add` のみ | 全文が added |
| 保存 | `/events` のあと `/diff` が新しい区画を含む |
| `exportSite` | パスが 5 本のまま。`diff.html` が無い。切替は 3 本 |
| パスに `; rm -rf` 相当 | シェルに渡らず、探り失敗か通常の git エラー |

HTTP の `/diff` にも既存のセキュリティヘッダが付くこと。`createPreviewApp({ source: './content/index.md' })` のテストは、このリポジトリで git が有効になるので切替 4 本目の有無を決め打ちしない。git の有無はフィクスチャで見る。
