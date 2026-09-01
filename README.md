# kumihan

Markdown 原稿を、A4 の組版・2段組・Web 記事の 3 つの見た目でプレビューし、静的 HTML に書き出すツールです。git で追跡している原稿なら、前回のコミットからどこを直したかも、組んだ見た目のまま確認できます。

個人または小規模な執筆を対象にした v0.1 です。VS Code Extension、CMS、データベースは含みません。編集は手元のエディタで行い、ブラウザは表示だけです。

```
原稿.md
  │
  ├─ 組版     A4 1段組（明朝本文）
  ├─ 2段      A4 縦2列
  └─ Web      画面幅に合わせた記事
         │
         ▼
   HTML + CSS（プレビュー / dist/）
```

## はじめ方

[Releases](https://github.com/watany-dev/kumihan/releases) から実行ファイルを落とします。

```bash
curl -fsSL -o kumihan \
  https://github.com/watany-dev/kumihan/releases/latest/download/kumihan-linux-x64
chmod +x kumihan
./kumihan serve manuscript.md
```

ブラウザで http://127.0.0.1:3000 を開き、右上から表示モードを切り替えます。保存した原稿は、0.2 秒ほどでプレビューへ反映されます。

```bash
./kumihan export manuscript.md --out dist
```

原稿はパイプでも渡せます。`-` は標準入力を読みます。

```bash
cat manuscript.md | ./kumihan serve -
pandoc draft.docx -t gfm | ./kumihan export - --out dist
```

| ファイル                                      | 対象    |
| --------------------------------------------- | ------- |
| `kumihan-linux-x64` / `kumihan-linux-arm64`   | Linux   |
| `kumihan-darwin-x64` / `kumihan-darwin-arm64` | macOS   |
| `kumihan-windows-x64.exe`                     | Windows |

macOS で隔離されるときは `xattr -d com.apple.quarantine kumihan-darwin-arm64` を実行してください。既定の待ち受けは `127.0.0.1:3000` です。ポートやホストを変えるときは `--port` / `--host` を付けます。

## このリポジトリで書く

原稿の置き場は `content/index.md` です。履歴は Git に任せます。

### GitHub Codespaces

1. このリポジトリを Codespaces で開く
2. ターミナルで `bun run dev` を実行する
3. Forwarded Port `3000`（Typeset Preview）をブラウザで開く
4. `content/index.md` を編集して保存する

### ローカル

[Vite+](https://viteplus.dev/)（`vp`）と [Bun](https://bun.sh/) 1.4.0 が必要です。

```bash
curl -fsSL https://vite.plus | bash
curl -fsSL https://bun.sh/install | bash
vp install
bun run dev
```

http://127.0.0.1:3000 を開きます。同じ LAN の別端末から見たいときだけ `KUMIHAN_HOST=0.0.0.0 bun run dev` のように明示してください。

プレビューは編集中の原稿をそのまま返すので、Host ヘッダが自分の名前のリクエストにだけ答えます（他人のドメインを 127.0.0.1 に差し替えて読み出す DNS リバインディングを防ぐためです）。ループバックと IP アドレス、`localhost`、Codespaces の転送ドメインはそのまま通ります。自前のホスト名で開きたいときは `KUMIHAN_ALLOWED_HOSTS=lab.example` のように許可してください（`.example.com` と書くと、その接尾辞を持つ名前をまとめて許可します）。

## 原稿

対応している記法:

- `#` / `##` / `###` 見出し
- 段落
- `**bold**` / `*emphasis*` / `` `inline code` ``
- `[link](https://example.com)`
- `![alt](path)` 画像（相対パス / `https:` / `http:`）
- `>` 引用
- `-` 箇条書き / `1.` 番号付きリスト
- `---` 水平線
- フェンス付きコードブロック
- パイプ区切りの表（揃えの `:` とセル内の `\|` を含む）

使えないもの: raw HTML、入れ子リスト、footnote、task list、MDX、frontmatter、syntax highlighting。

HTML は escape します。リンクは `https:` / `http:` / `mailto:` / 相対 URL / `#fragment` だけ通し、`javascript:` などは無効にします。画像の URL は相対と `https:` / `http:` だけです。

日本語の改行では不要な半角空白を入れません。行末 2 スペースは明示的な改行です。

相対パスの画像は、組む前に実寸（png / jpg / gif / webp / svg / avif の縦横）を読みます。頁分けは図の高さをそのぶん見込むので、大きな図のある原稿でも頁があふれません。原稿に対して実寸のまま組むわけではなく、版面（2段組では段）より広い図は幅いっぱいに、段 1 本より高い図はその高さまで、縦横比を保ったまま縮めます。

## 表示モード

| モード | アドレス         | 見た目                                                                                             |
| ------ | ---------------- | -------------------------------------------------------------------------------------------------- |
| 組版   | `/`              | A4 1段組。本文は明朝、見出しはゴシック、code は等幅。長いときはおよそ 24 行ごとに頁分け。印刷は A4 |
| 2段    | `/magazine.html` | 同じ原稿を A4 縦2列にする。見出し・リード・コードは全幅。長いときはおよそ 40 行ごとに頁分け        |
| Web    | `/web.html`      | 画面幅に合わせた記事。本文はゴシック                                                               |
| 差分   | `/diff.html`     | 作業中の原稿と `HEAD` の区画差分。追加は緑の左罫、削除は赤の左罫。削除された区画も元の位置に残す   |

切り替えは右上（Web ではヘッダー）から行います。JavaScript は使いません。組版と 2段は画面上でも印刷時でも A4 が積み重なります。各紙の下余白にはノンブル（頁番号）が入り、2 枚目からは上余白に柱（原稿の見出し）が付きます。保存するとプレビューが追従します。

差分はプレビュー専用です。git が使えないとき、リポジトリの外、未追跡のファイル、標準入力の原稿では切替に出ません。`export` の出力にも含まれません。

## 書き出しと GitHub Pages

```bash
./kumihan export manuscript.md --out dist
# リポジトリの原稿なら
bun run export
```

```
dist/
├─ index.html
├─ magazine.html
├─ web.html
├─ shot.png          # 原稿が `![alt](shot.png)` を含むとき
└─ assets/
   ├─ typeset.css
   └─ web.css
```

## 標準入力

`-` を渡すと標準入力から原稿を読みます。ファイルを省略したときも、標準入力が端末でなければ（パイプやリダイレクト）そちらを読みます。何も流れてこなければ既定の `content/index.md` に戻ります。

```bash
cat manuscript.md | ./kumihan export - --out dist
cat manuscript.md | ./kumihan serve          # `-` は省略できます
```

標準入力には元のファイルの場所が無いので、`![alt](shot.png)` のような相対パスは**カレントディレクトリ**から探します。画像を含む原稿を流し込むときは、その画像があるディレクトリで実行してください。

`serve` に流し込んだ原稿はメモリに保持するので、プレビューは起動時の内容のまま変わりません。編集しながら見るときはファイルパスを渡してください。

`main` への push で GitHub Actions が検査したあと GitHub Pages へ載せます。リポジトリの Pages 設定は **GitHub Actions** を選んでください。

## コマンド

| コマンド                   | 内容                                                      |
| -------------------------- | --------------------------------------------------------- |
| `kumihan serve [file\|-]`  | プレビューを起動する。既定の原稿は `content/index.md`     |
| `kumihan export [file\|-]` | `dist/*.html` と CSS を生成する。`--out` で出力先を変える |
| `bun run dev`              | リポジトリの `content/index.md` をプレビューする          |
| `bun run export`           | リポジトリの原稿を `dist/` へ書き出す                     |

開発（テスト、lint、ベンチ、内部 API）は [CONTRIBUTING.md](CONTRIBUTING.md) を見てください。脆弱性の報告は [SECURITY.md](SECURITY.md) です。
